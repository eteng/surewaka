# Payment Gateway Design — SureWaka

**Date:** 2026-06-04  
**Status:** Approved  
**Stack:** Paystack · Hono API (Fly.io) · BullMQ · Expo/React Native

---

## Summary

Wallet-first payment system. Customers fund a wallet via Paystack (card or bank transfer); bookings deduct from the wallet via escrow. Drivers earn into a wallet and withdraw to bank on demand (manual payouts at launch, automated in phase 2). The wallet is always the ledger — Paystack is only touched at top-up time.

---

## 1. Architecture & Flow

### Normal top-up

```
Mobile → POST /api/v1/wallet/fund
       → API creates Paystack transaction (server-side, secret key)
       → Returns { reference, authorization_url }
Mobile → Opens authorization_url in in-app WebView
       → User pays (card or bank transfer)
       → Paystack POSTs charge.success to /api/v1/webhook/paystack
       → API verifies HMAC-SHA512 signature
       → Atomic DB transaction: INSERT wallet_transactions + UPDATE wallets.balance
Mobile → Polls GET /api/v1/wallet/fund/:reference (2s interval, max 15s)
       → Shows success, balance updated
```

### DVA (Dedicated Virtual Account) top-up

```
Mobile → GET /api/v1/wallet/dva (provisions on first call)
       → User sees permanent bank account number (Wema/Titan Trust)
       → User transfers any amount at any time via their bank app
       → Paystack fires charge.success → same webhook handler
       → Wallet credited automatically
```

### Booking payment (escrow)

```
review.tsx → POST /api/v1/deliveries (creates delivery, status=draft, payment_status=unpaid)
           → POST /api/v1/wallet/check { amount }
           → If sufficient: POST /api/v1/booking/confirm { delivery_id, amount }
               → Single atomic DB transaction: wallet debit + escrow_hold insert
               → delivery.status = pending, delivery.payment_status = escrowed
               → Navigate to confirmed.tsx
           → If insufficient: inline BottomSheet (booking context + delivery_id preserved)
               Option A: "Top Up ₦X" — pre-filled shortfall → Paystack WebView
                         On webhook success: auto-retry POST /api/v1/booking/confirm
               Option B: "Pay ₦X now" — exact card payment
                         On webhook success: single atomic transaction —
                           wallet credit (fund) + wallet debit (escrow_hold)
                           delivery.status = pending, delivery.payment_status = escrowed
                           net ₦0 balance change
                         Navigate to confirmed.tsx
```

### Delivery confirmed (escrow release)

```
Delivery status → delivered
→ BullMQ escrow-release job
→ driver_amount  = total × (1 − commission_rate)  [default 85%]
→ commission     = total × commission_rate         [default 15%]
→ INSERT wallet_transactions: driver wallet +driver_amount (type=escrow_release)
→ INSERT wallet_transactions: ops wallet    +commission    (type=commission)
→ UPDATE escrow_holds SET status=released
```

### Cancellation & refund (tiered)

| Delivery status at cancellation | Who cancels | Refund to customer wallet |
|---|---|---|
| `pending` (paid, unassigned) | customer | 100% |
| `accepted` (before en route) | customer | 100% |
| `en_route_pickup` | customer | 85% (15% cancellation fee) |
| `arrived_pickup` | customer | 85% (driver already committed, at location) |
| `picked_up` / `en_route_dropoff` / `arrived_dropoff` | customer | 50% (driver must return package) |
| `failed` | system | 100% |
| any stage | driver / system | 100% |
| `draft` | customer | N/A — no payment taken yet |

Refunds are wallet credits (`type=refund`). No Paystack reversals needed.  
`returned` status is set by the driver after completing a failed delivery return — no additional refund action (already refunded at `failed` stage).

---

## 2. Data Model

### New tables

Adopts and extends `docs/designs/wallet-schema.sql`.

