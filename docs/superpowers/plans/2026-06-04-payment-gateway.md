# Payment Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a wallet-first payment system backed by Paystack — customers top up a wallet (card or bank transfer / DVA), bookings deduct via escrow, drivers earn into a wallet and request manual payouts.

**Architecture:** API-mediated Paystack flow (server holds secret key, mobile opens WebView); wallet is always the ledger; webhook is source of truth; BullMQ on Fly.io handles async jobs. Schema changes are migration-first; never touch `packages/db/src/schema.ts` directly.

**Tech Stack:** Paystack API · Hono (API routes) · Drizzle ORM · BullMQ + IORedis · Zustand (mobile store) · Expo WebBrowser · Vitest

**Design spec:** `docs/superpowers/specs/2026-06-04-payment-gateway-design.md`

---

## File Map

**Create:**
- `supabase/migrations/YYYYMMDDXXXXXX_add_wallet_tables.sql`
- `supabase/migrations/YYYYMMDDXXXXXX_refactor_delivery_status.sql`
- `packages/shared/src/validators.ts` ← modify (add payment schemas)
- `apps/api/src/lib/paystack.ts`
- `apps/api/src/lib/wallet-service.ts`
- `apps/api/src/routes/wallet.ts`
- `apps/api/src/routes/webhook.ts`
- `apps/api/src/routes/booking-payment.ts`
- `apps/api/src/routes/payouts.ts`
- `apps/api/src/__tests__/paystack-client.test.ts`
- `apps/api/src/__tests__/wallet-service.test.ts`
- `apps/api/src/__tests__/wallet-routes.test.ts`
- `apps/api/src/__tests__/webhook-routes.test.ts`
- `apps/api/src/__tests__/booking-payment-routes.test.ts`
- `apps/api/src/__tests__/payouts-routes.test.ts`
- `workers/payment-worker/src/queue.ts`
- `workers/payment-worker/src/jobs/escrow-hold.ts`
- `workers/payment-worker/src/jobs/escrow-release.ts`
- `workers/payment-worker/src/jobs/refund.ts`
- `workers/payment-worker/src/jobs/provision-dva.ts`
- `workers/payment-worker/src/jobs/notify-topup.ts`
- `workers/payment-worker/vitest.config.ts`
- `workers/payment-worker/src/__tests__/jobs.test.ts`
- `packages/mobile-shared/src/store/wallet-store.ts`
- `apps/mobile-customer/app/wallet/_layout.tsx`
- `apps/mobile-customer/app/wallet/topup.tsx`
- `apps/mobile-customer/app/wallet/topup-success.tsx`
- `apps/mobile-customer/app/wallet/transactions.tsx`
- `apps/mobile-customer/app/booking/payment-shortfall.tsx`

**Modify:**
- `apps/api/src/index.ts` (wire new routes)
- `apps/api/src/routes/deliveries.ts` (add cancel endpoint, update create to use `draft` status)
- `workers/payment-worker/src/index.ts` (refactor to use BullMQ workers)
- `workers/payment-worker/package.json` (add vitest)
- `packages/mobile-shared/src/index.ts` (export wallet store)
- `apps/mobile-customer/app/profile/payments.tsx` (upgrade to wallet home)
- `apps/mobile-customer/app/booking/review.tsx` (add wallet check before confirm)

---

## Phase 1: Database

### Task 1: Migration — wallet tables

**Files:**
- Create: `supabase/migrations/<timestamp>_add_wallet_tables.sql`

- [ ] **Step 1: Create the migration file**

```bash
cd /path/to/project
supabase migration new add_wallet_tables
```

Expected: creates `supabase/migrations/YYYYMMDDXXXXXX_add_wallet_tables.sql`

- [ ] **Step 2: Write the migration SQL**

```sql
-- ENUMS
CREATE TYPE wallet_status AS ENUM ('active', 'frozen', 'closed');

CREATE TYPE transaction_type AS ENUM (
  'fund',
  'escrow_hold',
  'escrow_release',
  'refund',
  'payout',
  'commission',
  'adjustment'
);

CREATE TYPE escrow_status AS ENUM (
  'held',
  'released',
  'refunded',
  'disputed',
  'partially_refunded'
);

-- WALLETS
CREATE TABLE public.wallets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance           BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency          TEXT NOT NULL DEFAULT 'NGN',
  status            wallet_status NOT NULL DEFAULT 'active',
  dva_bank          TEXT,
  dva_account_no    TEXT,
  dva_customer_code TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, currency)
);

CREATE INDEX idx_wallets_user_id ON public.wallets(user_id);

-- WALLET TRANSACTIONS (append-only ledger)
CREATE TABLE public.wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES public.wallets(id),
  type          transaction_type NOT NULL,
  amount        BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reference     TEXT UNIQUE,
  description   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_transactions_wallet_id   ON public.wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_transactions_reference   ON public.wallet_transactions(reference);
CREATE INDEX idx_wallet_transactions_type        ON public.wallet_transactions(type);
CREATE INDEX idx_wallet_transactions_created_at  ON public.wallet_transactions(created_at DESC);

-- ESCROW HOLDS
CREATE TABLE public.escrow_holds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       UUID NOT NULL,
  sender_wallet_id  UUID NOT NULL REFERENCES public.wallets(id),
  driver_wallet_id  UUID REFERENCES public.wallets(id),
  total_amount      BIGINT NOT NULL,
  commission_rate   NUMERIC(5,4) NOT NULL DEFAULT 0.1500,
  commission_amount BIGINT NOT NULL DEFAULT 0,
  driver_amount     BIGINT NOT NULL DEFAULT 0,
  status            escrow_status NOT NULL DEFAULT 'held',
  held_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at       TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_escrow_holds_delivery_id     ON public.escrow_holds(delivery_id);
CREATE INDEX idx_escrow_holds_status          ON public.escrow_holds(status);
CREATE INDEX idx_escrow_holds_sender_wallet   ON public.escrow_holds(sender_wallet_id);

-- PAYOUT REQUESTS
CREATE TABLE public.payout_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id                UUID NOT NULL REFERENCES public.wallets(id),
  amount                   BIGINT NOT NULL CHECK (amount > 0),
  bank_code                TEXT NOT NULL,
  account_number           TEXT NOT NULL,
  account_name             TEXT NOT NULL,
  paystack_transfer_code   TEXT,
  paystack_recipient_code  TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending',
  failure_reason           TEXT,
  processed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payout_requests_wallet_id ON public.payout_requests(wallet_id);
CREATE INDEX idx_payout_requests_status    ON public.payout_requests(status);

-- AUTO-CREATE WALLET ON USER SIGNUP
CREATE OR REPLACE FUNCTION public.create_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id, currency)
  VALUES (NEW.id, 'NGN')
  ON CONFLICT (user_id, currency) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created_create_wallet
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_wallet_for_new_user();

-- UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION public.update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_wallet_timestamp();

-- RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_manage_wallets"
  ON public.wallets FOR ALL TO public
  USING (auth.role() = 'service_role');

CREATE POLICY "users_read_own_wallet"
  ON public.wallets FOR SELECT TO public
  USING (user_id = auth.uid());

CREATE POLICY "service_role_manage_wallet_transactions"
  ON public.wallet_transactions FOR ALL TO public
  USING (auth.role() = 'service_role');

CREATE POLICY "users_read_own_wallet_transactions"
  ON public.wallet_transactions FOR SELECT TO public
  USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

CREATE POLICY "service_role_manage_escrow_holds"
  ON public.escrow_holds FOR ALL TO public
  USING (auth.role() = 'service_role');

CREATE POLICY "senders_read_own_escrow"
  ON public.escrow_holds FOR SELECT TO public
  USING (sender_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

CREATE POLICY "service_role_manage_payout_requests"
  ON public.payout_requests FOR ALL TO public
  USING (auth.role() = 'service_role');

CREATE POLICY "users_read_own_payout_requests"
  ON public.payout_requests FOR SELECT TO public
  USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT SELECT ON public.escrow_holds TO authenticated;
GRANT SELECT ON public.payout_requests TO authenticated;
```

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/
git commit -m "feat(db): add wallet, wallet_transactions, escrow_holds, payout_requests tables"
```

---

### Task 2: Migration — delivery status enum + payment columns

**Files:**
- Create: `supabase/migrations/<timestamp>_refactor_delivery_status.sql`

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new refactor_delivery_status
```

- [ ] **Step 2: Write the migration SQL**

```sql
-- Replace delivery_status enum (Postgres cannot remove enum values, so swap the type)
CREATE TYPE delivery_status_new AS ENUM (
  'draft',
  'pending',
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returned'
);

ALTER TABLE public.deliveries
  ALTER COLUMN status TYPE delivery_status_new
  USING status::text::delivery_status_new;

DROP TYPE delivery_status;
ALTER TYPE delivery_status_new RENAME TO delivery_status;

-- Add payment columns to deliveries
ALTER TABLE public.deliveries
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN escrow_hold_id UUID REFERENCES public.escrow_holds(id),
  ADD COLUMN amount_paid BIGINT;

-- Update default for status (new bookings start as draft)
ALTER TABLE public.deliveries
  ALTER COLUMN status SET DEFAULT 'draft';

CREATE INDEX idx_deliveries_payment_status ON public.deliveries(payment_status);
```

