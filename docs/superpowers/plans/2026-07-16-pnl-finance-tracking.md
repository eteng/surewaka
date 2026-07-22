# P&L / Finance Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete P&L tracking system — real-time ledger events for revenue and operational costs, a daily infrastructure cost cron, a Finance API, and an admin Finance page.

**Architecture:** A `platform_ledger` table captures revenue/expense events in real time via three wiring points (escrow release, transfer webhook, charge webhook). A `cost_snapshots` table holds daily infrastructure costs pulled from 5 provider APIs. Four admin API endpoints aggregate both tables for the Finance page.

**Tech Stack:** Drizzle ORM + NeonDB, BullMQ + Redis, Hono (API), React Router v7 + Recharts (admin), Vitest (tests)

**Phase dependencies:** Phase 2 and Phase 3 can run in parallel once Phase 1 is complete. Phase 1 is the prerequisite for both.

---

## File Map

### Phase 1 — Schema + Ledger infrastructure + Event wiring

| Action | File | Responsibility |
|---|---|---|
| Create | `packages/db/src/schema/platform-ledger.ts` | platform_ledger Drizzle table |
| Create | `packages/db/src/schema/cost-snapshots.ts` | cost_snapshots Drizzle table |
| Modify | `packages/db/src/schema/index.ts` | Re-export new schemas |
| Create | `packages/db/drizzle/0009_*.sql` | Migration (auto-generated) |
| Create | `apps/api/src/lib/paystack-fees.ts` | Pure fee calculation functions |
| Create | `apps/api/src/__tests__/paystack-fees.test.ts` | Fee formula unit tests |
| Create | `apps/api/src/lib/ledger.ts` | Ledger BullMQ queue + writeLedgerEvent (API side) |
| Create | `workers/payment-worker/src/ledger.ts` | Ledger BullMQ queue + writeLedgerEvent (worker side) |
| Modify | `workers/payment-worker/src/index.ts` | Add ledger retry worker |
| Modify | `workers/payment-worker/src/jobs/escrow-release.ts` | Wire revenue/commission event |
| Modify | `workers/payment-worker/src/jobs/refund.ts` | Wire expense/commission_reversal event |
| Modify | `apps/api/src/routes/webhook.ts` | Wire revenue/withdrawal_fee, expense/paystack_transfer, expense/paystack_collection |

### Phase 2 — Infrastructure cost cron

| Action | File | Responsibility |
|---|---|---|
| Create | `workers/cron/src/queue.ts` | BullMQ queue + connection for cron |
| Modify | `workers/cron/src/index.ts` | Seed repeating job + start worker |
| Create | `workers/cron/src/lib/exchange-rate.ts` | Fetch mid-market USD/NGN rate |
| Create | `workers/cron/src/jobs/sync-infra-costs/providers/fly.ts` | Fly.io daily cost |
| Create | `workers/cron/src/jobs/sync-infra-costs/providers/neon.ts` | NeonDB daily cost |
| Create | `workers/cron/src/jobs/sync-infra-costs/providers/vercel.ts` | Vercel daily cost |
| Create | `workers/cron/src/jobs/sync-infra-costs/providers/clerk.ts` | Clerk estimated daily cost |
| Create | `workers/cron/src/jobs/sync-infra-costs/providers/ably.ts` | Ably estimated daily cost |
| Create | `workers/cron/src/jobs/sync-infra-costs/index.ts` | Main cron job orchestrator |

### Phase 3 — Finance API + Admin page

| Action | File | Responsibility |
|---|---|---|
| Create | `apps/api/src/routes/admin/finance.ts` | All 4 finance endpoints |
| Modify | `apps/api/src/index.ts` | Register finance routes |
| Create | `apps/admin/app/hooks/use-finance.ts` | Data fetching hook |
| Create | `apps/admin/app/routes/finance.tsx` | Finance page component |
| Modify | `apps/admin/app/components/app-sidebar.tsx` | Add Finance nav item |
| Modify | `apps/admin/app/routes/layout.tsx` | Add /finance to routeTitles |

---

## Phase 1: Schema + Ledger Infrastructure + Event Wiring

---

### Task 1: DB schema — `platform_ledger` + `cost_snapshots`

**Files:**
- Create: `packages/db/src/schema/platform-ledger.ts`
- Create: `packages/db/src/schema/cost-snapshots.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `platform-ledger.ts`**

```typescript
// packages/db/src/schema/platform-ledger.ts
import { pgTable, uuid, text, bigint, timestamp, unique, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const platformLedger = pgTable(
  'platform_ledger',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    category: text().notNull(),
    type: text().notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'number' }).notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceType: text('source_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('platform_ledger_source_category_type_key').on(table.sourceId, table.category, table.type),
    index('idx_platform_ledger_occurred_at').using('btree', table.occurredAt),
    index('idx_platform_ledger_category_type').using('btree', table.category, table.type),
    check('platform_ledger_category_check', sql`category IN ('revenue', 'expense')`),
    check('platform_ledger_amount_check', sql`amount_kobo > 0`),
    check(
      'platform_ledger_type_check',
      sql`type IN ('commission', 'withdrawal_fee', 'paystack_transfer', 'paystack_collection', 'commission_reversal')`,
    ),
  ],
);
```

- [ ] **Step 2: Create `cost-snapshots.ts`**

```typescript
// packages/db/src/schema/cost-snapshots.ts
import { pgTable, uuid, text, bigint, numeric, date, jsonb, timestamp, unique, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const costSnapshots = pgTable(
  'cost_snapshots',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    provider: text().notNull(),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 4 }).notNull(),
    usdToNgnRate: numeric('usd_to_ngn_rate', { precision: 10, scale: 2 }).notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'number' }).notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    rawResponse: jsonb('raw_response').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('cost_snapshots_provider_date_key').on(table.provider, table.snapshotDate),
    index('idx_cost_snapshots_snapshot_date').using('btree', table.snapshotDate),
    check(
      'cost_snapshots_provider_check',
      sql`provider IN ('vercel', 'fly', 'neon', 'clerk', 'ably')`,
    ),
    check('cost_snapshots_amount_check', sql`amount_kobo >= 0`),
  ],
);
```

- [ ] **Step 3: Re-export from schema index**

In `packages/db/src/schema/index.ts`, add:
```typescript
export * from './platform-ledger';
export * from './cost-snapshots';
```

- [ ] **Step 4: Generate + apply migration**

```bash
pnpm --filter @surewaka/db db:generate
pnpm --filter @surewaka/db db:migrate
```

Expected: migration file `packages/db/drizzle/0009_*.sql` created and applied. Verify output contains `CREATE TABLE platform_ledger` and `CREATE TABLE cost_snapshots`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/platform-ledger.ts \
        packages/db/src/schema/cost-snapshots.ts \
        packages/db/src/schema/index.ts \
        packages/db/drizzle/
git commit -m "feat(db): add platform_ledger and cost_snapshots schemas"
```