```sql
-- wallets: one row per user, fast balance read
wallets (
  id              uuid PK
  user_id         uuid FK → auth.users UNIQUE per currency
  balance         bigint NOT NULL DEFAULT 0 CHECK (balance >= 0)  -- kobo
  currency        text NOT NULL DEFAULT 'NGN'
  status          wallet_status ('active','frozen','closed')
  dva_bank        text                    -- e.g. 'Wema Bank'
  dva_account_no  text                    -- permanent virtual account number
  dva_customer_code text                  -- Paystack customer code
  created_at      timestamptz
  updated_at      timestamptz
  UNIQUE(user_id, currency)
)

-- wallet_transactions: immutable ledger, source of truth
wallet_transactions (
  id            uuid PK
  wallet_id     uuid FK → wallets
  type          transaction_type
                ('fund','escrow_hold','escrow_release','refund',
                 'payout','commission','adjustment')
  amount        bigint NOT NULL  -- positive = credit, negative = debit (kobo)
  balance_after bigint NOT NULL  -- snapshot after this transaction
  reference     text UNIQUE      -- Paystack reference or internal ref
  description   text             -- human-readable
  metadata      jsonb DEFAULT {} -- Paystack event payload
  created_at    timestamptz
)

-- escrow_holds: per-delivery money reservation
escrow_holds (
  id                  uuid PK
  delivery_id         uuid FK → deliveries
  sender_wallet_id    uuid FK → wallets
  driver_wallet_id    uuid FK → wallets NULLABLE  -- set when driver assigned
  total_amount        bigint NOT NULL              -- kobo
  commission_rate     numeric(5,4) DEFAULT 0.1500
  commission_amount   bigint DEFAULT 0
  driver_amount       bigint DEFAULT 0
  status              escrow_status ('held','released','refunded','disputed','partially_refunded')
  held_at             timestamptz
  released_at         timestamptz
  refunded_at         timestamptz
  created_at          timestamptz
)

-- payout_requests: driver bank withdrawal tracking
payout_requests (
  id                      uuid PK
  wallet_id               uuid FK → wallets
  amount                  bigint NOT NULL CHECK (amount > 0)
  bank_code               text NOT NULL   -- e.g. '058' GTBank
  account_number          text NOT NULL
  account_name            text NOT NULL
  paystack_transfer_code  text
  paystack_recipient_code text
  status                  text DEFAULT 'pending'  -- pending/processing/completed/failed
  failure_reason          text
  processed_at            timestamptz
  created_at              timestamptz
)
```

### Changes to existing tables

```sql
-- deliveries: add payment tracking columns
ALTER TABLE deliveries
  ADD COLUMN payment_status text DEFAULT 'unpaid',  -- unpaid/escrowed/released/refunded
  ADD COLUMN escrow_hold_id uuid REFERENCES escrow_holds(id),
  ADD COLUMN amount_paid bigint;  -- kobo

-- delivery_status enum: full replacement (Postgres cannot remove enum values)
-- Migration strategy: create new type → alter column → drop old type
CREATE TYPE delivery_status_new AS ENUM (
  'draft',           -- booking started, not yet paid
  'pending',         -- paid, awaiting driver/carrier assignment
  'accepted',        -- driver/carrier accepted the job
  'en_route_pickup', -- driver heading to pickup location
  'arrived_pickup',  -- driver at pickup, waiting for sender
  'picked_up',       -- package collected, heading to recipient
  'en_route_dropoff',-- heading to recipient
  'arrived_dropoff', -- at recipient location
  'delivered',       -- recipient confirmed receipt
  'cancelled',       -- cancelled by sender, driver, or system
  'failed',          -- delivery attempt failed (recipient unavailable, etc.)
  'returned'         -- package returned to sender after failure
);

ALTER TABLE deliveries
  ALTER COLUMN status TYPE delivery_status_new
  USING status::text::delivery_status_new;

DROP TYPE delivery_status;
ALTER TYPE delivery_status_new RENAME TO delivery_status;
```

**Status state machine:**
```
draft → pending (on payment confirmed)
pending → accepted (driver accepts job)
accepted → en_route_pickup (driver starts moving)
en_route_pickup → arrived_pickup (driver at location)
arrived_pickup → picked_up (package collected)
picked_up → en_route_dropoff
en_route_dropoff → arrived_dropoff
arrived_dropoff → delivered (recipient confirms)
                → failed (recipient unavailable)
failed → returned (driver returns package to sender)
any non-terminal → cancelled
```