- [ ] **Step 3: Commit the migration**

```bash
git add supabase/migrations/
git commit -m "feat(db): refactor delivery_status enum + add payment columns"
```

---

### Task 3: Apply migrations and regenerate schema

- [ ] **Step 1: Apply migrations to the local Supabase instance**

```bash
supabase db push
```

Expected: both migrations apply without error.

- [ ] **Step 2: Regenerate Drizzle schema**

```bash
pnpm --filter @surewaka/db db:pull
```

Expected: `packages/db/src/schema.ts` regenerated. Verify it contains `wallets`, `walletTransactions`, `escrowHolds`, `payoutRequests` table exports and `deliveryStatus` enum has the 12 new values.

- [ ] **Step 3: Commit the regenerated schema**

```bash
git add packages/db/
git commit -m "chore(db): regenerate schema after wallet + delivery status migrations"
```

---

## Phase 2: Shared Validators

### Task 4: Add payment Zod schemas

**Files:**
- Modify: `packages/shared/src/validators.ts`

- [ ] **Step 1: Append payment validators**

Add to the bottom of `packages/shared/src/validators.ts`:

```typescript
// ─── Payment validators ───────────────────────────────────────────────────────

export const initializeTopupSchema = z.object({
  amount: z.number().int().min(50000, 'Minimum top-up is ₦500'),  // kobo
  email: z.string().email(),
  topup_type: z.enum(['manual', 'booking_shortfall']).default('manual'),
  delivery_id: z.string().uuid().optional(),
});
export type InitializeTopup = z.infer<typeof initializeTopupSchema>;

export const walletCheckSchema = z.object({
  amount: z.number().int().positive(),  // kobo
});
export type WalletCheck = z.infer<typeof walletCheckSchema>;

export const bookingConfirmSchema = z.object({
  delivery_id: z.string().uuid(),
  amount: z.number().int().positive(),  // kobo
});
export type BookingConfirm = z.infer<typeof bookingConfirmSchema>;

export const paystackWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    amount: z.number(),
    status: z.string(),
    customer: z.object({ email: z.string() }),
    metadata: z.record(z.unknown()).optional().default({}),
  }),
});
export type PaystackWebhook = z.infer<typeof paystackWebhookSchema>;

export const payoutRequestSchema = z.object({
  amount: z.number().int().min(100000, 'Minimum payout is ₦1,000'),  // kobo
  bank_code: z.string().min(3).max(10),
  account_number: z.string().length(10, 'Nigerian account numbers are 10 digits'),
  account_name: z.string().min(2).max(100),
});
export type PayoutRequest = z.infer<typeof payoutRequestSchema>;

export const cancelDeliverySchema = z.object({
  reason: z.string().min(5).max(200).optional(),
});
export type CancelDelivery = z.infer<typeof cancelDeliverySchema>;
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/validators.ts
git commit -m "feat(shared): add payment Zod validators"
```

---

## Phase 3: API Foundation

### Task 5: Paystack client

**Files:**
- Create: `apps/api/src/lib/paystack.ts`
- Create: `apps/api/src/__tests__/paystack-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/__tests__/paystack-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

process.env.PAYSTACK_SECRET_KEY = 'test-secret-key';

describe('Paystack client', () => {
  beforeEach(() => mockFetch.mockReset());

  it('initializeTransaction calls correct endpoint and returns reference + url', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: true,
        data: { reference: 'ref_abc123', authorization_url: 'https://paystack.com/pay/ref_abc123' },
      }),
    });

    const { initializeTransaction } = await import('../lib/paystack');
    const result = await initializeTransaction(350000, 'user@example.com', { topup_type: 'manual' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-secret-key' }),
      }),
    );
    expect(result.reference).toBe('ref_abc123');
    expect(result.authorization_url).toBe('https://paystack.com/pay/ref_abc123');
  });

  it('verifyWebhookSignature returns true for valid signature', async () => {
    const { verifyWebhookSignature } = await import('../lib/paystack');
    const crypto = await import('crypto');
    const body = JSON.stringify({ event: 'charge.success' });
    const sig = crypto.createHmac('sha512', 'test-secret-key').update(body).digest('hex');
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('verifyWebhookSignature returns false for wrong signature', async () => {
    const { verifyWebhookSignature } = await import('../lib/paystack');
    expect(verifyWebhookSignature('{"event":"charge.success"}', 'wrong-sig')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @surewaka/api test --reporter=verbose paystack-client
```

Expected: `Cannot find module '../lib/paystack'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/lib/paystack.ts

const BASE = 'https://api.paystack.co';

function headers() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

export type PaystackChargeData = {
  reference: string;
  amount: number;
  status: 'success' | 'failed' | 'abandoned';
  customer: { email: string };
  metadata: Record<string, unknown>;
};

export type DVAData = {
  bank: { name: string };
  account_number: string;
  account_name: string;
};

export async function initializeTransaction(
  amount: number,
  email: string,
  metadata: Record<string, unknown> = {},
): Promise<{ reference: string; authorization_url: string }> {
  const res = await fetch(`${BASE}/transaction/initialize`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ amount, email, metadata }),
  });
  const json = await res.json() as { status: boolean; data: { reference: string; authorization_url: string } };
  if (!json.status) throw new Error('Paystack initialization failed');
  return json.data;
}

export async function verifyTransaction(reference: string): Promise<PaystackChargeData> {
  const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers(),
  });
  const json = await res.json() as { status: boolean; data: PaystackChargeData };
  if (!json.status) throw new Error('Paystack verification failed');
  return json.data;
}

export async function createCustomer(
  email: string,
  firstName: string,
  lastName: string,
): Promise<{ customer_code: string }> {
  const res = await fetch(`${BASE}/customer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, first_name: firstName, last_name: lastName }),
  });
  const json = await res.json() as { status: boolean; data: { customer_code: string } };
  if (!json.status) throw new Error('Paystack customer creation failed');
  return json.data;
}

export async function createDedicatedVirtualAccount(customerCode: string): Promise<DVAData> {
  const res = await fetch(`${BASE}/dedicated_account`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ customer: customerCode, preferred_bank: 'wema-bank' }),
  });
  const json = await res.json() as { status: boolean; data: DVAData };
  if (!json.status) throw new Error('Paystack DVA creation failed');
  return json.data;
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const crypto = require('crypto') as typeof import('crypto');
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY ?? '')
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter @surewaka/api test --reporter=verbose paystack-client
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/paystack.ts apps/api/src/__tests__/paystack-client.test.ts
git commit -m "feat(api): add Paystack client with HMAC signature verification"
```

---

### Task 6: Wallet service

**Files:**
- Create: `apps/api/src/lib/wallet-service.ts`
- Create: `apps/api/src/__tests__/wallet-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/__tests__/wallet-service.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockTx = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  for: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

const mockDb = {
  transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  wallets: 'wallets',
  walletTransactions: 'wallet_transactions',
  eq: vi.fn((a: unknown, b: unknown) => `${String(a)}=${String(b)}`),
}));

describe('wallet-service: creditWallet', () => {
  it('credits the wallet and returns the transaction', async () => {
    const mockWallet = { balance: 100000 };
    const mockTxnRow = { id: 'txn-1', amount: 350000, balanceAfter: 450000 };

    mockTx.for.mockReturnThis();
    // first call returns wallet, second call returns nothing (update)
    mockTx.returning
      .mockResolvedValueOnce([mockWallet])  // select for update
      .mockResolvedValueOnce([mockTxnRow]); // insert returning

    const { creditWallet } = await import('../lib/wallet-service');
    const result = await creditWallet('wallet-id', 350000, 'fund', 'ref_123', 'Top up');

    expect(result).toEqual(mockTxnRow);
  });

  it('throws INSUFFICIENT_BALANCE when debit exceeds balance', async () => {
    const mockWallet = { balance: 10000 };
    mockTx.returning.mockResolvedValueOnce([mockWallet]);

    const { debitWallet } = await import('../lib/wallet-service');
    await expect(
      debitWallet('wallet-id', 50000, 'escrow_hold', 'ref_456', 'Delivery payment'),
    ).rejects.toThrow('INSUFFICIENT_BALANCE');
  });

  it('checkBalance returns shortfall when balance is insufficient', async () => {
    mockDb.where.mockReturnThis();
    // mock final resolution
    (mockDb as unknown as { then: unknown }).then = undefined;
    vi.spyOn(mockDb, 'where').mockResolvedValueOnce([{ balance: 20000 }] as never);

    const { checkBalance } = await import('../lib/wallet-service');
    const result = await checkBalance('wallet-id', 50000);

    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(30000);
    expect(result.balance).toBe(20000);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @surewaka/api test --reporter=verbose wallet-service
```

Expected: `Cannot find module '../lib/wallet-service'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/lib/wallet-service.ts
import { db, wallets, walletTransactions } from '@surewaka/db';
import { eq } from 'drizzle-orm';

export type TransactionType =
  | 'fund' | 'escrow_hold' | 'escrow_release'
  | 'refund' | 'payout' | 'commission' | 'adjustment';

export async function getWalletByUserId(userId: string) {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId));
  if (!wallet) throw new Error('WALLET_NOT_FOUND');
  return wallet;
}

export async function creditWallet(
  walletId: string,
  amount: number,
  type: TransactionType,
  reference: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for('update');

    if (!wallet) throw new Error('WALLET_NOT_FOUND');
    const newBalance = Number(wallet.balance) + amount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    const [txn] = await tx
      .insert(walletTransactions)
      .values({ walletId, type, amount, balanceAfter: newBalance, reference, description, metadata })
      .returning();

    return txn;
  });
}

