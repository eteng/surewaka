# Payout Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the end-to-end payout/withdrawal flow — Paystack Transfer API, BullMQ job, webhook callbacks, push notifications, and admin read-only list — so drivers and customers can actually receive money they request.

**Architecture:** `POST /payouts/request` debits the wallet and inserts a `pending` row (already done), then immediately enqueues a `process-payout` BullMQ job. The job calls Paystack to create a transfer recipient and initiate the transfer, marking the row `processing`. Paystack fires `transfer.success` / `transfer.failed` / `transfer.reversed` webhooks, which update the row to a terminal state, re-credit the wallet when needed, and push a notification to the user.

**Tech Stack:** Hono, BullMQ (bullmq), Drizzle ORM, NeonDB (Postgres), Paystack Transfer API, push-triggers service.

---

## File Map

| Action | Path | What changes |
|--------|------|-------------|
| Modify | `packages/db/src/schema/enums.ts` | Add `payout_reversal` to `transactionType` enum |
| Modify | `packages/db/src/schema/payout-requests.ts` | Add `reversed` to status check constraint |
| Generate + apply | `packages/db/drizzle/<migration>.sql` | Migrations for both schema changes |
| Modify | `apps/api/src/lib/wallet-service.ts` | Add `'payout_reversal'` to `TransactionType` TS union |
| Modify | `workers/payment-worker/src/jobs/process-payout.ts` | Fix retry bug; add exhaustion re-credit |
| Modify | `workers/payment-worker/src/index.ts` | Wire `handleProcessPayout` into switch |
| Modify | `apps/api/src/routes/payouts.ts` | Enqueue `process-payout` job after insert |
| Modify | `packages/shared/src/constants.ts` | Add `wallet_withdrawal` push notification type |
| Modify | `apps/api/src/services/push-triggers.ts` | Add `notifyPayoutCompleted` + `notifyPayoutFailed` |
| Modify | `apps/api/src/routes/webhook.ts` | Handle `transfer.success` / `transfer.failed` / `transfer.reversed` |
| Create | `apps/api/src/routes/admin/payouts.ts` | Admin read-only payout list |
| Modify | `apps/api/src/index.ts` | Wire admin payouts route |

---

## Task 1: DB Schema — `payout_reversal` type + `reversed` payout status

**Files:**
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/payout-requests.ts`

- [ ] **Step 1: Add `payout_reversal` to the transaction_type Postgres enum**

In `packages/db/src/schema/enums.ts`, replace the `transactionType` definition:

```typescript
export const transactionType = pgEnum('transaction_type', [
  'fund',
  'escrow_hold',
  'escrow_release',
  'refund',
  'payout',
  'commission',
  'adjustment',
  'payout_reversal',
]);
```

- [ ] **Step 2: Add `reversed` to payout_requests status check constraint**

In `packages/db/src/schema/payout-requests.ts`, replace the status check constraint:

```typescript
check(
  'payout_requests_status_check',
  sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'reversed'::text])`,
),
```

- [ ] **Step 3: Generate and apply the migration**

```bash
pnpm --filter @surewaka/db db:generate
pnpm --filter @surewaka/db db:migrate
```

Expected: two new migration files generated, applied without error.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/enums.ts packages/db/src/schema/payout-requests.ts packages/db/drizzle/
git commit -m "feat(db): add payout_reversal transaction type and reversed payout status"
```

---

## Task 2: Add `payout_reversal` to wallet-service TransactionType

**Files:**
- Modify: `apps/api/src/lib/wallet-service.ts`

- [ ] **Step 1: Add the new value to the TS union**

In `apps/api/src/lib/wallet-service.ts`, replace the `TransactionType` definition:

```typescript
export type TransactionType =
  | 'fund'
  | 'escrow_hold'
  | 'escrow_release'
  | 'refund'
  | 'payout'
  | 'commission'
  | 'adjustment'
  | 'payout_reversal';