---

### Task 2: Paystack fee helpers (pure functions + tests)

**Files:**
- Create: `apps/api/src/lib/paystack-fees.ts`
- Create: `apps/api/src/__tests__/paystack-fees.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/__tests__/paystack-fees.test.ts
import { describe, it, expect } from 'vitest';
import { paystackTransferFee, paystackCollectionFee } from '../lib/paystack-fees';

describe('paystackTransferFee', () => {
  it('charges ₦10 for transfers ≤ ₦5,000', () => {
    expect(paystackTransferFee(500000)).toBe(1000);   // exactly ₦5,000
    expect(paystackTransferFee(100000)).toBe(1000);   // ₦1,000
  });

  it('charges ₦25 for transfers ₦5,001–₦50,000', () => {
    expect(paystackTransferFee(500100)).toBe(2500);   // ₦5,001
    expect(paystackTransferFee(5000000)).toBe(2500);  // ₦50,000
  });

  it('charges ₦50 for transfers > ₦50,000', () => {
    expect(paystackTransferFee(5000100)).toBe(5000);  // ₦50,001 — no stamp duty
  });

  it('adds ₦50 stamp duty for transfers > ₦10,000', () => {
    expect(paystackTransferFee(1000100)).toBe(2500 + 5000);  // ₦10,001 — ₦25 + ₦50 stamp
    expect(paystackTransferFee(5000100)).toBe(5000 + 5000);  // ₦50,001 — ₦50 + ₦50 stamp
  });

  it('no stamp duty for transfers ≤ ₦10,000', () => {
    expect(paystackTransferFee(1000000)).toBe(2500);  // exactly ₦10,000 — ₦25, no stamp
  });
});

describe('paystackCollectionFee', () => {
  describe('card channel', () => {
    it('charges 0 for amounts ≤ ₦2,500', () => {
      expect(paystackCollectionFee(250000, 'card')).toBe(0);
      expect(paystackCollectionFee(100000, 'card')).toBe(0);
    });

    it('charges 1.5% + ₦100 for amounts > ₦2,500', () => {
      expect(paystackCollectionFee(1000000, 'card')).toBe(Math.round(1000000 * 0.015) + 10000); // ₦10,000 → ₦250
    });

    it('caps at ₦2,000 for large amounts', () => {
      expect(paystackCollectionFee(50000000, 'card')).toBe(200000); // ₦500,000 → cap at ₦2,000
    });
  });

  describe('dedicated_nuban channel (DVA)', () => {
    it('charges flat ₦50 regardless of amount', () => {
      expect(paystackCollectionFee(100000, 'dedicated_nuban')).toBe(5000);
      expect(paystackCollectionFee(50000000, 'dedicated_nuban')).toBe(5000);
    });
  });

  describe('unknown channel defaults to card formula', () => {
    it('treats unknown channels as card', () => {
      expect(paystackCollectionFee(250000, 'mobile_money')).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run src/__tests__/paystack-fees.test.ts
```
Expected: FAIL with "Cannot find module '../lib/paystack-fees'"

- [ ] **Step 3: Implement fee helpers**

```typescript
// apps/api/src/lib/paystack-fees.ts

export function paystackTransferFee(amountKobo: number): number {
  let baseFee: number;
  if (amountKobo <= 500000) {
    baseFee = 1000;       // ₦10
  } else if (amountKobo <= 5000000) {
    baseFee = 2500;       // ₦25
  } else {
    baseFee = 5000;       // ₦50
  }
  const stampDuty = amountKobo > 1000000 ? 5000 : 0;  // ₦50 for > ₦10,000
  return baseFee + stampDuty;
}

export function paystackCollectionFee(amountKobo: number, channel: string): number {
  if (channel === 'dedicated_nuban') return 5000;  // flat ₦50
  if (amountKobo <= 250000) return 0;              // ≤ ₦2,500 waived
  return Math.min(Math.round(amountKobo * 0.015) + 10000, 200000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run src/__tests__/paystack-fees.test.ts
```
Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/paystack-fees.ts apps/api/src/__tests__/paystack-fees.test.ts
git commit -m "feat(api): add Paystack fee calculation helpers"
```

---

### Task 3: Ledger write infrastructure

**Files:**
- Create: `apps/api/src/lib/ledger.ts`
- Create: `workers/payment-worker/src/ledger.ts`
- Modify: `workers/payment-worker/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/lib/ledger.ts`**

```typescript
// apps/api/src/lib/ledger.ts
import { Queue } from 'bullmq';
import { db, platformLedger } from '@surewaka/db';

const ledgerQueue = new Queue('ledger', {
  connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
});

export type LedgerEvent = {
  category: 'revenue' | 'expense';
  type: 'commission' | 'withdrawal_fee' | 'paystack_transfer' | 'paystack_collection' | 'commission_reversal';
  amountKobo: number;
  sourceId: string;
  sourceType: 'escrow_hold' | 'payout_request' | 'wallet_transaction';
};

export async function writeLedgerEvent(event: LedgerEvent): Promise<void> {
  try {
    await db.insert(platformLedger).values({
      category: event.category,
      type: event.type,
      amountKobo: event.amountKobo,
      sourceId: event.sourceId,
      sourceType: event.sourceType,
      occurredAt: new Date(),
    }).onConflictDoNothing();
  } catch (err) {
    console.error('[Ledger] Direct write failed, enqueueing retry:', err);
    try {
      await ledgerQueue.add('write-ledger-event', event, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: false,
      });
    } catch (e) {
      console.error('[Ledger] Retry enqueue also failed — event may be lost:', e);
    }
  }
}
```

- [ ] **Step 2: Create `workers/payment-worker/src/ledger.ts`**

```typescript
// workers/payment-worker/src/ledger.ts
import { Queue } from 'bullmq';
import { db, platformLedger } from '@surewaka/db';
import { connection } from './queue';

const ledgerQueue = new Queue('ledger', { connection });

export type LedgerEvent = {
  category: 'revenue' | 'expense';
  type: 'commission' | 'withdrawal_fee' | 'paystack_transfer' | 'paystack_collection' | 'commission_reversal';
  amountKobo: number;
  sourceId: string;
  sourceType: 'escrow_hold' | 'payout_request' | 'wallet_transaction';
};