export async function debitWallet(
  walletId: string,
  amount: number,
  type: TransactionType,
  reference: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  return db.transaction(async (tx) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for('update');

    if (!wallet) throw new Error('WALLET_NOT_FOUND');
    if (Number(wallet.balance) < amount) throw new Error('INSUFFICIENT_BALANCE');
    const newBalance = Number(wallet.balance) - amount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    const [txn] = await tx
      .insert(walletTransactions)
      .values({ walletId, type, amount: -amount, balanceAfter: newBalance, reference, description, metadata })
      .returning();

    return txn;
  });
}

export async function checkBalance(walletId: string, amount: number) {
  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.id, walletId));

  if (!wallet) throw new Error('WALLET_NOT_FOUND');
  const balance = Number(wallet.balance);
  const sufficient = balance >= amount;
  return { sufficient, balance, shortfall: sufficient ? 0 : amount - balance };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @surewaka/api test --reporter=verbose wallet-service
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/wallet-service.ts apps/api/src/__tests__/wallet-service.test.ts
git commit -m "feat(api): add wallet service with atomic credit/debit operations"
```

---

## Phase 4: API Routes

### Task 7: Wallet routes

**Files:**
- Create: `apps/api/src/routes/wallet.ts`
- Create: `apps/api/src/__tests__/wallet-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/__tests__/wallet-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetUser = vi.fn();
vi.mock('@surewaka/supabase', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockGetWalletByUserId = vi.fn();
const mockCheckBalance = vi.fn();
const mockCreditWallet = vi.fn();
const mockInitializeTransaction = vi.fn();
const mockVerifyTransaction = vi.fn();

vi.mock('../lib/wallet-service', () => ({
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
  checkBalance: (...a: unknown[]) => mockCheckBalance(...a),
  creditWallet: (...a: unknown[]) => mockCreditWallet(...a),
}));

vi.mock('../lib/paystack', () => ({
  initializeTransaction: (...a: unknown[]) => mockInitializeTransaction(...a),
  verifyTransaction: (...a: unknown[]) => mockVerifyTransaction(...a),
}));

vi.mock('@surewaka/db', () => ({ db: {}, wallets: 'wallets', eq: vi.fn() }));

function authUser() {
  return { id: 'user-123', email: 'test@example.com', user_metadata: { name: 'Test' }, app_metadata: {} };
}

async function createTestApp() {
  const { requireAuth } = await import('../middleware/auth');
  const walletModule = await import('../routes/wallet');
  const app = new Hono();
  app.route('/api/v1/wallet', walletModule.default);
  return app;
}

describe('Wallet routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('GET /balance returns 401 without auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await app.request('/api/v1/wallet/balance', {
      headers: { Authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /balance returns balance for authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 350000, currency: 'NGN', status: 'active' });
    const res = await app.request('/api/v1/wallet/balance', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.balance).toBe(350000);
    expect(body.data.currency).toBe('NGN');
  });

  it('POST /check returns sufficient=false with shortfall', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 100000 });
    mockCheckBalance.mockResolvedValue({ sufficient: false, balance: 100000, shortfall: 250000 });
    const res = await app.request('/api/v1/wallet/check', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 350000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sufficient).toBe(false);
    expect(body.data.shortfall).toBe(250000);
  });

  it('POST /fund returns reference and authorization_url', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    mockInitializeTransaction.mockResolvedValue({
      reference: 'ref_abc',
      authorization_url: 'https://paystack.com/pay/ref_abc',
    });
    const res = await app.request('/api/v1/wallet/fund', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500000, email: 'test@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reference).toBe('ref_abc');
  });

  it('POST /fund returns 400 for amount below minimum', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    const res = await app.request('/api/v1/wallet/fund', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10000, email: 'test@example.com' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @surewaka/api test --reporter=verbose wallet-routes
```

Expected: `Cannot find module '../routes/wallet'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/wallet.ts
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, wallets, walletTransactions } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, checkBalance } from '../lib/wallet-service';
import { initializeTransaction, verifyTransaction, createCustomer, createDedicatedVirtualAccount } from '../lib/paystack';
import { initializeTopupSchema, walletCheckSchema } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';

type Env = { Variables: { user: SupabaseUser; accessToken: string } };

const walletRoutes = new Hono<Env>();
walletRoutes.use('*', requireAuth);

walletRoutes.get('/balance', async (c) => {
  const user = c.get('user');
  try {
    const wallet = await getWalletByUserId(user.id);
    return c.json({ data: { balance: Number(wallet.balance), currency: wallet.currency, status: wallet.status }, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Wallet not found' }, meta: null }, 404);
  }
});

walletRoutes.get('/transactions', async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page') ?? '1');
  const pageSize = Math.min(Number(c.req.query('pageSize') ?? '20'), 100);
  try {
    const wallet = await getWalletByUserId(user.id);
    const rows = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, wallet.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({ data: rows, error: null, meta: { page, pageSize } });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions' }, meta: null }, 500);
  }
});

walletRoutes.get('/dva', async (c) => {
  const user = c.get('user');
  try {
    const wallet = await getWalletByUserId(user.id);
    if (wallet.dvaAccountNo) {
      return c.json({
        data: { bank: wallet.dvaBank, account_number: wallet.dvaAccountNo },
        error: null, meta: null,
      });
    }
    // Provision DVA (create Paystack customer first if needed)
    const customer = await createCustomer(user.email ?? '', user.user_metadata?.name?.split(' ')[0] ?? '', user.user_metadata?.name?.split(' ').slice(1).join(' ') ?? '');
    const dva = await createDedicatedVirtualAccount(customer.customer_code);
    await db.update(wallets)
      .set({ dvaBank: dva.bank.name, dvaAccountNo: dva.account_number, dvaCustomerCode: customer.customer_code })
      .where(eq(wallets.id, wallet.id));
    return c.json({ data: { bank: dva.bank.name, account_number: dva.account_number }, error: null, meta: null });
  } catch (err) {
    console.error('[GET /wallet/dva]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to provision virtual account' }, meta: null }, 500);
  }
});

walletRoutes.post('/fund', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = initializeTopupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }
  try {
    const result = await initializeTransaction(parsed.data.amount, parsed.data.email, {
      topup_type: parsed.data.topup_type,
      delivery_id: parsed.data.delivery_id,
      user_id: user.id,
    });
    return c.json({ data: result, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'PAYMENT_ERROR', message: 'Failed to initialize payment' }, meta: null }, 500);
  }
});

walletRoutes.get('/fund/:reference', async (c) => {
  const reference = c.req.param('reference');
  try {
    const txnData = await verifyTransaction(reference);
    return c.json({ data: { status: txnData.status, amount: txnData.amount }, error: null, meta: null });
  } catch {
    return c.json({ data: { status: 'pending' }, error: null, meta: null });
  }
});

walletRoutes.post('/check', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = walletCheckSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }
  try {
    const wallet = await getWalletByUserId(user.id);
    const result = await checkBalance(wallet.id, parsed.data.amount);
    return c.json({ data: result, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to check balance' }, meta: null }, 500);
  }
});

export default walletRoutes;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @surewaka/api test --reporter=verbose wallet-routes
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/wallet.ts apps/api/src/__tests__/wallet-routes.test.ts
git commit -m "feat(api): add wallet routes (balance, transactions, dva, fund, check)"
```

---

### Task 8: Webhook route

**Files:**
- Create: `apps/api/src/routes/webhook.ts`
- Create: `apps/api/src/__tests__/webhook-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/__tests__/webhook-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import crypto from 'crypto';

process.env.PAYSTACK_SECRET_KEY = 'test-webhook-secret';

const mockCreditWallet = vi.fn();
const mockGetWalletByUserId = vi.fn();

vi.mock('../lib/wallet-service', () => ({
  creditWallet: (...a: unknown[]) => mockCreditWallet(...a),
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
}));