```

- [ ] **Step 2: Verify type-checks pass**

```bash
pnpm --filter @surewaka/api typecheck 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/wallet-service.ts
git commit -m "feat(wallet): add payout_reversal transaction type"
```

---

## Task 3: Fix process-payout job — retry logic + exhaustion re-credit

**Files:**
- Modify: `workers/payment-worker/src/jobs/process-payout.ts`

The existing implementation has a critical bug: the `catch` block marks the row `failed` then re-throws, so BullMQ retries hit the `status !== 'pending'` guard and skip silently. Fix: accept the `Job` object to detect the last attempt; revert to `pending` on intermediate failures; re-credit the wallet and mark `failed` only on exhaustion.

- [ ] **Step 1: Rewrite process-payout.ts**

Replace the entire file:

```typescript
import { db, payoutRequests, wallets, walletTransactions } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { ProcessPayoutJobData } from '../queue';

const BASE = 'https://api.paystack.co';

function headers() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function createRecipient(name: string, accountNumber: string, bankCode: string) {
  const res = await fetch(`${BASE}/transferrecipient`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    }),
  });
  const json = (await res.json()) as { status: boolean; message?: string; data: { recipient_code: string } };
  if (!json.status) throw new Error(`Recipient creation failed: ${json.message ?? res.status}`);
  return json.data;
}

async function initiateTransfer(amount: number, recipientCode: string, reference: string, reason: string) {
  const res = await fetch(`${BASE}/transfer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      source: 'balance',
      amount,
      recipient: recipientCode,
      reference,
      reason,
    }),
  });
  const json = (await res.json()) as { status: boolean; message?: string; data: { transfer_code: string; status: string } };
  if (!json.status) throw new Error(`Transfer initiation failed: ${json.message ?? res.status}`);
  return json.data;
}

async function reversePayoutInWallet(walletId: string, amount: number, payoutId: string, reason: string) {
  await db.transaction(async (tx) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for('update');

    if (!wallet) throw new Error(`Wallet ${walletId} not found during reversal`);
    const newBalance = Number(wallet.balance) + amount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    await tx.insert(walletTransactions).values({
      walletId,
      type: 'payout_reversal',
      amount,
      balanceAfter: newBalance,
      reference: `reversal_${payoutId}`,
      description: reason,
    });

    await tx
      .update(payoutRequests)
      .set({ status: 'failed', failureReason: reason, processedAt: new Date() })
      .where(eq(payoutRequests.id, payoutId));
  });
}

export async function handleProcessPayout(job: Job<ProcessPayoutJobData>) {
  const { payoutRequestId } = job.data;

  const [payout] = await db
    .select()
    .from(payoutRequests)
    .where(eq(payoutRequests.id, payoutRequestId));

  if (!payout) throw new Error(`Payout request not found: ${payoutRequestId}`);

  // Skip terminal states — already handled (by webhook or a prior exhaustion)
  if (payout.status === 'completed' || payout.status === 'failed' || payout.status === 'reversed') {
    console.log(`[ProcessPayout] Skipping terminal payout ${payout.id} (status: ${payout.status})`);
    return { skipped: true, status: payout.status };
  }

  // Transfer already initiated — webhook will complete it, no need to re-call Paystack
  if (payout.paystackTransferCode) {
    console.log(`[ProcessPayout] Transfer already initiated for ${payout.id}, awaiting webhook`);
    return { skipped: true, reason: 'transfer_already_initiated' };
  }

  // Mark as processing
  await db
    .update(payoutRequests)
    .set({ status: 'processing' })
    .where(eq(payoutRequests.id, payout.id));

  try {
    const recipient = await createRecipient(payout.accountName, payout.accountNumber, payout.bankCode);
    const reference = `payout_transfer_${payout.id}`;
    const transfer = await initiateTransfer(
      payout.amount,
      recipient.recipient_code,
      reference,
      `SureWaka payout to ${payout.accountName}`,
    );

    await db
      .update(payoutRequests)
      .set({
        paystackRecipientCode: recipient.recipient_code,
        paystackTransferCode: transfer.transfer_code,
        ...(transfer.status === 'success' ? { status: 'completed', processedAt: new Date() } : {}),
      })
      .where(eq(payoutRequests.id, payout.id));

    return { transfer_code: transfer.transfer_code, status: transfer.status };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade >= maxAttempts;

    if (isLastAttempt) {
      // All retries exhausted — mark failed and return money to wallet
      console.error(`[ProcessPayout] Exhausted retries for ${payout.id}:`, err);
      await reversePayoutInWallet(
        payout.walletId,
        payout.amount,
        payout.id,
        `Payout failed after ${job.attemptsMade} attempts: ${reason}`,
      );
    } else {
      // Intermediate failure — revert to pending so the next attempt can proceed
      await db
        .update(payoutRequests)
        .set({ status: 'pending' })
        .where(eq(payoutRequests.id, payout.id));
      throw err;
    }
  }
}
```

- [ ] **Step 2: Verify the worker package type-checks**

```bash
pnpm --filter @surewaka/payment-worker typecheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workers/payment-worker/src/jobs/process-payout.ts
git commit -m "fix(payment-worker): fix process-payout retry loop and add exhaustion wallet reversal"
```

---

## Task 4: Wire process-payout into payment worker index

**Files:**
- Modify: `workers/payment-worker/src/index.ts`

- [ ] **Step 1: Import and wire the handler**

Replace the entire file:

```typescript
import { Worker } from 'bullmq';
import { connection } from './queue';
import { handleEscrowHold } from './jobs/escrow-hold';
import { handleEscrowRelease } from './jobs/escrow-release';
import { handleRefund } from './jobs/refund';
import { handleProvisionDva } from './jobs/provision-dva';
import { handleNotifyTopup } from './jobs/notify-topup';
import { handleProcessPayout } from './jobs/process-payout';
import type {
  PaymentJobName,
  EscrowHoldJobData,
  EscrowReleaseJobData,
  RefundJobData,
  ProvisionDvaJobData,
  NotifyTopupJobData,
  ProcessPayoutJobData,
} from './queue';
import type { Job } from 'bullmq';

type PaymentJobData =
  | EscrowHoldJobData
  | EscrowReleaseJobData
  | RefundJobData
  | ProvisionDvaJobData
  | NotifyTopupJobData
  | ProcessPayoutJobData;

const worker = new Worker<PaymentJobData, void, PaymentJobName>(
  'payment',
  async (job) => {
    switch (job.name) {
      case 'escrow-hold':    return handleEscrowHold(job.data as EscrowHoldJobData);
      case 'escrow-release': return handleEscrowRelease(job.data as EscrowReleaseJobData);
      case 'refund':         return handleRefund(job.data as RefundJobData);
      case 'provision-dva':  return handleProvisionDva(job.data as ProvisionDvaJobData);
      case 'notify-topup':   return handleNotifyTopup(job.data as NotifyTopupJobData);
      case 'process-payout': return handleProcessPayout(job as Job<ProcessPayoutJobData>);
      default:
        throw new Error(`Unknown job name: ${String(job.name)}`);
    }
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job) => console.log(`✅ Job ${job.id} (${job.name}) completed`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} (${job?.name}) failed:`, err));