export async function writeLedgerEvent(event: LedgerEvent): Promise<void> {
  try {
    await db.insert(platformLedger).values({
      category: event.category,
      type: event.type,
      amountKobo: event.amountKobo,
      sourceId: event.sourceId,
      sourceType: event.sourceType,
      occurredAt: new Date(),
    }).onConflictDoNothing();
  } catch (err) {
    console.error('[Ledger] Direct write failed, enqueueing retry:', err);
    try {
      await ledgerQueue.add('write-ledger-event', event, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: false,
      });
    } catch (e) {
      console.error('[Ledger] Retry enqueue also failed — event may be lost:', e);
    }
  }
}
```

- [ ] **Step 3: Add ledger retry worker to `workers/payment-worker/src/index.ts`**

Add after the existing `worker` declaration:
```typescript
import { writeLedgerEvent } from './ledger';

// Ledger retry worker — processes failed direct-write events from the 'ledger' queue
const ledgerWorker = new Worker<LedgerEvent>('ledger', async (job) => {
  await db.insert(platformLedger).values({
    category: job.data.category,
    type: job.data.type,
    amountKobo: job.data.amountKobo,
    sourceId: job.data.sourceId,
    sourceType: job.data.sourceType,
    occurredAt: new Date(),
  }).onConflictDoNothing();
}, { connection, concurrency: 2 });

ledgerWorker.on('failed', (job, err) => console.error(`[LedgerWorker] Job ${job?.id} failed:`, err));
```

Also add the required imports at the top of `workers/payment-worker/src/index.ts`:
```typescript
import { db, platformLedger } from '@surewaka/db';
import type { LedgerEvent } from './ledger';
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/ledger.ts \
        workers/payment-worker/src/ledger.ts \
        workers/payment-worker/src/index.ts