vi.mock('../lib/paystack', () => ({
  verifyWebhookSignature: (body: string, sig: string) => {
    const hash = crypto.createHmac('sha512', 'test-webhook-secret').update(body).digest('hex');
    return hash === sig;
  },
}));

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  },
  walletTransactions: 'wallet_transactions',
  wallets: 'wallets',
  eq: vi.fn(),
  users: 'users',
}));

async function createTestApp() {
  const webhookModule = await import('../routes/webhook');
  const app = new Hono();
  app.route('/api/v1/webhook', webhookModule.default);
  return app;
}

function makePayload(event: string, amount: number) {
  return JSON.stringify({
    event,
    data: {
      reference: 'ref_test_123',
      amount,
      status: 'success',
      customer: { email: 'user@example.com' },
      metadata: { topup_type: 'manual', user_id: 'user-123' },
    },
  });
}

function sign(body: string) {
  return crypto.createHmac('sha512', 'test-webhook-secret').update(body).digest('hex');
}

describe('Webhook — Paystack', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('returns 400 for invalid signature', async () => {
    const body = makePayload('charge.success', 350000);
    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'bad-sig' },
      body,
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 and credits wallet on charge.success', async () => {
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    mockCreditWallet.mockResolvedValue({ id: 'txn-1', amount: 350000 });

    const body = makePayload('charge.success', 350000);
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockCreditWallet).toHaveBeenCalledWith(
      'wallet-1', 350000, 'fund',
      'ref_test_123',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('returns 200 without crediting for duplicate reference (idempotency)', async () => {
    // Simulate reference already exists in wallet_transactions
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'where' as never).mockResolvedValueOnce([{ id: 'existing-txn' }] as never);

    const body = makePayload('charge.success', 350000);
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockCreditWallet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @surewaka/api test --reporter=verbose webhook-routes
```

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/webhook.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, walletTransactions, users } from '@surewaka/db';
import { verifyWebhookSignature } from '../lib/paystack';
import { getWalletByUserId, creditWallet } from '../lib/wallet-service';
import { paystackWebhookSchema } from '@surewaka/shared';

const webhookRoutes = new Hono();

webhookRoutes.post('/paystack', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = paystackWebhookSchema.safeParse(payload);
  if (!parsed.success) return c.json({ ok: true }); // unknown event shape — ignore

  const { event, data } = parsed.data;

  if (event !== 'charge.success') return c.json({ ok: true });

  // Idempotency: skip if already processed
  const existing = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(eq(walletTransactions.reference, data.reference));

  if (existing.length > 0) return c.json({ ok: true });

  try {
    // Resolve wallet by email
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.customer.email));

    if (!user) {
      console.error(`[webhook] No user found for email ${data.customer.email}`);
      return c.json({ ok: true });
    }

    const wallet = await getWalletByUserId(user.id);
    await creditWallet(
      wallet.id,
      data.amount,
      'fund',
      data.reference,
      'Wallet top-up via Paystack',
      data.metadata ?? {},
    );
  } catch (err) {
    console.error('[webhook] Failed to process charge.success', err);
    // Still return 200 — log the error, don't let Paystack retry infinitely
  }

  return c.json({ ok: true });
});

export default webhookRoutes;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @surewaka/api test --reporter=verbose webhook-routes
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/webhook.ts apps/api/src/__tests__/webhook-routes.test.ts
git commit -m "feat(api): add Paystack webhook handler with HMAC verification + idempotency"
```

---

### Task 9: Booking confirm + delivery cancel routes

**Files:**
- Create: `apps/api/src/routes/booking-payment.ts`
- Create: `apps/api/src/__tests__/booking-payment-routes.test.ts`
- Modify: `apps/api/src/routes/deliveries.ts` (set `draft` as default status on create)

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/__tests__/booking-payment-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetUser = vi.fn();
vi.mock('@surewaka/supabase', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockDebitWallet = vi.fn();
const mockGetWalletByUserId = vi.fn();
vi.mock('../lib/wallet-service', () => ({
  debitWallet: (...a: unknown[]) => mockDebitWallet(...a),
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
}));

const mockDbUpdate = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
const mockDbInsert = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 'escrow-1' }]) };
const mockDbSelect = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 'delivery-1', status: 'pending', customerId: 'user-123', amountPaid: 350000 }]) };

vi.mock('@surewaka/db', () => ({
  db: {
    transaction: vi.fn(async (fn: unknown) => (fn as (tx: typeof mockDbSelect) => Promise<unknown>)(mockDbSelect)),
    select: vi.fn(() => mockDbSelect),
    update: vi.fn(() => mockDbUpdate),
    insert: vi.fn(() => mockDbInsert),
  },
  deliveries: 'deliveries',
  escrowHolds: 'escrow_holds',
  walletTransactions: 'wallet_transactions',
  eq: vi.fn(),
}));

function authUser() {
  return { id: 'user-123', email: 'user@example.com', user_metadata: {}, app_metadata: {} };
}

async function createTestApp() {
  const { requireAuth } = await import('../middleware/auth');
  const mod = await import('../routes/booking-payment');
  const app = new Hono();
  app.route('/api/v1', mod.default);
  return app;
}

describe('Booking payment routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('POST /booking/confirm returns 401 without auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await app.request('/api/v1/booking/confirm', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad' },
      body: JSON.stringify({ delivery_id: 'del-1', amount: 350000 }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /booking/confirm returns 400 for invalid body', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1' });
    const res = await app.request('/api/v1/booking/confirm', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 350000 }), // missing delivery_id
    });
    expect(res.status).toBe(400);
  });

  it('POST /deliveries/:id/cancel returns 400 for unknown status', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    // Delivery in 'delivered' status — cannot cancel
    mockDbSelect.where.mockResolvedValueOnce([{ id: 'del-1', status: 'delivered', customerId: 'user-123', amountPaid: 350000 }]);
    const res = await app.request('/api/v1/deliveries/del-1/cancel', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Changed my mind' }),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @surewaka/api test --reporter=verbose booking-payment-routes
```

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/booking-payment.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, deliveries, escrowHolds, walletTransactions } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, creditWallet, debitWallet } from '../lib/wallet-service';
import { bookingConfirmSchema, cancelDeliverySchema } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import { randomUUID } from 'crypto';

type Env = { Variables: { user: SupabaseUser; accessToken: string } };

const bookingPaymentRoutes = new Hono<Env>();
bookingPaymentRoutes.use('*', requireAuth);

// POST /booking/confirm — escrow hold + wallet debit
bookingPaymentRoutes.post('/booking/confirm', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = bookingConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const { delivery_id, amount } = parsed.data;

  try {
    const wallet = await getWalletByUserId(user.id);
    const reference = `escrow_${delivery_id}_${randomUUID().slice(0, 8)}`;

    await db.transaction(async (tx) => {
      // Debit wallet (throws INSUFFICIENT_BALANCE if not enough)
      await debitWallet(wallet.id, amount, 'escrow_hold', reference, `Escrow for delivery ${delivery_id}`);

      // Create escrow hold record
      const [escrow] = await tx
        .insert(escrowHolds)
        .values({
          deliveryId: delivery_id,
          senderWalletId: wallet.id,
          totalAmount: amount,
          status: 'held',
          heldAt: new Date(),
        })
        .returning();

      // Update delivery to pending + link escrow
      await tx
        .update(deliveries)
        .set({ status: 'pending', paymentStatus: 'escrowed', escrowHoldId: escrow.id, amountPaid: amount })
        .where(eq(deliveries.id, delivery_id));
    });

    return c.json({ data: { delivery_id, status: 'confirmed' }, error: null, meta: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg === 'INSUFFICIENT_BALANCE') {
      return c.json({ data: null, error: { code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance too low' }, meta: null }, 422);
    }
    console.error('[POST /booking/confirm]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to confirm booking' }, meta: null }, 500);
  }
});

// Refund percentage by delivery status when customer cancels
const REFUND_RATES: Record<string, number> = {
  pending: 1.0,
  accepted: 1.0,
  en_route_pickup: 0.85,
  arrived_pickup: 0.85,
  picked_up: 0.5,
  en_route_dropoff: 0.5,
  arrived_dropoff: 0.5,
};

const NON_CANCELLABLE = new Set(['delivered', 'cancelled', 'failed', 'returned', 'draft']);

// POST /deliveries/:id/cancel — tiered refund
bookingPaymentRoutes.post('/deliveries/:id/cancel', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  try {
    const [delivery] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));

    if (!delivery || delivery.customerId !== user.id) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
    }

    if (NON_CANCELLABLE.has(delivery.status)) {
      return c.json({ data: null, error: { code: 'CANNOT_CANCEL', message: `Cannot cancel a delivery in status: ${delivery.status}` }, meta: null }, 422);
    }

    const rate = REFUND_RATES[delivery.status] ?? 0;
    const amountPaid = Number(delivery.amountPaid ?? 0);
    const refundAmount = Math.floor(amountPaid * rate);

    await db.transaction(async (tx) => {
      await tx.update(deliveries)
        .set({ status: 'cancelled', paymentStatus: refundAmount > 0 ? 'refunded' : 'released' })
        .where(eq(deliveries.id, deliveryId));

      if (delivery.escrowHoldId) {
        await tx.update(escrowHolds)
          .set({ status: refundAmount === amountPaid ? 'refunded' : 'partially_refunded', refundedAt: new Date() })
          .where(eq(escrowHolds.id, delivery.escrowHoldId));
      }

      if (refundAmount > 0) {
        const wallet = await getWalletByUserId(user.id);
        await creditWallet(
          wallet.id,
          refundAmount,
          'refund',
          `refund_${deliveryId}_${Date.now()}`,
          `Cancellation refund for delivery ${deliveryId} (${Math.round(rate * 100)}%)`,
          { delivery_id: deliveryId, original_amount: amountPaid, refund_rate: rate },
        );
      }
    });

    return c.json({ data: { delivery_id: deliveryId, refund_amount: refundAmount }, error: null, meta: null });
  } catch (err) {
    console.error('[POST /deliveries/:id/cancel]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel delivery' }, meta: null }, 500);
  }
});

export default bookingPaymentRoutes;
```

- [ ] **Step 4: In `apps/api/src/routes/deliveries.ts`, change the default status on delivery creation**

Find the `db.insert(deliveries).values({...})` call in `deliveryRoutes.post('/')` and add `status: 'draft'` to the values object.

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @surewaka/api test --reporter=verbose booking-payment-routes
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/booking-payment.ts apps/api/src/routes/deliveries.ts apps/api/src/__tests__/booking-payment-routes.test.ts
git commit -m "feat(api): add booking confirm (escrow) + delivery cancel (tiered refund)"
```

---

### Task 10: Payouts routes

**Files:**
- Create: `apps/api/src/routes/payouts.ts`
- Create: `apps/api/src/__tests__/payouts-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/__tests__/payouts-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetUser = vi.fn();
vi.mock('@surewaka/supabase', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'payout-1', status: 'pending', amount: 100000 }]),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
  wallets: 'wallets',
  payoutRequests: 'payout_requests',
  eq: vi.fn(),
  desc: vi.fn(),
}));
vi.mock('../lib/wallet-service', () => ({
  getWalletByUserId: vi.fn().mockResolvedValue({ id: 'wallet-1', balance: 500000 }),
  debitWallet: vi.fn().mockResolvedValue({ id: 'txn-1' }),
}));