console.log('💰 Payment worker started');
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @surewaka/payment-worker typecheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workers/payment-worker/src/index.ts
git commit -m "feat(payment-worker): wire process-payout job handler"
```

---

## Task 5: Enqueue job from POST /payouts/request

**Files:**
- Modify: `apps/api/src/routes/payouts.ts`
- Modify: `apps/api/src/__tests__/payouts-routes.test.ts`

- [ ] **Step 1: Write a failing test for job enqueue**

In `apps/api/src/__tests__/payouts-routes.test.ts`, add at the top of the mocks:

```typescript
const mockEnqueuePaymentJob = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/queue-client', () => ({
  enqueuePaymentJob: (...a: unknown[]) => mockEnqueuePaymentJob(...a),
}));
```

Add this test inside `describe('Payouts routes', ...)`:

```typescript
it('POST /request enqueues process-payout job on 201', async () => {
  mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
  mockDebitWallet.mockResolvedValue({ id: 'txn-1' });

  await app.request('/api/v1/payouts/request', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 100000, bank_code: '058', account_number: '0123456789', account_name: 'Test Driver' }),
  });

  expect(mockEnqueuePaymentJob).toHaveBeenCalledWith('process-payout', { payoutRequestId: 'payout-1' });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm --filter @surewaka/api test payouts-routes 2>&1 | tail -20
```

Expected: FAIL — `mockEnqueuePaymentJob` not called.

- [ ] **Step 3: Add enqueue to the payout route**

In `apps/api/src/routes/payouts.ts`, add the import at the top:

```typescript
import { enqueuePaymentJob } from '../lib/queue-client';
```

In the `post('/request', ...)` handler, after the transaction resolves, add the enqueue call:

```typescript
    return payout;
  });

  await enqueuePaymentJob('process-payout', { payoutRequestId: payout.id });

  return c.json({ data: payout, error: null, meta: null }, 201);