### Auto-wallet trigger

New users get a wallet automatically via `AFTER INSERT ON auth.users` trigger (from `wallet-schema.sql`).

### Storage unit

All monetary values stored as **kobo** (bigint). ₦1 = 100 kobo. Never use `real` or `float` for money.

---

## 3. API Layer

All endpoints under `apps/api/src/routes/` — new files: `wallet.ts`, `booking-payment.ts`, `webhook.ts`, `payouts.ts`.

```
-- Wallet (authenticated)
GET  /api/v1/wallet/balance              → { balance, currency }
GET  /api/v1/wallet/transactions         → paginated WalletTransaction[]
GET  /api/v1/wallet/dva                  → idempotent: return existing or provision new DVA
POST /api/v1/wallet/fund                 → { amount, email } → { reference, authorization_url }
GET  /api/v1/wallet/fund/:reference      → { status, amount } — mobile polling
POST /api/v1/wallet/check                → { amount } → { sufficient, balance, shortfall }

-- Booking payment (authenticated)
POST /api/v1/booking/confirm             → { delivery_id, amount } → escrow hold + wallet debit

-- Delivery cancellation (authenticated)
POST /api/v1/deliveries/:id/cancel       → tiered refund → wallet credit

-- Webhook (public — HMAC verified, no requireAuth)
POST /api/v1/webhook/paystack            → charge.success → credit wallet

-- Payouts (authenticated)
POST /api/v1/payouts/request             → { amount, bank_code, account_number, account_name }
GET  /api/v1/payouts                     → payout history
```

**Response shape:** follows existing pattern `{ data, error, meta }`.

**Zod validators** for all request bodies live in `packages/shared/src/validators.ts`.

**Top-up constraints:** minimum ₦500 (50,000 kobo). Presets: ₦1,000 / ₦2,500 / ₦5,000 / ₦10,000.

---

## 4. Mobile UX

### New / modified screens

```
apps/mobile-customer/app/
  profile/payments.tsx           — upgraded to wallet home (was empty placeholder)
  wallet/topup.tsx               — amount selection + Paystack WebView
  wallet/topup-success.tsx       — success confirmation
  wallet/transactions.tsx        — paginated ledger with filter chips
  booking/review.tsx             — modified: wallet check before confirm
  booking/payment-shortfall.tsx  — inline BottomSheet for insufficient balance
```

### Wallet home (`profile/payments.tsx`)

- Wallet balance card (fetched on screen focus)
- DVA card: bank name + account number + copy button
- "Top Up" button → `wallet/topup.tsx`
- Recent transactions (last 5) + "View all" → `wallet/transactions.tsx`

### Top-up screen (`wallet/topup.tsx`)

- Preset chips: ₦1,000 / ₦2,500 / ₦5,000 / ₦10,000
- Custom amount input (min ₦500, validated inline)
- "Pay" button → POST `/wallet/fund` → open `authorization_url` in WebView
- On WebView close: poll `/wallet/fund/:reference` every 2s (max 15s)
- Navigate to `topup-success.tsx` on confirmation

### Booking shortfall sheet (`booking/payment-shortfall.tsx`)

- Triggered from `review.tsx` when `/wallet/check` returns `sufficient: false`
- Booking context preserved in `useBookingStore`
- Shows: "You need ₦X more"
- Option A: "Top Up ₦X" — pre-filled shortfall, Paystack WebView, auto-retry confirm on success
- Option B: "Pay ₦X now (card only)" — exact amount, wallet credit + immediate debit, net ₦0

### Transaction history (`wallet/transactions.tsx`)

- Flat list, paginated (20 per page)
- Each row: type icon + description + signed amount (green credit / red debit) + date
- Filter chips: All / Top-ups / Bookings / Refunds

### State management

New `useWalletStore` in `packages/mobile-shared/src/store/wallet-store.ts` — balance, transactions, DVA details. Alongside existing `useBookingStore` and `useAuthStore`.

---

## 5. Webhook Handler & Payment Worker