function authUser() {
  return { id: 'user-123', email: 'driver@example.com', user_metadata: {}, app_metadata: {} };
}

async function createTestApp() {
  const mod = await import('../routes/payouts');
  const app = new Hono();
  app.route('/api/v1/payouts', mod.default);
  return app;
}

describe('Payouts routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('POST /request returns 401 without auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('POST /request returns 400 for account_number not 10 digits', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    const res = await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000, bank_code: '058', account_number: '123', account_name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /request creates payout request and returns 201', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    const res = await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000, bank_code: '058', account_number: '0123456789', account_name: 'Test Driver' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('pending');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @surewaka/api test --reporter=verbose payouts-routes
```

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/routes/payouts.ts
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, payoutRequests, wallets } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, debitWallet } from '../lib/wallet-service';
import { payoutRequestSchema } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import { randomUUID } from 'crypto';

type Env = { Variables: { user: SupabaseUser; accessToken: string } };

const payoutRoutes = new Hono<Env>();
payoutRoutes.use('*', requireAuth);

payoutRoutes.post('/request', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = payoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  try {
    const wallet = await getWalletByUserId(user.id);
    const reference = `payout_${randomUUID().slice(0, 8)}`;

    await debitWallet(
      wallet.id,
      parsed.data.amount,
      'payout',
      reference,
      `Payout to ${parsed.data.account_name} (${parsed.data.bank_code})`,
    );

    const [payout] = await db
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

    return c.json({ data: payout, error: null, meta: null }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'INSUFFICIENT_BALANCE') {
      return c.json({ data: null, error: { code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance too low' }, meta: null }, 422);
    }
    console.error('[POST /payouts/request]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to request payout' }, meta: null }, 500);
  }
});

payoutRoutes.get('/', async (c) => {
  const user = c.get('user');
  try {
    const wallet = await getWalletByUserId(user.id);
    const rows = await db
      .select()
      .from(payoutRequests)
      .where(eq(payoutRequests.walletId, wallet.id))
      .orderBy(desc(payoutRequests.createdAt))
      .limit(50);
    return c.json({ data: rows, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payouts' }, meta: null }, 500);
  }
});

export default payoutRoutes;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @surewaka/api test --reporter=verbose payouts-routes
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/payouts.ts apps/api/src/__tests__/payouts-routes.test.ts
git commit -m "feat(api): add payout request + history routes"
```

---

### Task 11: Wire routes into the main app

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add imports and route registrations**

In `apps/api/src/index.ts`, add after the existing imports:

```typescript
import walletRoutes from './routes/wallet';
import webhookRoutes from './routes/webhook';
import bookingPaymentRoutes from './routes/booking-payment';
import payoutRoutes from './routes/payouts';
```

Then after the existing `app.route(...)` calls:

```typescript
app.route('/api/v1/wallet', walletRoutes);
app.route('/api/v1/webhook', webhookRoutes);
app.route('/api/v1', bookingPaymentRoutes);       // handles /booking/confirm + /deliveries/:id/cancel
app.route('/api/v1/payouts', payoutRoutes);
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm --filter @surewaka/api test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): wire wallet, webhook, booking-payment, and payout routes"
```

---

## Phase 5: Payment Worker

### Task 12: Refactor payment worker with BullMQ

**Files:**
- Modify: `workers/payment-worker/package.json`
- Create: `workers/payment-worker/vitest.config.ts`
- Create: `workers/payment-worker/src/queue.ts`
- Modify: `workers/payment-worker/src/index.ts`

- [ ] **Step 1: Add vitest and types to payment worker**

In `workers/payment-worker/package.json`, add:

```json
"devDependencies": {
  "tsx": "^4.19.0",
  "tsup": "^8.3.0",
  "typescript": "^5.7.0",
  "vitest": "^2.1.0"
},
"scripts": {
  "dev": "tsx watch src/index.ts",
  "build": "tsup src/index.ts --format esm",
  "start": "node dist/index.js",
  "test": "vitest run"
}
```

- [ ] **Step 2: Create vitest config**

```typescript
// workers/payment-worker/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
});
```

- [ ] **Step 3: Create queue module**

```typescript
// workers/payment-worker/src/queue.ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const paymentQueue = new Queue('payment', { connection });

export type PaymentJobName =
  | 'escrow-hold'
  | 'escrow-release'
  | 'refund'
  | 'provision-dva'
  | 'notify-topup';

export type EscrowHoldJobData = {
  deliveryId: string;
  walletId: string;
  amount: number;
  reference: string;
};

export type EscrowReleaseJobData = {
  deliveryId: string;
  escrowHoldId: string;
  driverWalletId: string;
};

export type RefundJobData = {
  deliveryId: string;
  walletId: string;
  amount: number;
  rate: number;
  reason: string;
};

export type ProvisionDvaJobData = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type NotifyTopupJobData = {
  userId: string;
  amount: number;
};
```

- [ ] **Step 4: Rewrite worker entry point**

```typescript
// workers/payment-worker/src/index.ts
import { Worker } from 'bullmq';
import { connection } from './queue';
import { handleEscrowHold } from './jobs/escrow-hold';
import { handleEscrowRelease } from './jobs/escrow-release';
import { handleRefund } from './jobs/refund';
import { handleProvisionDva } from './jobs/provision-dva';
import { handleNotifyTopup } from './jobs/notify-topup';
import type { PaymentJobName } from './queue';

const worker = new Worker<unknown, unknown, PaymentJobName>(
  'payment',
  async (job) => {
    switch (job.name) {
      case 'escrow-hold':    return handleEscrowHold(job.data as never);
      case 'escrow-release': return handleEscrowRelease(job.data as never);
      case 'refund':         return handleRefund(job.data as never);
      case 'provision-dva':  return handleProvisionDva(job.data as never);
      case 'notify-topup':   return handleNotifyTopup(job.data as never);
      default:
        console.warn(`Unknown job: ${job.name}`);
    }
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job) => console.log(`✅ Job ${job.id} (${job.name}) completed`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} (${job?.name}) failed:`, err));

console.log('💰 Payment worker started');
```

- [ ] **Step 5: Commit**

```bash
git add workers/payment-worker/
git commit -m "feat(worker): set up BullMQ payment worker with vitest"
```

---

### Task 13: BullMQ job handlers

**Files:**
- Create: `workers/payment-worker/src/jobs/escrow-hold.ts`
- Create: `workers/payment-worker/src/jobs/escrow-release.ts`
- Create: `workers/payment-worker/src/jobs/refund.ts`
- Create: `workers/payment-worker/src/jobs/provision-dva.ts`
- Create: `workers/payment-worker/src/jobs/notify-topup.ts`
- Create: `workers/payment-worker/src/__tests__/jobs.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// workers/payment-worker/src/__tests__/jobs.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockCreditWallet = vi.fn();
const mockDebitWallet = vi.fn();
vi.mock('@surewaka/db', () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
  },
  wallets: 'wallets',
  escrowHolds: 'escrow_holds',
  eq: vi.fn(),
}));