```

The full updated handler after the transaction block:

```typescript
    const payout = await db.transaction(async (tx) => {
      await debitWallet(
        wallet.id,
        parsed.data.amount,
        'payout',
        reference,
        `Payout to ${parsed.data.account_name} (${parsed.data.bank_code})`,
        {},
        tx,
      );

      const [inserted] = await tx
        .insert(payoutRequests)
        .values({
          walletId: wallet.id,
          amount: parsed.data.amount,
          bankCode: parsed.data.bank_code,
          accountNumber: parsed.data.account_number,
          accountName: parsed.data.account_name,
          status: 'pending',
        })
        .returning();

      return inserted;
    });

    await enqueuePaymentJob('process-payout', { payoutRequestId: payout.id });

    return c.json({ data: payout, error: null, meta: null }, 201);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @surewaka/api test payouts-routes 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/payouts.ts apps/api/src/__tests__/payouts-routes.test.ts
git commit -m "feat(payouts): enqueue process-payout job on withdrawal request"
```

---

## Task 6: Add `wallet_withdrawal` push notification type

**Files:**
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add the new push type to all relevant constants**

In `packages/shared/src/constants.ts`:

Add `'wallet_withdrawal'` to `PUSH_NOTIFICATION_TYPES`:
```typescript
export const PUSH_NOTIFICATION_TYPES = [
  'delivery_status_change',
  'delivery_cancelled',
  'driver_arrived',
  'payment_received',
  'dispute_opened',
  'delivery_assigned',
  'carrier_verified',
  'weight_correction',
  'broadcast',
  'system_alert',
  'wallet_withdrawal',
] as const;
```

Add to `PUSH_DEEP_LINK_MAP`:
```typescript
export const PUSH_DEEP_LINK_MAP: Record<PushNotificationType, string> = {
  // ... existing entries ...
  wallet_withdrawal: '/wallet',
};
```

Add to `PUSH_APP_ROUTING`:
```typescript
export const PUSH_APP_ROUTING: Record<PushNotificationType, PushTargetApp | 'all'> = {
  // ... existing entries ...
  wallet_withdrawal: 'all', // both customer and driver apps can withdraw
};
```

- [ ] **Step 2: Typecheck shared package**

```bash
pnpm --filter @surewaka/shared typecheck 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat(shared): add wallet_withdrawal push notification type"
```

---

## Task 7: Add payout push trigger functions

**Files:**
- Modify: `apps/api/src/services/push-triggers.ts`

- [ ] **Step 1: Add payout notification functions**

Append to the bottom of `apps/api/src/services/push-triggers.ts`:

```typescript
// ─── Payout Completed ────────────────────────────────────────────────────────

/**
 * Notify user when their payout transfer succeeds.
 *
 * @param payoutRequestId - The payout_requests UUID (used as resourceId)
 * @param userId - The user's UUID (from wallets.userId)
 * @param amount - Amount in kobo
 */
export async function notifyPayoutCompleted(
  payoutRequestId: string,
  userId: string,
  amount: number,
): Promise<boolean> {
  const formatted = `₦${(amount / 100).toLocaleString('en-NG')}`;
  const payload = buildPayload(
    'wallet_withdrawal',
    'Withdrawal Successful',
    `Your ${formatted} withdrawal is on its way to your bank account.`,
    payoutRequestId,
  );
  return enqueuePush(userId, 'wallet_withdrawal', payload);
}

// ─── Payout Failed / Reversed ────────────────────────────────────────────────

/**
 * Notify user when their payout transfer fails or is reversed.
 *
 * @param payoutRequestId - The payout_requests UUID (used as resourceId)
 * @param userId - The user's UUID (from wallets.userId)
 * @param amount - Amount in kobo
 * @param reason - 'failed' | 'reversed'
 */