git commit -m "feat(ledger): add ledger write infrastructure and retry queue"
```

---

### Task 4: Wire escrow release → revenue/commission

**Files:**
- Modify: `workers/payment-worker/src/jobs/escrow-release.ts`

- [ ] **Step 1: Add ledger write after TX commits in `escrow-release.ts`**

At the top of the file, add import:
```typescript
import { writeLedgerEvent } from '../ledger';
```

After the existing `try { ... }` block that fires the push notification (line ~103), add:
```typescript
  // Ledger: record commission revenue — fire-and-forget, non-blocking
  writeLedgerEvent({
    category: 'revenue',
    type: 'commission',
    amountKobo: commissionAmount,
    sourceId: data.escrowHoldId,
    sourceType: 'escrow_hold',
  }).catch((err) => console.error('[EscrowRelease:Ledger] Failed to write commission event:', err));
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd workers/payment-worker && npx tsc --noEmit 2>&1 | grep -v "__tests__"
```
Expected: no errors from `escrow-release.ts`

- [ ] **Step 3: Commit**

```bash
git add workers/payment-worker/src/jobs/escrow-release.ts
git commit -m "feat(ledger): wire revenue/commission on escrow release"
```

---

### Task 5: Wire refund → expense/commission_reversal

**Files:**
- Modify: `workers/payment-worker/src/jobs/refund.ts`

- [ ] **Step 1: Add commission reversal when escrow was previously released**

At the top, add imports:
```typescript
import { writeLedgerEvent } from '../ledger';
import { escrowHolds } from '@surewaka/db';
```

In `handleRefund`, before the `db.transaction(...)` call, add a check for prior commission:
```typescript
export async function handleRefund(data: RefundJobData) {
  const refundAmount = Math.floor(data.amount * data.rate);
  if (refundAmount <= 0) return { refundAmount: 0 };

  // Check if commission was previously earned (escrow was released before refund)
  const [hold] = await db
    .select({ id: escrowHolds.id, status: escrowHolds.status, commissionAmount: escrowHolds.commissionAmount })
    .from(escrowHolds)
    .where(eq(escrowHolds.deliveryId, data.deliveryId))
    .limit(1);

  const commissionWasEarned = hold?.status === 'released' && (hold.commissionAmount ?? 0) > 0;

  await db.transaction(async (tx) => {
    // ... existing transaction code unchanged ...
  });

  // Ledger: reverse commission if it was previously recognized
  if (commissionWasEarned && hold) {
    writeLedgerEvent({
      category: 'expense',
      type: 'commission_reversal',
      amountKobo: hold.commissionAmount!,
      sourceId: hold.id,
      sourceType: 'escrow_hold',
    }).catch((err) => console.error('[Refund:Ledger] Failed to write commission_reversal:', err));
  }

  return { refundAmount };
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd workers/payment-worker && npx tsc --noEmit 2>&1 | grep -v "__tests__"
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add workers/payment-worker/src/jobs/refund.ts
git commit -m "feat(ledger): wire expense/commission_reversal on refund after release"
```

---

### Task 6: Wire transfer.success → withdrawal fee + Paystack transfer cost

**Files:**
- Modify: `apps/api/src/routes/webhook.ts`

- [ ] **Step 1: Add imports**

At the top of `apps/api/src/routes/webhook.ts`, add:
```typescript
import { writeLedgerEvent } from '../lib/ledger';
import { paystackTransferFee } from '../lib/paystack-fees';
```

- [ ] **Step 2: Add `feeKobo` to the payout select in the transfer handler**

Find the `.select({` block inside the `transfer.success` handler and add `feeKobo`:
```typescript
const rows = await db
  .select({
    id: payoutRequests.id,
    walletId: payoutRequests.walletId,
    amount: payoutRequests.amount,
    feeKobo: payoutRequests.feeKobo,   // ADD THIS
    status: payoutRequests.status,
    userId: wallets.userId,
  })
  .from(payoutRequests)
  .innerJoin(wallets, eq(wallets.id, payoutRequests.walletId))
  .where(eq(payoutRequests.paystackTransferCode, transferCode));
```

- [ ] **Step 3: Write two ledger events after marking payout completed**

Find the block `if (event === 'transfer.success') {` and after the `await notifyPayoutCompleted(...)` call, add:
```typescript
      // Ledger: withdrawal fee revenue + Paystack transfer cost — non-blocking
      if (payout.feeKobo > 0) {
        writeLedgerEvent({
          category: 'revenue',
          type: 'withdrawal_fee',
          amountKobo: payout.feeKobo,
          sourceId: payout.id,
          sourceType: 'payout_request',
        }).catch((err) => console.error('[Webhook:Ledger] withdrawal_fee write failed:', err));
      }

      writeLedgerEvent({
        category: 'expense',
        type: 'paystack_transfer',
        amountKobo: paystackTransferFee(payout.amount),
        sourceId: payout.id,
        sourceType: 'payout_request',
      }).catch((err) => console.error('[Webhook:Ledger] paystack_transfer write failed:', err));
```

- [ ] **Step 4: Verify compilation**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "webhook"
```
Expected: no errors from `webhook.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/webhook.ts
git commit -m "feat(ledger): wire revenue/withdrawal_fee and expense/paystack_transfer on transfer.success"
```

---

### Task 7: Wire charge.success → Paystack collection cost

**Files:**
- Modify: `apps/api/src/routes/webhook.ts`

- [ ] **Step 1: Add `paystackCollectionFee` import** (already imported `paystackTransferFee` in Task 6 — update that import line):

```typescript
import { paystackTransferFee, paystackCollectionFee } from '../lib/paystack-fees';
```

- [ ] **Step 2: Capture wallet transaction ID and write ledger event in charge.success handler**

Find `await creditWallet(...)` in the `charge.success` block. Replace it to capture the returned transaction:
```typescript
      const txn = await creditWallet(
        wallet.id,
        amount,
        'fund',
        reference,
        'Wallet top-up via Paystack',
        data.metadata ?? {},
      );

      // Ledger: Paystack collection cost — non-blocking
      const channel = typeof data.channel === 'string' ? data.channel : 'card';
      const collectionFee = paystackCollectionFee(amount, channel);
      if (collectionFee > 0) {
        writeLedgerEvent({
          category: 'expense',
          type: 'paystack_collection',
          amountKobo: collectionFee,
          sourceId: txn.id,
          sourceType: 'wallet_transaction',
        }).catch((err) => console.error('[Webhook:Ledger] paystack_collection write failed:', err));
      }
```

- [ ] **Step 3: Verify compilation**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "webhook"
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/webhook.ts
git commit -m "feat(ledger): wire expense/paystack_collection on charge.success"
```

---

## Phase 2: Infrastructure Cost Cron

---

### Task 8: BullMQ queue + cron scheduling setup

**Files:**
- Create: `workers/cron/src/queue.ts`
- Modify: `workers/cron/src/index.ts`

- [ ] **Step 1: Create cron queue**

```typescript
// workers/cron/src/queue.ts
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const cronQueue = new Queue('cron', { connection });

export type CronJobName = 'sync-infra-costs';
```

- [ ] **Step 2: Replace `workers/cron/src/index.ts` with scheduler + worker**

```typescript
// workers/cron/src/index.ts
import { Worker } from 'bullmq';
import { cronQueue, connection } from './queue';
import type { CronJobName } from './queue';
import { handleSyncInfraCosts } from './jobs/sync-infra-costs/index';

// Seed repeating job — idempotent (BullMQ deduplicates by jobId)
await cronQueue.add(
  'sync-infra-costs',
  {},
  {
    jobId: 'sync-infra-costs-daily',
    repeat: { pattern: '0 5 * * *' },  // 05:00 UTC daily
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  },
);

const worker = new Worker<Record<string, never>, void, CronJobName>(
  'cron',
  async (job) => {
    switch (job.name) {
      case 'sync-infra-costs':
        return handleSyncInfraCosts();
      default:
        throw new Error(`Unknown cron job: ${String(job.name)}`);
    }
  },
  { connection, concurrency: 1 },
);

worker.on('completed', (job) => console.log(`✅ Cron job ${job.name} completed`));
worker.on('failed', (job, err) => console.error(`❌ Cron job ${job?.name} failed:`, err));

console.log('⏰ Cron worker started — sync-infra-costs scheduled at 05:00 UTC daily');
```

- [ ] **Step 3: Install BullMQ + ioredis in cron worker if not already present**

```bash
cd workers/cron && cat package.json | grep bullmq
```
If not present: `pnpm --filter @surewaka/cron add bullmq ioredis`

- [ ] **Step 4: Commit**

```bash
git add workers/cron/src/queue.ts workers/cron/src/index.ts workers/cron/package.json
git commit -m "feat(cron): bootstrap BullMQ scheduler with daily sync-infra-costs job"
```

---

### Task 9: Exchange rate fetcher

**Files:**
- Create: `workers/cron/src/lib/exchange-rate.ts`

- [ ] **Step 1: Create exchange rate helper**

```typescript
// workers/cron/src/lib/exchange-rate.ts

const EXCHANGE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

export async function getUsdToNgnRate(): Promise<number> {
  try {
    const res = await fetch(EXCHANGE_API_URL);
    if (!res.ok) throw new Error(`Exchange rate API responded ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number> };
    const rate = json.rates['NGN'];
    if (!rate || typeof rate !== 'number') throw new Error('NGN rate missing from response');
    return rate;
  } catch (err) {
    console.error('[ExchangeRate] Primary source failed, trying fallback:', err);
    // Fallback: open.er-api.com (no key needed)
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error(`Fallback exchange rate API responded ${res.status}`);
    const json = (await res.json()) as { rates: Record<string, number> };
    const rate = json.rates['NGN'];
    if (!rate) throw new Error('NGN rate missing from fallback response');
    return rate;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add workers/cron/src/lib/exchange-rate.ts
git commit -m "feat(cron): add USD/NGN mid-market exchange rate fetcher"
```

---

### Task 10: Provider adapters + sync-infra-costs job

**Files:**
- Create: `workers/cron/src/jobs/sync-infra-costs/providers/fly.ts`
- Create: `workers/cron/src/jobs/sync-infra-costs/providers/neon.ts`
- Create: `workers/cron/src/jobs/sync-infra-costs/providers/vercel.ts`
- Create: `workers/cron/src/jobs/sync-infra-costs/providers/clerk.ts`
- Create: `workers/cron/src/jobs/sync-infra-costs/providers/ably.ts`
- Create: `workers/cron/src/jobs/sync-infra-costs/index.ts`

- [ ] **Step 1: Create shared provider type**

```typescript
// workers/cron/src/jobs/sync-infra-costs/providers/types.ts
export type ProviderResult = {
  amountUsd: number;
  rawResponse: unknown;
};
```

- [ ] **Step 2: Create Fly.io provider**

```typescript
// workers/cron/src/jobs/sync-infra-costs/providers/fly.ts
import type { ProviderResult } from './types';

const FLY_GQL = 'https://api.fly.io/graphql';

export async function fetchFlyCost(date: string): Promise<ProviderResult> {
  const query = `
    query {
      organization(slug: "${process.env.CRON_FLY_ORG_SLUG}") {
        billable { amount }
      }
    }
  `;
  const res = await fetch(FLY_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_FLY_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Fly API ${res.status}`);
  const json = await res.json() as { data: { organization: { billable: { amount: number } } } };
  // Fly returns month-to-date; divide by day-of-month for daily estimate
  const dayOfMonth = new Date(date).getDate();
  const mtd = json.data.organization.billable.amount;
  return { amountUsd: mtd / dayOfMonth, rawResponse: json };
}
```

- [ ] **Step 3: Create NeonDB provider**

```typescript
// workers/cron/src/jobs/sync-infra-costs/providers/neon.ts
import type { ProviderResult } from './types';

export async function fetchNeonCost(date: string): Promise<ProviderResult> {
  const projectId = process.env.CRON_NEON_PROJECT_ID;
  const url = `https://console.neon.tech/api/v2/consumption_history/projects?project_ids=${projectId}&from=${date}T00:00:00Z&to=${date}T23:59:59Z&granularity=daily`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.CRON_NEON_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Neon API ${res.status}`);
  const json = await res.json() as { periods: Array<{ consumption: { active_time_seconds: number } }> };
  // Approximate: $0.102/compute-hour; active_time in seconds
  const seconds = json.periods?.[0]?.consumption?.active_time_seconds ?? 0;
  const amountUsd = (seconds / 3600) * 0.102;
  return { amountUsd, rawResponse: json };
}
```

- [ ] **Step 4: Create Vercel provider**

```typescript
// workers/cron/src/jobs/sync-infra-costs/providers/vercel.ts
import type { ProviderResult } from './types';

export async function fetchVercelCost(date: string): Promise<ProviderResult> {
  const url = `https://api.vercel.com/v2/billing/invoices?teamId=${process.env.CRON_VERCEL_TEAM_ID}&limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.CRON_VERCEL_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const json = await res.json() as { invoices: Array<{ total: number; periodStart: string; periodEnd: string }> };
  const invoice = json.invoices?.[0];
  if (!invoice) return { amountUsd: 0, rawResponse: json };
  const days = Math.max(1, Math.ceil((new Date(invoice.periodEnd).getTime() - new Date(invoice.periodStart).getTime()) / 86400000));
  return { amountUsd: invoice.total / days, rawResponse: json };
}
```

- [ ] **Step 5: Create Clerk provider (estimated — monthly ÷ days)**

```typescript
// workers/cron/src/jobs/sync-infra-costs/providers/clerk.ts
import type { ProviderResult } from './types';

export async function fetchClerkCost(_date: string): Promise<ProviderResult> {
  const res = await fetch('https://api.clerk.com/v1/billing/invoices?limit=1', {
    headers: { Authorization: `Bearer ${process.env.CRON_CLERK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Clerk API ${res.status}`);
  const json = await res.json() as { data: Array<{ total: number; period_end: string; period_start: string }> };
  const invoice = json.data?.[0];
  if (!invoice) return { amountUsd: 0, rawResponse: json };
  const days = Math.max(1, Math.ceil((new Date(invoice.period_end).getTime() - new Date(invoice.period_start).getTime()) / 86400000));
  return { amountUsd: invoice.total / days / 100, rawResponse: json };  // Clerk amounts in cents
}
```

- [ ] **Step 6: Create Ably provider (estimated — usage × rate)**

```typescript
// workers/cron/src/jobs/sync-infra-costs/providers/ably.ts
import type { ProviderResult } from './types';

export async function fetchAblyCost(date: string): Promise<ProviderResult> {
  const url = `https://rest.ably.io/stats?start=${date}T00:00:00Z&end=${date}T23:59:59Z&unit=day`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(process.env.CRON_ABLY_API_KEY ?? '').toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Ably API ${res.status}`);
  const json = await res.json() as Array<{ messages: { count: number } }>;
  const messages = json?.[0]?.messages?.count ?? 0;
  const ratePerMillion = parseFloat(process.env.ABLY_COST_PER_MILLION_MESSAGES_USD ?? '0.25');
  return { amountUsd: (messages / 1_000_000) * ratePerMillion, rawResponse: json };
}
```

- [ ] **Step 7: Create the main sync-infra-costs job**

```typescript
// workers/cron/src/jobs/sync-infra-costs/index.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { costSnapshots } from '@surewaka/db';
import { getUsdToNgnRate } from '../../lib/exchange-rate';
import { fetchFlyCost } from './providers/fly';
import { fetchNeonCost } from './providers/neon';
import { fetchVercelCost } from './providers/vercel';
import { fetchClerkCost } from './providers/clerk';
import { fetchAblyCost } from './providers/ably';

const db = drizzle(neon(process.env.DATABASE_URL!));

type Provider = 'vercel' | 'fly' | 'neon' | 'clerk' | 'ably';

const PROVIDERS: Record<Provider, (date: string) => Promise<{ amountUsd: number; rawResponse: unknown }>> = {
  vercel: fetchVercelCost,
  fly: fetchFlyCost,
  neon: fetchNeonCost,
  clerk: fetchClerkCost,
  ably: fetchAblyCost,
};

export async function handleSyncInfraCosts(): Promise<void> {
  // Pull yesterday's costs
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const date = yesterday.toISOString().split('T')[0]!;

  console.log(`[SyncInfraCosts] Syncing costs for ${date}`);

  const rate = await getUsdToNgnRate();
  console.log(`[SyncInfraCosts] USD/NGN rate: ${rate}`);

  for (const [provider, fetcher] of Object.entries(PROVIDERS) as [Provider, (date: string) => Promise<{ amountUsd: number; rawResponse: unknown }>][]) {
    try {
      const { amountUsd, rawResponse } = await fetcher(date);
      const amountKobo = Math.round(amountUsd * rate * 100);

      await db.insert(costSnapshots).values({
        provider,
        amountUsd: String(amountUsd),
        usdToNgnRate: String(rate),
        amountKobo,
        snapshotDate: date,
        rawResponse: rawResponse as Record<string, unknown>,
      }).onConflictDoUpdate({
        target: [costSnapshots.provider, costSnapshots.snapshotDate],
        set: { amountUsd: String(amountUsd), usdToNgnRate: String(rate), amountKobo, rawResponse: rawResponse as Record<string, unknown> },
      });

      console.log(`[SyncInfraCosts] ✅ ${provider}: $${amountUsd.toFixed(4)} → ₦${(amountKobo / 100).toFixed(2)}`);
    } catch (err) {
      console.error(`[SyncInfraCosts] ❌ ${provider} failed — skipping:`, err);
    }
  }
}
```

- [ ] **Step 8: Add required env vars to `.env.example`**

Add to `.env.example`:
```
# Finance cron — infrastructure cost providers
CRON_FLY_TOKEN=
CRON_FLY_ORG_SLUG=surewaka
CRON_NEON_API_KEY=
CRON_NEON_PROJECT_ID=
CRON_VERCEL_TOKEN=
CRON_VERCEL_TEAM_ID=
CRON_CLERK_SECRET_KEY=   # same value as CLERK_SECRET_KEY — separate var for auditability
CRON_ABLY_API_KEY=       # same value as ABLY_API_KEY
ABLY_COST_PER_MILLION_MESSAGES_USD=0.25
```

- [ ] **Step 9: Commit**

```bash
git add workers/cron/src/jobs/ workers/cron/src/lib/ .env.example
git commit -m "feat(cron): add sync-infra-costs job with 5 provider adapters"
```

---

## Phase 3: Finance API + Admin Page

---

### Task 11: Finance API — all 4 endpoints

**Files:**
- Create: `apps/api/src/routes/admin/finance.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/routes/admin/finance.ts`**

```typescript
import { Hono } from 'hono';
import { db, platformLedger, costSnapshots } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { sql, and, gte, lte, desc } from 'drizzle-orm';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const ESTIMATED_PROVIDERS = new Set(['clerk', 'ably']);

const financeRoutes = new Hono<Env>();
financeRoutes.use('*', requireAuth);
financeRoutes.use('*', requireRole('surewaka_admin'));

// ── helpers ──────────────────────────────────────────────────────────────────

function parseDateRange(fromStr?: string, toStr?: string) {
  const now = new Date();
  const from = fromStr
    ? new Date(fromStr + 'T00:00:00Z')
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = toStr
    ? new Date(toStr + 'T23:59:59Z')
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { from, to };
}

function buildSummary(
  revenueRows: { type: string; total: number }[],
  expenseRows: { type: string; total: number }[],
  infraRows: { provider: string; total: number }[],
) {
  const rev = Object.fromEntries(revenueRows.map((r) => [r.type, r.total]));
  const exp = Object.fromEntries(expenseRows.map((r) => [r.type, r.total]));
  const infra = Object.fromEntries(infraRows.map((r) => [r.provider, r.total]));

  const commission = rev['commission'] ?? 0;
  const withdrawalFees = rev['withdrawal_fee'] ?? 0;
  const revenueTotal = commission + withdrawalFees;

  const paystackTransfer = exp['paystack_transfer'] ?? 0;
  const paystackCollection = exp['paystack_collection'] ?? 0;
  const commissionReversal = exp['commission_reversal'] ?? 0;
  const operationalTotal = paystackTransfer + paystackCollection + commissionReversal;

  const vercel = infra['vercel'] ?? 0;
  const fly = infra['fly'] ?? 0;
  const neon = infra['neon'] ?? 0;
  const clerk = infra['clerk'] ?? 0;
  const ably = infra['ably'] ?? 0;
  const infraTotal = vercel + fly + neon + clerk + ably;

  const expensesTotal = operationalTotal + infraTotal;
  const grossProfit = revenueTotal - operationalTotal;
  const netProfit = revenueTotal - expensesTotal;
  const marginPercent = revenueTotal === 0 ? null : Math.round((netProfit / revenueTotal) * 10000) / 100;

  return {
    revenue: { commission, withdrawal_fees: withdrawalFees, total: revenueTotal },
    expenses: {
      operational: { paystack_transfer: paystackTransfer, paystack_collection: paystackCollection, total: operationalTotal },
      infrastructure: { vercel, fly, neon, clerk, ably, total: infraTotal },
      total: expensesTotal,
    },
    summary: {
      revenue: revenueTotal,
      operational_expenses: operationalTotal,
      gross_profit: grossProfit,
      total_expenses: expensesTotal,
      net_profit: netProfit,
      margin_percent: marginPercent,
    },
  };
}

// ── GET /summary ──────────────────────────────────────────────────────────────

financeRoutes.get('/summary', async (c) => {
  const { from, to } = parseDateRange(c.req.query('from'), c.req.query('to'));
  const fromDateStr = from.toISOString().split('T')[0]!;
  const toDateStr = to.toISOString().split('T')[0]!;

  const [revenueRows, expenseRows, infraRows] = await Promise.all([
    db.select({
      type: platformLedger.type,
      total: sql<number>`COALESCE(SUM(${platformLedger.amountKobo}), 0)::bigint`,
    })
      .from(platformLedger)
      .where(and(sql`${platformLedger.category} = 'revenue'`, gte(platformLedger.occurredAt, from), lte(platformLedger.occurredAt, to)))
      .groupBy(platformLedger.type),

    db.select({
      type: platformLedger.type,
      total: sql<number>`COALESCE(SUM(${platformLedger.amountKobo}), 0)::bigint`,
    })
      .from(platformLedger)
      .where(and(sql`${platformLedger.category} = 'expense'`, gte(platformLedger.occurredAt, from), lte(platformLedger.occurredAt, to)))
      .groupBy(platformLedger.type),

    db.select({
      provider: costSnapshots.provider,
      total: sql<number>`COALESCE(SUM(${costSnapshots.amountKobo}), 0)::bigint`,
    })
      .from(costSnapshots)
      .where(and(sql`${costSnapshots.snapshotDate} >= ${fromDateStr}`, sql`${costSnapshots.snapshotDate} <= ${toDateStr}`))
      .groupBy(costSnapshots.provider),
  ]);

  const data = buildSummary(revenueRows, expenseRows, infraRows);
  return c.json({ data: { period: { from: fromDateStr, to: toDateStr }, ...data }, error: null, meta: { currency: 'NGN', unit: 'kobo' } });
});

// ── GET /trend ────────────────────────────────────────────────────────────────

financeRoutes.get('/trend', async (c) => {
  const months = Math.min(Number(c.req.query('months') ?? 6), 12);
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const [ledgerRows, infraRows] = await Promise.all([
    db.select({
      period: sql<string>`to_char(date_trunc('month', ${platformLedger.occurredAt}), 'YYYY-MM')`,
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${platformLedger.category} = 'revenue' THEN ${platformLedger.amountKobo} ELSE 0 END), 0)::bigint`,
      operationalExpenses: sql<number>`COALESCE(SUM(CASE WHEN ${platformLedger.category} = 'expense' THEN ${platformLedger.amountKobo} ELSE 0 END), 0)::bigint`,
    })
      .from(platformLedger)
      .where(gte(platformLedger.occurredAt, since))
      .groupBy(sql`date_trunc('month', ${platformLedger.occurredAt})`)
      .orderBy(sql`date_trunc('month', ${platformLedger.occurredAt})`),

    db.select({
      period: sql<string>`to_char(date_trunc('month', ${costSnapshots.snapshotDate}::timestamp), 'YYYY-MM')`,
      infrastructureExpenses: sql<number>`COALESCE(SUM(${costSnapshots.amountKobo}), 0)::bigint`,
    })
      .from(costSnapshots)
      .where(sql`${costSnapshots.snapshotDate}::date >= ${since.toISOString().split('T')[0]}`)
      .groupBy(sql`date_trunc('month', ${costSnapshots.snapshotDate}::timestamp)`)
      .orderBy(sql`date_trunc('month', ${costSnapshots.snapshotDate}::timestamp)`),
  ]);

  // Merge by period
  const infraByPeriod = Object.fromEntries(infraRows.map((r) => [r.period, r.infrastructureExpenses]));
  const data = ledgerRows.map((row) => {
    const infraExp = infraByPeriod[row.period] ?? 0;
    return {
      period: row.period,
      revenue: row.revenue,
      operational_expenses: row.operationalExpenses,
      infrastructure_expenses: infraExp,
      gross_profit: row.revenue - row.operationalExpenses,
      net_profit: row.revenue - row.operationalExpenses - infraExp,
    };
  });

  return c.json({ data, error: null, meta: { currency: 'NGN', unit: 'kobo', months } });
});

// ── GET /ledger ───────────────────────────────────────────────────────────────

financeRoutes.get('/ledger', async (c) => {
  const { from, to } = parseDateRange(c.req.query('from'), c.req.query('to'));
  const category = c.req.query('category');
  const type = c.req.query('type');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  const filters = [gte(platformLedger.occurredAt, from), lte(platformLedger.occurredAt, to)];
  if (category) filters.push(sql`${platformLedger.category} = ${category}`);
  if (type) filters.push(sql`${platformLedger.type} = ${type}`);

  const [rows, countRows] = await Promise.all([
    db.select().from(platformLedger).where(and(...filters)).orderBy(desc(platformLedger.occurredAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(platformLedger).where(and(...filters)),
  ]);

  return c.json({ data: rows, error: null, meta: { currency: 'NGN', unit: 'kobo', total: countRows[0]?.count ?? 0, limit, offset } });
});

// ── GET /costs ────────────────────────────────────────────────────────────────

financeRoutes.get('/costs', async (c) => {
  const from = c.req.query('from') ?? new Date().toISOString().split('T')[0]!;
  const to = c.req.query('to') ?? from;

  const rows = await db
    .select()
    .from(costSnapshots)
    .where(and(sql`${costSnapshots.snapshotDate} >= ${from}`, sql`${costSnapshots.snapshotDate} <= ${to}`))
    .orderBy(desc(costSnapshots.snapshotDate));

  const data = rows.map((r) => ({
    provider: r.provider,
    amount_usd: parseFloat(r.amountUsd),
    usd_to_ngn_rate: parseFloat(r.usdToNgnRate),
    amount_kobo: r.amountKobo,
    snapshot_date: r.snapshotDate,
    estimated: ESTIMATED_PROVIDERS.has(r.provider),
  }));

  return c.json({ data, error: null, meta: { currency: 'NGN', unit: 'kobo' } });
});

export default financeRoutes;
```

- [ ] **Step 2: Register in `apps/api/src/index.ts`**

Add import:
```typescript
import adminFinanceRoutes from './routes/admin/finance';
```

Add route registration (after the existing `adminPayoutRoutes` line):
```typescript
app.route('/api/v1/admin/finance', adminFinanceRoutes);
```

- [ ] **Step 3: Verify compilation**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "finance"
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts apps/api/src/index.ts
git commit -m "feat(api): add /admin/finance endpoints — summary, trend, ledger, costs"
```

---

### Task 12: Admin Finance page

**Files:**
- Create: `apps/admin/app/hooks/use-finance.ts`
- Create: `apps/admin/app/routes/finance.tsx`
- Modify: `apps/admin/app/components/app-sidebar.tsx`
- Modify: `apps/admin/app/routes/layout.tsx`

- [ ] **Step 1: Create `use-finance.ts` hook**

```typescript
// apps/admin/app/hooks/use-finance.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export type FinanceSummary = {
  period: { from: string; to: string };
  revenue: { commission: number; withdrawal_fees: number; total: number };
  expenses: {
    operational: { paystack_transfer: number; paystack_collection: number; total: number };
    infrastructure: { vercel: number; fly: number; neon: number; clerk: number; ably: number; total: number };
    total: number;
  };
  summary: {
    revenue: number;
    operational_expenses: number;
    gross_profit: number;
    total_expenses: number;
    net_profit: number;
    margin_percent: number | null;
  };
};

export type TrendItem = {
  period: string;
  revenue: number;
  operational_expenses: number;
  infrastructure_expenses: number;
  gross_profit: number;
  net_profit: number;
};

export type LedgerRow = {
  id: string;
  category: string;
  type: string;
  amountKobo: number;
  sourceId: string;
  sourceType: string;
  occurredAt: string;
};

export type CostRow = {
  provider: string;
  amount_usd: number;
  usd_to_ngn_rate: number;
  amount_kobo: number;
  snapshot_date: string;
  estimated: boolean;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function useFinanceSummary(from: string, to: string) {
  const { getToken } = useAuth();
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${API}/api/v1/admin/finance/summary?from=${from}&to=${to}`, { headers: authHeaders(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `${res.status}`);
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load summary');
    } finally {
      setIsLoading(false);
    }
  }, [from, to, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, isLoading, error, refetch: fetch_ };
}

export function useFinanceTrend(months = 6) {
  const { getToken } = useAuth();
  const [data, setData] = useState<TrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${API}/api/v1/admin/finance/trend?months=${months}`, { headers: authHeaders(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `${res.status}`);
      setData(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trend');
    } finally {
      setIsLoading(false);
    }
  }, [months, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, isLoading, error };
}

export function useFinanceLedger(from: string, to: string, category?: string, offset = 0, limit = 50) {
  const { getToken } = useAuth();
  const [data, setData] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const params = new URLSearchParams({ from, to, limit: String(limit), offset: String(offset) });
      if (category) params.set('category', category);
      const res = await fetch(`${API}/api/v1/admin/finance/ledger?${params}`, { headers: authHeaders(token) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `${res.status}`);
      setData(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger');
    } finally {
      setIsLoading(false);
    }
  }, [from, to, category, offset, limit, getToken]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, total, isLoading, error, refetch: fetch_ };
}
```

- [ ] **Step 2: Create `apps/admin/app/routes/finance.tsx`**

```typescript
// apps/admin/app/routes/finance.tsx
import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { cn } from '~/lib/utils';
import { Skeleton } from '~/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Button } from '~/components/ui/button';
import { formatNaira } from '~/lib/format';
import { useFinanceSummary, useFinanceTrend, useFinanceLedger } from '~/hooks/use-finance';

export function meta() {
  return [{ title: 'SureWaka Admin - Finance' }];
}

function currentMonthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0]!;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().split('T')[0]!;
  return { from, to };
}

const CATEGORY_TABS = ['all', 'revenue', 'expense'] as const;
type CategoryTab = (typeof CATEGORY_TABS)[number];

const TYPE_LABELS: Record<string, string> = {
  commission: 'Commission',
  withdrawal_fee: 'Withdrawal Fee',
  paystack_transfer: 'Paystack Transfer',
  paystack_collection: 'Paystack Collection',
  commission_reversal: 'Commission Reversal',
};

const CATEGORY_STYLES: Record<string, string> = {
  revenue: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expense: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function SummaryCard({ label, value, sub, negative }: { label: string; value: string; sub?: string; negative?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', negative && 'text-red-600 dark:text-red-400')}>{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs', negative ? 'text-red-500' : 'text-muted-foreground')}>{sub}</p>}
    </div>
  );
}

export default function FinancePage() {
  const { from, to } = currentMonthRange();
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('all');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const PAGE_SIZE = 50;

  const { data: summary, isLoading: summaryLoading } = useFinanceSummary(from, to);
  const { data: trend, isLoading: trendLoading } = useFinanceTrend(6);
  const { data: ledger, total: ledgerTotal, isLoading: ledgerLoading } = useFinanceLedger(
    from, to,
    categoryTab === 'all' ? undefined : categoryTab,
    ledgerOffset,
    PAGE_SIZE,
  );

  const s = summary?.summary;
  const isNegativeMargin = s && s.margin_percent !== null && s.margin_percent < 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">Revenue, expenses, and net profit — current month</p>
      </div>

      {/* Summary cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard label="Total Revenue" value={formatNaira((s?.revenue ?? 0) / 100)} />
          <SummaryCard label="Total Expenses" value={formatNaira((s?.total_expenses ?? 0) / 100)} />
          <SummaryCard label="Gross Profit" value={formatNaira((s?.gross_profit ?? 0) / 100)} sub="before infrastructure" negative={(s?.gross_profit ?? 0) < 0} />
          <SummaryCard
            label="Net Profit"
            value={formatNaira((s?.net_profit ?? 0) / 100)}
            sub={s?.margin_percent != null ? `${s.margin_percent}% margin` : undefined}
            negative={isNegativeMargin ?? false}
          />
        </div>
      )}

      {/* Breakdown */}
      {!summaryLoading && summary && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Revenue breakdown */}
          <section className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><DollarSign className="h-4 w-4" />Revenue</h2>
            <div className="mt-4 space-y-2">
              {[
                { label: 'Commission', value: summary.revenue.commission },
                { label: 'Withdrawal Fees', value: summary.revenue.withdrawal_fees },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium tabular-nums">{formatNaira(item.value / 100)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatNaira(summary.revenue.total / 100)}</span>
              </div>
            </div>
          </section>

          {/* Expense breakdown */}
          <section className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart2 className="h-4 w-4" />Expenses</h2>
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Operational</p>
              {[
                { label: 'Paystack Transfer', value: summary.expenses.operational.paystack_transfer },
                { label: 'Paystack Collection', value: summary.expenses.operational.paystack_collection },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="tabular-nums">{formatNaira(item.value / 100)}</span>
                </div>
              ))}
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Infrastructure</p>
              {(['vercel', 'fly', 'neon', 'clerk', 'ably'] as const).map((p) => (
                <div key={p} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">
                    {['clerk', 'ably'].includes(p) ? `~${p}` : p}
                  </span>
                  <span className="tabular-nums">{formatNaira(summary.expenses.infrastructure[p] / 100)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatNaira(summary.expenses.total / 100)}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Trend chart */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">6-Month Trend</h2>
        {trendLoading ? (
          <Skeleton className="mt-4 h-52 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={220} className="mt-4">
            <BarChart data={trend} barGap={4}>
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `₦${(v / 100000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatNaira(v / 100)} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="gross_profit" name="Gross Profit" fill="#4ade80" radius={[3, 3, 0, 0]} />
              <Bar dataKey="net_profit" name="Net Profit" fill="#86efac" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Ledger table */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center gap-1 border-b p-4">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setCategoryTab(tab); setLedgerOffset(0); }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                categoryTab === tab ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledgerLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : ledger.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">No ledger entries for this period.</TableCell>
              </TableRow>
            ) : (
              ledger.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground">{new Date(row.occurredAt).toLocaleDateString('en-NG')}</TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', CATEGORY_STYLES[row.category])}>
                      {row.category}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{TYPE_LABELS[row.type] ?? row.type}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNaira(row.amountKobo / 100)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.sourceType}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t p-4">
          <p className="text-sm text-muted-foreground">{ledgerTotal} entries</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={ledgerOffset === 0} onClick={() => setLedgerOffset(Math.max(0, ledgerOffset - PAGE_SIZE))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={ledgerOffset + PAGE_SIZE >= ledgerTotal} onClick={() => setLedgerOffset(ledgerOffset + PAGE_SIZE)}>Next</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add Finance to the admin sidebar**

In `apps/admin/app/components/app-sidebar.tsx`, find the array containing `{ title: 'Payouts', url: '/payouts' }` and add Finance after it:
```typescript
{ title: 'Finance', url: '/finance' },
```

- [ ] **Step 4: Add Finance to route titles in `layout.tsx`**

In `apps/admin/app/routes/layout.tsx`, add to `routeTitles`:
```typescript
'/finance': { title: 'Finance', parent: 'Operations' },
```

- [ ] **Step 5: Verify admin app compiles**

```bash
cd apps/admin && npx tsc --noEmit 2>&1 | grep "finance\|Finance" | grep -v "recharts"
```
Expected: no errors from finance files

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/hooks/use-finance.ts \
        apps/admin/app/routes/finance.tsx \
        apps/admin/app/components/app-sidebar.tsx \
        apps/admin/app/routes/layout.tsx
git commit -m "feat(admin): add Finance page with summary, breakdown, trend chart, and ledger table"
```

---

## Post-implementation verification

- [ ] Start the API: `pnpm --filter @surewaka/api dev` — verify `GET /api/v1/admin/finance/summary` returns zeros (no data yet)
- [ ] Trigger an escrow release in dev — confirm a `revenue/commission` row appears in `platform_ledger`
- [ ] Trigger a test payout via Paystack webhook simulator — confirm `revenue/withdrawal_fee` and `expense/paystack_transfer` appear
- [ ] Run `pnpm --filter @surewaka/api test` — all tests pass
- [ ] Start the admin app: `pnpm --filter @surewaka/admin dev` — navigate to `/finance`, verify page renders with zero state