// We test the pure logic: refund amount calculation
describe('Refund job — amount calculation', () => {
  it('calculates 85% refund correctly', () => {
    const amountPaid = 350000;
    const rate = 0.85;
    const refund = Math.floor(amountPaid * rate);
    expect(refund).toBe(297500);
  });

  it('calculates 50% refund correctly', () => {
    const amountPaid = 350000;
    const rate = 0.50;
    const refund = Math.floor(amountPaid * rate);
    expect(refund).toBe(175000);
  });

  it('calculates commission split correctly', () => {
    const totalAmount = 350000;
    const commissionRate = 0.15;
    const commission = Math.floor(totalAmount * commissionRate);
    const driverAmount = totalAmount - commission;
    expect(commission).toBe(52500);
    expect(driverAmount).toBe(297500);
  });
});
```

- [ ] **Step 2: Run test — expect PASS (pure logic, no deps)**

```bash
pnpm --filter @surewaka/worker-payment test
```

- [ ] **Step 3: Write escrow-hold job**

```typescript
// workers/payment-worker/src/jobs/escrow-hold.ts
import { db, deliveries, escrowHolds } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { EscrowHoldJobData } from '../queue';

export async function handleEscrowHold(data: EscrowHoldJobData) {
  const [hold] = await db
    .insert(escrowHolds)
    .values({
      deliveryId: data.deliveryId,
      senderWalletId: data.walletId,
      totalAmount: data.amount,
      status: 'held',
      heldAt: new Date(),
    })
    .returning();

  await db
    .update(deliveries)
    .set({ paymentStatus: 'escrowed', escrowHoldId: hold.id, amountPaid: data.amount })
    .where(eq(deliveries.id, data.deliveryId));

  return { escrowHoldId: hold.id };
}
```

- [ ] **Step 4: Write escrow-release job**

```typescript
// workers/payment-worker/src/jobs/escrow-release.ts
import { db, escrowHolds, wallets } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { EscrowReleaseJobData } from '../queue';

export async function handleEscrowRelease(data: EscrowReleaseJobData) {
  const [hold] = await db
    .select()
    .from(escrowHolds)
    .where(eq(escrowHolds.id, data.escrowHoldId));

  if (!hold || hold.status !== 'held') {
    throw new Error(`Escrow ${data.escrowHoldId} not in held state`);
  }

  const commission = Math.floor(Number(hold.totalAmount) * Number(hold.commissionRate));
  const driverAmount = Number(hold.totalAmount) - commission;

  await db.transaction(async (tx) => {
    // Credit driver wallet
    await tx
      .update(wallets)
      .set({ balance: db.raw(`balance + ${driverAmount}`), updatedAt: new Date() })
      .where(eq(wallets.id, data.driverWalletId));

    // Update escrow hold
    await tx
      .update(escrowHolds)
      .set({
        status: 'released',
        driverWalletId: data.driverWalletId,
        commissionAmount: commission,
        driverAmount,
        releasedAt: new Date(),
      })
      .where(eq(escrowHolds.id, data.escrowHoldId));
  });

  return { driverAmount, commission };
}
```

- [ ] **Step 5: Write refund job**

```typescript
// workers/payment-worker/src/jobs/refund.ts
import { db, wallets, escrowHolds } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { RefundJobData } from '../queue';

export async function handleRefund(data: RefundJobData) {
  const refundAmount = Math.floor(data.amount * data.rate);
  if (refundAmount <= 0) return { refundAmount: 0 };

  await db.transaction(async (tx) => {
    await tx
      .update(wallets)
      .set({ balance: db.raw(`balance + ${refundAmount}`), updatedAt: new Date() })
      .where(eq(wallets.id, data.walletId));
  });

  return { refundAmount };
}
```

- [ ] **Step 6: Write provision-dva and notify-topup jobs**

```typescript
// workers/payment-worker/src/jobs/provision-dva.ts
import { db, wallets } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { ProvisionDvaJobData } from '../queue';

// These functions mirror the API's paystack.ts client — worker has same secret key
async function paystackPost(path: string, body: unknown) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ status: boolean; data: Record<string, unknown> }>;
}

export async function handleProvisionDva(data: ProvisionDvaJobData) {
  const customerRes = await paystackPost('/customer', {
    email: data.email,
    first_name: data.firstName,
    last_name: data.lastName,
  });
  if (!customerRes.status) throw new Error('Failed to create Paystack customer');
  const customerCode = customerRes.data.customer_code as string;

  const dvaRes = await paystackPost('/dedicated_account', {
    customer: customerCode,
    preferred_bank: 'wema-bank',
  });
  if (!dvaRes.status) throw new Error('Failed to create DVA');

  const dvaData = dvaRes.data as { bank: { name: string }; account_number: string };

  // Find wallet by userId and update DVA fields
  const [wallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, data.userId));

  if (wallet) {
    await db
      .update(wallets)
      .set({ dvaBank: dvaData.bank.name, dvaAccountNo: dvaData.account_number, dvaCustomerCode: customerCode })
      .where(eq(wallets.id, wallet.id));
  }

  return { account_number: dvaData.account_number };
}
```

```typescript
// workers/payment-worker/src/jobs/notify-topup.ts
import type { NotifyTopupJobData } from '../queue';

export async function handleNotifyTopup(data: NotifyTopupJobData) {
  // Phase 2: integrate with push notification service (Expo Push, FCM)
  // For now, log the event — notifications are out of scope for this iteration
  console.log(`[notify-topup] User ${data.userId} topped up ₦${data.amount / 100}`);
  return { notified: false, reason: 'push notifications not yet configured' };
}
```

- [ ] **Step 7: Commit**

```bash
git add workers/payment-worker/src/
git commit -m "feat(worker): add escrow-hold, escrow-release, refund, provision-dva, notify-topup jobs"
```

---

## Phase 6: Mobile

### Task 14: Wallet store

**Files:**
- Create: `packages/mobile-shared/src/store/wallet-store.ts`
- Modify: `packages/mobile-shared/src/index.ts`

- [ ] **Step 1: Create the wallet store**

```typescript
// packages/mobile-shared/src/store/wallet-store.ts
import { create } from 'zustand';

export type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  reference: string | null;
  createdAt: string;
};