export async function notifyPayoutFailed(
  payoutRequestId: string,
  userId: string,
  amount: number,
  reason: 'failed' | 'reversed',
): Promise<boolean> {
  const formatted = `₦${(amount / 100).toLocaleString('en-NG')}`;
  const body =
    reason === 'reversed'
      ? `Your ${formatted} withdrawal was returned by the bank. Your wallet has been refunded.`
      : `Your ${formatted} withdrawal could not be completed. Your wallet has been refunded.`;

  const payload = buildPayload(
    'wallet_withdrawal',
    'Withdrawal Failed',
    body,
    payoutRequestId,
  );
  return enqueuePush(userId, 'wallet_withdrawal', payload);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @surewaka/api typecheck 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/push-triggers.ts
git commit -m "feat(push): add notifyPayoutCompleted and notifyPayoutFailed triggers"
```

---

## Task 8: Handle transfer webhooks

**Files:**
- Modify: `apps/api/src/routes/webhook.ts`
- Modify: `apps/api/src/__tests__/webhook-routes.test.ts`

- [ ] **Step 1: Write failing tests for transfer events**

In `apps/api/src/__tests__/webhook-routes.test.ts`, add to the mocks at the top:

```typescript
const mockUpdatePayoutRequests = vi.fn();
const mockNotifyPayoutCompleted = vi.fn().mockResolvedValue(true);
const mockNotifyPayoutFailed = vi.fn().mockResolvedValue(true);

vi.mock('../services/push-triggers', () => ({
  notifyPayoutCompleted: (...a: unknown[]) => mockNotifyPayoutCompleted(...a),
  notifyPayoutFailed: (...a: unknown[]) => mockNotifyPayoutFailed(...a),
}));
```

Update the `@surewaka/db` mock to include `payoutRequests` and `wallets`:

```typescript
vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ balance: 500000 }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
      for: vi.fn().mockReturnThis(),
    })),
  },
  walletTransactions: 'wallet_transactions',
  wallets: 'wallets',
  users: 'users',
  payoutRequests: 'payout_requests',
  eq: vi.fn(),
}));
```

Add a helper and three new tests:

```typescript
function makeTransferPayload(event: string, transferCode: string, status: string) {
  return JSON.stringify({
    event,
    data: {
      transfer_code: transferCode,
      amount: 100000,
      status,
      recipient: { recipient_code: 'RCP_test' },
      complete_message: event === 'transfer.failed' ? 'Transfer could not be completed' : undefined,
    },
  });
}

describe('Webhook — Paystack transfer events', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('transfer.success marks payout completed and notifies user', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'where' as never).mockResolvedValueOnce([
      { id: 'payout-1', walletId: 'wallet-1', amount: 100000, status: 'processing', userId: 'user-1' },
    ] as never);

    const body = makeTransferPayload('transfer.success', 'TRF_abc123', 'success');
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockNotifyPayoutCompleted).toHaveBeenCalledWith('payout-1', 'user-1', 100000);
  });

  it('transfer.failed marks payout failed, refunds wallet, notifies user', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'where' as never).mockResolvedValueOnce([
      { id: 'payout-1', walletId: 'wallet-1', amount: 100000, status: 'processing', userId: 'user-1' },
    ] as never);

    const body = makeTransferPayload('transfer.failed', 'TRF_abc123', 'failed');
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockNotifyPayoutFailed).toHaveBeenCalledWith('payout-1', 'user-1', 100000, 'failed');
  });

  it('transfer.reversed marks payout reversed, refunds wallet, notifies user', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'where' as never).mockResolvedValueOnce([
      { id: 'payout-1', walletId: 'wallet-1', amount: 100000, status: 'completed', userId: 'user-1' },
    ] as never);

    const body = makeTransferPayload('transfer.reversed', 'TRF_abc123', 'reversed');
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockNotifyPayoutFailed).toHaveBeenCalledWith('payout-1', 'user-1', 100000, 'reversed');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @surewaka/api test webhook-routes 2>&1 | tail -20
```

Expected: the three new transfer tests FAIL.

- [ ] **Step 3: Implement transfer webhook handlers**

Replace `apps/api/src/routes/webhook.ts` with:

```typescript
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, walletTransactions, wallets, users, payoutRequests } from '@surewaka/db';
import { sql } from 'drizzle-orm';
import { verifyWebhookSignature } from '../lib/paystack';
import { getWalletByUserId, creditWallet } from '../lib/wallet-service';
import { paystackWebhookSchema } from '@surewaka/shared';
import { notifyPayoutCompleted, notifyPayoutFailed } from '../services/push-triggers';

const webhookRoutes = new Hono();