### Webhook handler (`/api/v1/webhook/paystack`)

```
1. Verify X-Paystack-Signature (HMAC-SHA512, raw body, PAYSTACK_SECRET_KEY)
   → 400 immediately if invalid
2. Parse event type
3. charge.success:
   a. Idempotency check — look up wallet_transactions.reference
      → Already exists: return 200 (Paystack retries must be safe)
   b. Resolve user by email → get wallet
   c. Atomic DB transaction:
      - INSERT wallet_transactions (type='fund', +amount, balance_after)
      - UPDATE wallets.balance += amount
   d. If metadata.topup_type = 'booking_shortfall' && delivery_id present:
      - Queue escrow-hold job immediately
4. Always return 200 (log + alert internal errors separately)
```

### BullMQ jobs (`workers/payment-worker`)

| Job | Trigger | Action |
|---|---|---|
| `escrow-hold` | booking/confirm | Deduct wallet, insert escrow_hold row |
| `escrow-release` | delivery → delivered | Credit driver wallet + SureWaka commission |
| `refund` | delivery cancel | Credit customer wallet by tier percentage |
| `provision-dva` | first GET /wallet/dva | Call Paystack DVA API, store account details |
| `notify-topup` | charge.success | Push notification "₦X added to your wallet" |

### Payout flow (manual at launch)

- Driver requests payout via `POST /api/v1/payouts/request`
- Creates `payout_requests` row with status `pending`
- Ops team processes via Paystack Dashboard + marks status `completed`/`failed`
- Phase 2: automate via Paystack Transfers API using `paystack_transfer_code`

### Environment variables

```
PAYSTACK_SECRET_KEY    — API + worker only (never client)
PAYSTACK_PUBLIC_KEY    — mobile app only (checkout initialisation)
REDIS_URL              — BullMQ connection (payment worker, Fly.io)
```

---

## 6. File Map

| New file | Purpose |
|---|---|
| `supabase/migrations/*_add_wallet_payment_system.sql` | wallets, wallet_transactions, escrow_holds, payout_requests, triggers, RLS |
| `supabase/migrations/*_add_delivery_payment_columns.sql` | payment_status, escrow_hold_id, amount_paid on deliveries; en_route_to_pickup enum value |
| `apps/api/src/routes/wallet.ts` | Wallet endpoints |
| `apps/api/src/routes/booking-payment.ts` | POST /booking/confirm |
| `apps/api/src/routes/webhook.ts` | Paystack webhook |
| `apps/api/src/routes/payouts.ts` | Payout request + history |
| `apps/api/src/lib/paystack.ts` | Paystack API client (server-side) |
| `apps/api/src/lib/wallet-service.ts` | Atomic wallet debit/credit operations |
| `workers/payment-worker/src/jobs/escrow-hold.ts` | BullMQ job |
| `workers/payment-worker/src/jobs/escrow-release.ts` | BullMQ job |
| `workers/payment-worker/src/jobs/refund.ts` | BullMQ job |
| `workers/payment-worker/src/jobs/provision-dva.ts` | BullMQ job |
| `workers/payment-worker/src/jobs/notify-topup.ts` | BullMQ job |
| `packages/shared/src/validators.ts` | Zod schemas for all payment request bodies |
| `packages/mobile-shared/src/store/wallet-store.ts` | Zustand wallet state |
| `apps/mobile-customer/app/profile/payments.tsx` | Upgraded wallet home |
| `apps/mobile-customer/app/wallet/topup.tsx` | Top-up screen |
| `apps/mobile-customer/app/wallet/topup-success.tsx` | Success screen |
| `apps/mobile-customer/app/wallet/transactions.tsx` | Transaction history |
| `apps/mobile-customer/app/booking/payment-shortfall.tsx` | Inline shortfall sheet |

---

## 7. Out of Scope (Phase 2)

- Automated driver payouts via Paystack Transfers API
- Driver bank account KYC / verification
- USSD payment channel
- Dispute resolution flow
- Multi-currency support (schema supports it via `UNIQUE(user_id, currency)`)
- Real-time balance updates via Supabase Realtime (currently: poll on focus)