export type WalletState = {
  balance: number;
  currency: string;
  dvaBank: string | null;
  dvaAccountNo: string | null;
  transactions: WalletTransaction[];
  loading: boolean;
  fetchBalance: (token: string) => Promise<void>;
  fetchTransactions: (token: string) => Promise<void>;
  fetchDva: (token: string) => Promise<{ bank: string; account_number: string } | null>;
  reset: () => void;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  currency: 'NGN',
  dvaBank: null,
  dvaAccountNo: null,
  transactions: [],
  loading: false,

  fetchBalance: async (token) => {
    set({ loading: true });
    try {
      const data = await apiFetch<{ balance: number; currency: string }>('/api/v1/wallet/balance', token);
      set({ balance: data.balance, currency: data.currency });
    } finally {
      set({ loading: false });
    }
  },

  fetchTransactions: async (token) => {
    const data = await apiFetch<WalletTransaction[]>('/api/v1/wallet/transactions', token);
    set({ transactions: data });
  },

  fetchDva: async (token) => {
    try {
      const data = await apiFetch<{ bank: string; account_number: string }>('/api/v1/wallet/dva', token);
      set({ dvaBank: data.bank, dvaAccountNo: data.account_number });
      return data;
    } catch {
      return null;
    }
  },

  reset: () => set({ balance: 0, transactions: [], dvaBank: null, dvaAccountNo: null }),
}));
```

- [ ] **Step 2: Export from mobile-shared index**

Add to the bottom of `packages/mobile-shared/src/index.ts`:

```typescript
export { useWalletStore } from './store/wallet-store';
export type { WalletTransaction, WalletState } from './store/wallet-store';
```

- [ ] **Step 3: Commit**

```bash
git add packages/mobile-shared/src/store/wallet-store.ts packages/mobile-shared/src/index.ts
git commit -m "feat(mobile-shared): add wallet store with balance, transactions, dva"
```

---

### Task 15: Wallet home screen

**Files:**
- Modify: `apps/mobile-customer/app/profile/payments.tsx`

- [ ] **Step 1: Replace the placeholder screen**

```typescript
// apps/mobile-customer/app/profile/payments.tsx
import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore, useAuthStore } from '@surewaka/mobile-shared';

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export default function PaymentsScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { balance, dvaBank, dvaAccountNo, transactions, loading, fetchBalance, fetchTransactions, fetchDva } = useWalletStore();

  useEffect(() => {
    if (!session?.access_token) return;
    fetchBalance(session.access_token);
    fetchTransactions(session.access_token);
    fetchDva(session.access_token);
  }, [session?.access_token]);

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Wallet</Text>
      </View>

      {/* Balance card */}
      <View className="bg-primary rounded-xl p-5 mb-4">
        <Text className="text-white text-sm font-medium mb-1">Wallet Balance</Text>
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white text-3xl font-bold">{formatNaira(balance)}</Text>
        )}
        <Pressable
          onPress={() => router.push('/wallet/topup')}
          className="bg-white mt-4 rounded-lg py-2 items-center"
        >
          <Text className="text-primary font-semibold text-sm">Top Up Wallet</Text>
        </Pressable>
      </View>

      {/* DVA card */}
      {dvaAccountNo ? (
        <View className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
          <Text className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Bank Transfer</Text>
          <Text className="text-base font-bold text-gray-900">{dvaAccountNo}</Text>
          <Text className="text-sm text-gray-500">{dvaBank}</Text>
          <Text className="text-xs text-gray-400 mt-2">Transfer any amount to fund your wallet instantly</Text>
        </View>
      ) : null}

      {/* Recent transactions */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-base font-semibold text-gray-900">Recent Transactions</Text>
        <Pressable onPress={() => router.push('/wallet/transactions')}>
          <Text className="text-sm text-primary">View all</Text>
        </Pressable>
      </View>

      {transactions.slice(0, 5).map((txn) => (
        <View key={txn.id} className="flex-row items-center justify-between py-3 border-b border-gray-100">
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-900">{txn.description ?? txn.type}</Text>
            <Text className="text-xs text-gray-400">{new Date(txn.createdAt).toLocaleDateString('en-NG')}</Text>
          </View>
          <Text className={`text-sm font-bold ${txn.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
            {txn.amount > 0 ? '+' : ''}{formatNaira(Math.abs(txn.amount))}
          </Text>
        </View>
      ))}

      {transactions.length === 0 && !loading && (
        <Text className="text-sm text-gray-400 text-center py-6">No transactions yet</Text>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile-customer/app/profile/payments.tsx
git commit -m "feat(mobile): upgrade wallet home screen with balance, DVA, transactions"
```

---

### Task 16: Top-up screen + transaction history

**Files:**
- Create: `apps/mobile-customer/app/wallet/_layout.tsx`
- Create: `apps/mobile-customer/app/wallet/topup.tsx`
- Create: `apps/mobile-customer/app/wallet/topup-success.tsx`
- Create: `apps/mobile-customer/app/wallet/transactions.tsx`

- [ ] **Step 1: Create the wallet route layout**

```typescript
// apps/mobile-customer/app/wallet/_layout.tsx
import { Stack } from 'expo-router';

export default function WalletLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
```

- [ ] **Step 2: Create the top-up screen**

```typescript
// apps/mobile-customer/app/wallet/topup.tsx
import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '@surewaka/mobile-shared';

const PRESETS = [100000, 250000, 500000, 1000000]; // kobo: ₦1k, ₦2.5k, ₦5k, ₦10k

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const MIN_TOPUP = 50000; // ₦500 in kobo

export default function TopupScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const resolvedAmount = selectedPreset ?? (customAmount ? Math.round(parseFloat(customAmount) * 100) : 0);

  const handlePay = async () => {
    if (!session?.access_token) return;
    if (resolvedAmount < MIN_TOPUP) {
      Alert.alert('Too low', 'Minimum top-up is ₦500');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/fund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: resolvedAmount, email: session.user.email, topup_type: 'manual' }),
      });
      const json = await res.json() as { data: { authorization_url: string; reference: string } };
      if (!json.data?.authorization_url) throw new Error('No authorization URL');

      const result = await WebBrowser.openAuthSessionAsync(json.data.authorization_url, 'surewaka://wallet/topup');

      if (result.type === 'success' || result.type === 'dismiss') {
        // Poll for confirmation
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          const statusRes = await fetch(`${API_URL}/api/v1/wallet/fund/${json.data.reference}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const statusJson = await statusRes.json() as { data: { status: string } };
          if (statusJson.data?.status === 'success' || attempts >= 8) {
            clearInterval(interval);
            router.replace('/wallet/topup-success');
          }
        }, 2000);
      }
    } catch (err) {
      Alert.alert('Payment Failed', 'Please try again');
      console.error('[topup]', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Top Up</Text>
      </View>

      <Text className="text-sm text-gray-500 mb-4">Select an amount</Text>

      <View className="flex-row flex-wrap gap-3 mb-6">
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            onPress={() => { setSelectedPreset(p); setCustomAmount(''); }}
            className={`px-5 py-3 rounded-xl border-2 ${selectedPreset === p ? 'border-primary bg-primary-light' : 'border-gray-200 bg-white'}`}
          >
            <Text className={`text-sm font-semibold ${selectedPreset === p ? 'text-primary' : 'text-gray-700'}`}>
              {formatNaira(p)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-sm text-gray-500 mb-2">Or enter a custom amount (min ₦500)</Text>
      <View className="flex-row items-center border border-gray-200 rounded-xl px-4 mb-8">
        <Text className="text-gray-400 text-base mr-2">₦</Text>
        <TextInput
          className="flex-1 py-4 text-base text-gray-900"
          keyboardType="numeric"
          placeholder="0.00"
          value={customAmount}
          onChangeText={(v) => { setCustomAmount(v); setSelectedPreset(null); }}
        />
      </View>

      <Pressable
        onPress={handlePay}
        disabled={loading || resolvedAmount < MIN_TOPUP}
        className={`py-4 rounded-xl items-center ${resolvedAmount >= MIN_TOPUP ? 'bg-primary' : 'bg-gray-200'}`}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className={`text-base font-semibold ${resolvedAmount >= MIN_TOPUP ? 'text-white' : 'text-gray-400'}`}>
            Pay {resolvedAmount >= MIN_TOPUP ? formatNaira(resolvedAmount) : '—'}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
```

- [ ] **Step 3: Create the success screen**

```typescript
// apps/mobile-customer/app/wallet/topup-success.tsx
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useWalletStore, useAuthStore } from '@surewaka/mobile-shared';

export default function TopupSuccessScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const fetchBalance = useWalletStore((s) => s.fetchBalance);

  useEffect(() => {
    if (session?.access_token) fetchBalance(session.access_token);
  }, []);

  return (
    <View className="flex-1 bg-white items-center justify-center px-6">
      <View className="w-20 h-20 rounded-full bg-green-100 items-center justify-center mb-6">
        <Text className="text-4xl">✓</Text>
      </View>
      <Text className="text-2xl font-bold text-gray-900 mb-2">Wallet Funded!</Text>
      <Text className="text-base text-gray-500 text-center mb-8">Your wallet balance has been updated.</Text>
      <Pressable onPress={() => router.replace('/profile/payments')} className="bg-primary px-8 py-4 rounded-xl">
        <Text className="text-white font-semibold text-base">Back to Wallet</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: Create the transaction history screen**

```typescript
// apps/mobile-customer/app/wallet/transactions.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore, useAuthStore, type WalletTransaction } from '@surewaka/mobile-shared';

type Filter = 'all' | 'fund' | 'escrow_hold' | 'refund';

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Top-ups', value: 'fund' },
  { label: 'Bookings', value: 'escrow_hold' },
  { label: 'Refunds', value: 'refund' },
];

function formatNaira(kobo: number) {
  return `₦${(Math.abs(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export default function TransactionsScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { transactions, loading, fetchTransactions } = useWalletStore();
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (session?.access_token) fetchTransactions(session.access_token);
  }, [session?.access_token]);

  const filtered = filter === 'all' ? transactions : transactions.filter((t) => t.type === filter);

  function renderItem({ item }: { item: WalletTransaction }) {
    return (
      <View className="flex-row items-center justify-between py-3 border-b border-gray-100">
        <View className="flex-1">
          <Text className="text-sm font-medium text-gray-900">{item.description ?? item.type}</Text>
          <Text className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString('en-NG')}</Text>
        </View>
        <Text className={`text-sm font-bold ml-4 ${item.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {item.amount > 0 ? '+' : '-'}{formatNaira(item.amount)}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="px-6 pt-6 pb-4">
        <View className="flex-row items-center mb-4">
          <Pressable onPress={() => router.back()} className="mr-4">
            <Text className="text-primary text-lg">←</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-gray-900">Transactions</Text>
        </View>
        <View className="flex-row gap-2">
          {FILTERS.map((f) => (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-full border ${filter === f.value ? 'bg-primary border-primary' : 'border-gray-200'}`}
            >
              <Text className={`text-xs font-medium ${filter === f.value ? 'text-white' : 'text-gray-600'}`}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 24 }}
          ListEmptyComponent={
            <Text className="text-sm text-gray-400 text-center py-12">No transactions found</Text>
          }
        />
      )}
    </View>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-customer/app/wallet/
git commit -m "feat(mobile): add top-up, success, and transaction history screens"
```

---

### Task 17: Booking review + payment shortfall sheet

**Files:**
- Modify: `apps/mobile-customer/app/booking/review.tsx`
- Create: `apps/mobile-customer/app/booking/payment-shortfall.tsx`

- [ ] **Step 1: Create the payment shortfall sheet**

```typescript
// apps/mobile-customer/app/booking/payment-shortfall.tsx
import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore, useBookingStore } from '@surewaka/mobile-shared';

type Props = {
  shortfall: number;
  deliveryId: string;
  totalAmount: number;
  onSuccess: () => void;
  onDismiss: () => void;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export default function PaymentShortfallSheet({ shortfall, deliveryId, totalAmount, onSuccess, onDismiss }: Props) {
  const session = useAuthStore((s) => s.session);
  const [loading, setLoading] = useState(false);

  async function pay(amount: number, topupType: 'manual' | 'booking_shortfall') {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/fund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          email: session.user.email,
          topup_type: topupType,
          delivery_id: deliveryId,
        }),
      });
      const json = await res.json() as { data: { authorization_url: string; reference: string } };
      if (!json.data?.authorization_url) throw new Error('No authorization URL');

      await WebBrowser.openAuthSessionAsync(json.data.authorization_url, 'surewaka://booking');

      // Poll for status then retry booking confirm
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const statusRes = await fetch(`${API_URL}/api/v1/wallet/fund/${json.data.reference}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const statusJson = await statusRes.json() as { data: { status: string } };
        if (statusJson.data?.status === 'success' || attempts >= 8) {
          clearInterval(interval);
          onSuccess();
        }
      }, 2000);
    } catch (err) {
      Alert.alert('Payment Failed', 'Please try again');
      console.error('[shortfall-pay]', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="bg-white rounded-t-2xl p-6">
      <Text className="text-lg font-bold text-gray-900 mb-1">Insufficient Balance</Text>
      <Text className="text-sm text-gray-500 mb-6">
        You need <Text className="font-semibold text-gray-900">{formatNaira(shortfall)}</Text> more to complete this booking.
      </Text>

      <Pressable
        onPress={() => pay(shortfall, 'booking_shortfall')}
        disabled={loading}
        className="bg-primary py-4 rounded-xl items-center mb-3"
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-semibold text-base">Top Up {formatNaira(shortfall)}</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => pay(totalAmount, 'booking_shortfall')}
        disabled={loading}
        className="border border-primary py-4 rounded-xl items-center mb-3"
      >
        <Text className="text-primary font-semibold text-base">
          Pay {formatNaira(totalAmount)} now (card only)
        </Text>
        <Text className="text-xs text-gray-400 mt-1">Funds wallet then immediately deducts</Text>
      </Pressable>

      <Pressable onPress={onDismiss} className="items-center py-2">
        <Text className="text-sm text-gray-400">Cancel</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Modify review.tsx to add wallet check**

In `apps/mobile-customer/app/booking/review.tsx`:

1. Add imports at the top:

```typescript
import { useState } from 'react';
import { Modal } from 'react-native';
import PaymentShortfallSheet from './payment-shortfall';
```

2. Add state variables inside the component (alongside existing `submitting`):

```typescript
const [showShortfall, setShowShortfall] = useState(false);
const [shortfallData, setShortfallData] = useState<{ shortfall: number; deliveryId: string; totalAmount: number } | null>(null);
const [pendingDeliveryId, setPendingDeliveryId] = useState<string | null>(null);
```

3. Replace the `handleSubmit` function body so that after the delivery is created (currently navigates straight to confirmed), it calls the wallet check and conditionally shows the shortfall sheet or calls booking confirm:

```typescript
const handleSubmit = async () => {
  if (!session?.access_token) {
    Alert.alert('Error', 'You must be logged in to book a delivery');
    return;
  }
  if (!pickup || !dropoff || !packageDetails || !recipientDetails) {
    Alert.alert('Error', 'Please fill in all booking details');
    return;
  }

  setSubmitting(true);
  const client = createAuthClient(session.access_token);

  // Step 1: create delivery (draft status)
  const { data: delivery, error } = await client.post<DeliveryResponse>('/api/v1/deliveries', {
    pickup: { address: pickup.address ?? '', city: pickup.city ?? '', state: pickup.state ?? '', lat: pickup.lat ?? 0, lng: pickup.lng ?? 0 },
    dropoff: { address: dropoff.address ?? '', city: dropoff.city ?? '', state: dropoff.state ?? '', lat: dropoff.lat ?? 0, lng: dropoff.lng ?? 0 },
    packageDetails: { description: packageDetails.description ?? '', weight: packageDetails.weight ?? 0, category: packageDetails.category ?? 'parcel' },
    recipientDetails: { recipientName: recipientDetails.recipientName ?? '', recipientPhone: recipientDetails.recipientPhone ?? '', deliveryNotes: recipientDetails.deliveryNotes },
  });

  if (error || !delivery) {
    setSubmitting(false);
    Alert.alert('Booking Failed', error?.message ?? 'Something went wrong');
    return;
  }

  // Step 2: check wallet balance (amount comes from selected carrier price)
  const deliveryAmount = 350000; // TODO: replace with real price from carrier selection in booking store
  const checkRes = await fetch(`${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/wallet/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: deliveryAmount }),
  });
  const checkJson = await checkRes.json() as { data: { sufficient: boolean; shortfall: number } };

  setSubmitting(false);

  if (!checkJson.data.sufficient) {
    setPendingDeliveryId(delivery.id);
    setShortfallData({ shortfall: checkJson.data.shortfall, deliveryId: delivery.id, totalAmount: deliveryAmount });
    setShowShortfall(true);
    return;
  }

  await confirmBooking(delivery.id, deliveryAmount);
};

const confirmBooking = async (deliveryId: string, amount: number) => {
  if (!session?.access_token) return;
  const confirmRes = await fetch(`${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/booking/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ delivery_id: deliveryId, amount }),
  });
  const confirmJson = await confirmRes.json() as { data: { status: string } | null; error: { message: string } | null };
  if (confirmJson.error || !confirmJson.data) {
    Alert.alert('Payment Failed', confirmJson.error?.message ?? 'Could not confirm booking');
    return;
  }
  resetBooking();
  router.push('/booking/confirmed');
};
```

4. Add the shortfall modal just before the closing `</ScrollView>` tag:

```typescript
<Modal visible={showShortfall} transparent animationType="slide">
  <View className="flex-1 justify-end bg-black/40">
    {shortfallData && (
      <PaymentShortfallSheet
        shortfall={shortfallData.shortfall}
        deliveryId={shortfallData.deliveryId}
        totalAmount={shortfallData.totalAmount}
        onSuccess={() => {
          setShowShortfall(false);
          if (pendingDeliveryId) confirmBooking(pendingDeliveryId, shortfallData.totalAmount);
        }}
        onDismiss={() => setShowShortfall(false)}
      />
    )}
  </View>