webhookRoutes.post('/paystack', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return c.json({ data: null, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' }, meta: null }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ data: null, error: { code: 'INVALID_JSON', message: 'Invalid JSON body' }, meta: null }, 400);
  }

  const parsed = paystackWebhookSchema.safeParse(payload);
  if (!parsed.success) return c.json({ data: { ok: true }, error: null, meta: null });

  const { event, data } = parsed.data;

  // ── charge.success — wallet top-up ──────────────────────────────────────────
  if (event === 'charge.success') {
    // Idempotency: skip if reference already processed
    const existing = await db
      .select({ id: walletTransactions.id })
      .from(walletTransactions)
      .where(eq(walletTransactions.reference, data.reference ?? ''));

    if (existing.length > 0) return c.json({ data: { ok: true }, error: null, meta: null });

    try {
      const rawUserId = data.metadata?.['user_id'];
      const userId = typeof rawUserId === 'string' ? rawUserId : undefined;
      let resolvedUserId: string | undefined = userId;

      if (!resolvedUserId) {
        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, data.customer?.email ?? ''));

        if (!user) {
          console.error(`[webhook] No user found for email ${data.customer?.email}`);
          return c.json({ data: { ok: true }, error: null, meta: null });
        }
        resolvedUserId = user.id;
      }

      const wallet = await getWalletByUserId(resolvedUserId);
      await creditWallet(
        wallet.id,
        data.amount ?? 0,
        'fund',
        data.reference ?? '',
        'Wallet top-up via Paystack',
        data.metadata ?? {},
      );
    } catch (err) {
      console.error('[webhook] Failed to process charge.success', err);
    }

    return c.json({ data: { ok: true }, error: null, meta: null });
  }

  // ── transfer events — payout callbacks ──────────────────────────────────────
  if (event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') {
    const transferCode = data.transfer_code;
    if (!transferCode) return c.json({ data: { ok: true }, error: null, meta: null });

    try {
      const rows = await db
        .select({
          id: payoutRequests.id,
          walletId: payoutRequests.walletId,
          amount: payoutRequests.amount,
          status: payoutRequests.status,
          userId: wallets.userId,
        })
        .from(payoutRequests)
        .innerJoin(wallets, eq(wallets.id, payoutRequests.walletId))
        .where(eq(payoutRequests.paystackTransferCode, transferCode));

      if (rows.length === 0) {
        console.warn(`[webhook] No payout found for transfer_code ${transferCode}`);
        return c.json({ data: { ok: true }, error: null, meta: null });
      }

      const payout = rows[0];

      // Idempotency: skip if already in target terminal state
      if (
        (event === 'transfer.success' && payout.status === 'completed') ||
        (event === 'transfer.failed' && payout.status === 'failed') ||
        (event === 'transfer.reversed' && payout.status === 'reversed')
      ) {
        return c.json({ data: { ok: true }, error: null, meta: null });
      }

      if (event === 'transfer.success') {
        await db
          .update(payoutRequests)
          .set({ status: 'completed', processedAt: new Date() })
          .where(eq(payoutRequests.id, payout.id));

        await notifyPayoutCompleted(payout.id, payout.userId, payout.amount).catch((e) =>
          console.error('[webhook] notifyPayoutCompleted failed', e),
        );
      } else {
        // transfer.failed or transfer.reversed — re-credit wallet
        const newStatus = event === 'transfer.reversed' ? 'reversed' : 'failed';
        const failureReason = event === 'transfer.reversed'
          ? 'Transfer reversed by receiving bank'
          : (data.complete_message ?? 'Transfer failed');

        await db.transaction(async (tx) => {
          const [wallet] = await tx
            .select({ balance: wallets.balance })
            .from(wallets)
            .where(eq(wallets.id, payout.walletId))
            .for('update');

          if (!wallet) throw new Error(`Wallet ${payout.walletId} not found`);
          const newBalance = Number(wallet.balance) + payout.amount;

          await tx
            .update(wallets)
            .set({ balance: newBalance, updatedAt: new Date() })
            .where(eq(wallets.id, payout.walletId));

          await tx.insert(walletTransactions).values({
            walletId: payout.walletId,
            type: 'payout_reversal',
            amount: payout.amount,
            balanceAfter: newBalance,
            reference: `reversal_${payout.id}`,
            description: failureReason,
          });

          await tx
            .update(payoutRequests)
            .set({ status: newStatus, failureReason, processedAt: new Date() })
            .where(eq(payoutRequests.id, payout.id));
        });

        const notifyReason = event === 'transfer.reversed' ? 'reversed' : 'failed';
        await notifyPayoutFailed(payout.id, payout.userId, payout.amount, notifyReason).catch((e) =>
          console.error('[webhook] notifyPayoutFailed failed', e),
        );
      }
    } catch (err) {
      console.error(`[webhook] Failed to process ${event}`, err);
    }

    return c.json({ data: { ok: true }, error: null, meta: null });
  }

  return c.json({ data: { ok: true }, error: null, meta: null });
});