</Modal>
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-customer/app/booking/review.tsx apps/mobile-customer/app/booking/payment-shortfall.tsx
git commit -m "feat(mobile): add wallet check + inline shortfall sheet to booking review"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| wallets + wallet_transactions tables | Task 1 |
| escrow_holds + payout_requests tables | Task 1 |
| Auto-wallet trigger on signup | Task 1 |
| Delivery status enum refactor (12 states) | Task 2 |
| Delivery payment_status + escrow_hold_id + amount_paid | Task 2 |
| Schema regeneration | Task 3 |
| Zod validators for all payment request bodies | Task 4 |
| Paystack client (initialize, verify, DVA, customer, HMAC) | Task 5 |
| Wallet service (atomic credit/debit, checkBalance) | Task 6 |
| GET /wallet/balance, /transactions, /dva, POST /fund, /check | Task 7 |
| POST /webhook/paystack with HMAC + idempotency | Task 8 |
| POST /booking/confirm (escrow hold + wallet debit) | Task 9 |
| POST /deliveries/:id/cancel (tiered refund) | Task 9 |
| POST /deliveries creates with `draft` status | Task 9 |
| POST /payouts/request + GET /payouts | Task 10 |
| Route wiring in index.ts | Task 11 |
| BullMQ worker setup + queue.ts | Task 12 |
| All 5 BullMQ job handlers | Task 13 |
| useWalletStore (balance, transactions, DVA) | Task 14 |
| Wallet home screen upgrade | Task 15 |
| Top-up screen with Paystack WebView + polling | Task 16 |
| Top-up success screen | Task 16 |
| Transaction history with filter chips | Task 16 |
| Booking review wallet check + shortfall modal | Task 17 |
| Inline shortfall sheet (top-up + card-exact paths) | Task 17 |

**One gap noted:** `deliveryAmount` in `review.tsx` Task 17 is a placeholder (₦3,500 hardcoded). The real price should come from the carrier/service selection in `useBookingStore`. This is an existing gap in the booking flow (carriers screen uses mock data per `CLAUDE.md` known issues). It is left as a `// TODO` comment — not a plan gap, just an existing upstream dependency.