export default webhookRoutes;
```

- [ ] **Step 4: Run all webhook tests**

```bash
pnpm --filter @surewaka/api test webhook-routes 2>&1 | tail -30
```

Expected: all tests PASS including the three new transfer tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/webhook.ts apps/api/src/__tests__/webhook-routes.test.ts
git commit -m "feat(webhook): handle transfer.success, transfer.failed, transfer.reversed"
```

---

## Task 9: Admin payouts list + wire route

**Files:**
- Create: `apps/api/src/routes/admin/payouts.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create the admin payouts route**

Create `apps/api/src/routes/admin/payouts.ts`:

```typescript
import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { db, payoutRequests, wallets, users } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const adminPayoutRoutes = new Hono<Env>();
adminPayoutRoutes.use('*', requireAuth);
adminPayoutRoutes.use('*', requireRole('surewaka_admin'));

adminPayoutRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  try {
    const query = db
      .select({
        id: payoutRequests.id,
        amount: payoutRequests.amount,
        bankCode: payoutRequests.bankCode,
        accountNumber: payoutRequests.accountNumber,
        accountName: payoutRequests.accountName,
        status: payoutRequests.status,
        failureReason: payoutRequests.failureReason,
        paystackTransferCode: payoutRequests.paystackTransferCode,
        paystackRecipientCode: payoutRequests.paystackRecipientCode,
        createdAt: payoutRequests.createdAt,
        processedAt: payoutRequests.processedAt,
        userId: wallets.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(payoutRequests)
      .innerJoin(wallets, eq(wallets.id, payoutRequests.walletId))
      .innerJoin(users, eq(users.id, wallets.userId))
      .orderBy(desc(payoutRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const rows = status
      ? await query.where(eq(payoutRequests.status, status))
      : await query;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(payoutRequests)
      .where(status ? eq(payoutRequests.status, status) : sql`true`);

    return c.json({
      data: rows,
      error: null,
      meta: { total: count, limit, offset },
    });
  } catch (err) {
    console.error('[GET /admin/payouts]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payouts' }, meta: null },
      500,
    );
  }
});

export default adminPayoutRoutes;
```

- [ ] **Step 2: Wire into index.ts**

In `apps/api/src/index.ts`, add the import after `adminCarrierRateRoutes`:

```typescript
import adminPayoutRoutes from './routes/admin/payouts';
```

Add the route mount inside the API routes section:

```typescript
app.route('/api/v1/admin/payouts', adminPayoutRoutes);
```

- [ ] **Step 3: Typecheck the API**

```bash
pnpm --filter @surewaka/api typecheck 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Run the full API test suite**

```bash
pnpm --filter @surewaka/api test 2>&1 | tail -30
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/payouts.ts apps/api/src/index.ts
git commit -m "feat(admin): add read-only payout list endpoint at GET /api/v1/admin/payouts"
```

---

## Verification Checklist

After all tasks complete, confirm end-to-end:

- [ ] `payout_reversal` value exists in Postgres: `SELECT unnest(enum_range(NULL::transaction_type));`
- [ ] `reversed` accepted by `payout_requests.status` check: insert a test row with status `reversed`
- [ ] `POST /payouts/request` returns 201 and `process-payout` appears in BullMQ queue
- [ ] `GET /api/v1/admin/payouts` returns 200 with pagination meta (requires `surewaka_admin` role)
- [ ] `GET /api/v1/admin/payouts?status=pending` filters correctly
- [ ] Confirm Paystack test mode: initiate a test transfer and verify `transfer.success` webhook fires and updates the row
