# ADR-006: Wallet-First Payment Model with Local Ledger

## Status

Accepted

## Context

SureWaka needs a payment model for its booking flow. The platform connects senders with carriers/drivers, so payment must handle:
- Sender pays before delivery (to guarantee driver compensation)
- Funds held until delivery confirmed (to protect sender)
- Commission extraction (SureWaka's revenue)
- Driver/carrier payouts

The Nigerian logistics market has largely moved away from Payment on Delivery due to fraud and operational risk. Existing players (GIG Logistics, Kwik, Sendbox) all use prepaid models.

## Decision

### Payment Model: Wallet-First with Escrow

Users fund a wallet, which is debited instantly at booking. Funds move to escrow until delivery is confirmed, then released to the driver minus commission.

**Flow:**
```
Fund Wallet (Paystack) → Book Delivery (wallet debit → escrow) → Deliver → Confirm → Release (driver wallet + commission)
```

New users without wallet balance can pay inline via card as a fallback (which also funds their wallet).

### Implementation: Local Ledger (not third-party wallet)

The wallet is implemented as a double-entry ledger in our own Postgres database. External services are only used for money-in (Paystack card/transfer) and money-out (Paystack Transfers for payouts).

## Rationale

### Why Wallet-First (not pay-per-booking)

- **Lower transaction fees**: Paystack charges 1.5% per card charge. Users fund ₦10,000 once (₦150 fee) and make 5 bookings vs. 5 separate charges (₦750 in fees).
- **Instant booking**: No payment gateway latency in the critical path. Wallet debit is a DB operation (<50ms vs 5-15s for card).
- **Matches Nigerian user behavior**: Bolt, OPay, PalmPay — users understand "fund once, spend many."
- **Reduced abandonment**: Every Paystack modal is a drop-off point (OTP timeout, bank downtime). Wallet eliminates this for repeat users.
- **Cash flow**: Float sits in SureWaka's Paystack balance before any delivery work starts.

### Why Local Ledger (not third-party wallet API)

- **Full control of escrow logic**: Hold, release, partial refund, dispute resolution — all custom business rules.
- **No revenue share**: Wallet-to-escrow and escrow-to-driver are free DB operations. Third-party wallet APIs charge per movement.
- **No external dependency for booking**: If Paystack is down, existing wallet balances still work. Only funding is blocked.
- **Custom commission extraction**: Automatic percentage deduction before driver release — no API call needed.
- **Data ownership**: Complete transaction history in our DB for analytics, disputes, auditing.

### CBN Licensing

A stored-value wallet for a specific service (delivery payments) does not require a PSP license when:
- Funds enter via licensed gateways (Paystack)
- No banking services offered (no interest, no general P2P)
- Wallet is purpose-specific (delivery payments only)

This is the model used by GIG Logistics, Bolt, Kwik, and every ride-hailing app in Nigeria.

## Architecture

### Database Schema

```sql
-- Wallet per user (sender, driver, carrier)
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  balance BIGINT NOT NULL DEFAULT 0,  -- stored in kobo (smallest unit)
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'active', -- active, frozen, closed
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, currency)
);

-- Immutable transaction log (append-only)
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  type TEXT NOT NULL, -- fund, debit, escrow_hold, escrow_release, refund, payout, commission
  amount BIGINT NOT NULL, -- positive = credit, negative = debit (in kobo)
  balance_after BIGINT NOT NULL, -- wallet balance after this transaction
  reference TEXT UNIQUE, -- external reference (Paystack ref, delivery ID, etc.)
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Escrow holds for active deliveries
CREATE TABLE escrow_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  sender_wallet_id UUID NOT NULL REFERENCES wallets(id),
  amount BIGINT NOT NULL, -- total held (in kobo)
  commission_amount BIGINT NOT NULL DEFAULT 0, -- SureWaka's cut
  driver_amount BIGINT NOT NULL DEFAULT 0, -- amount for driver/carrier
  status TEXT NOT NULL DEFAULT 'held', -- held, released, refunded, disputed
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Money Flow

```
FUNDING:
  User → Paystack (card/transfer/USSD) → Webhook → wallet_transactions(type: 'fund') → wallet.balance += amount

BOOKING:
  Check wallet.balance >= price
  wallet_transactions(type: 'escrow_hold', amount: -price)
  wallet.balance -= price
  escrow_holds(delivery_id, amount: price, status: 'held')

DELIVERY CONFIRMED:
  escrow_holds.status = 'released'
  commission = price * 0.15 (15% example)
  wallet_transactions(type: 'commission', wallet: surewaka_wallet, +commission)
  wallet_transactions(type: 'escrow_release', wallet: driver_wallet, +(price - commission))
  driver_wallet.balance += (price - commission)

REFUND (cancelled before pickup):
  escrow_holds.status = 'refunded'
  wallet_transactions(type: 'refund', wallet: sender_wallet, +price)
  sender_wallet.balance += price

DRIVER PAYOUT (weekly/on-demand):
  Paystack Transfers API → driver's bank account
  wallet_transactions(type: 'payout', wallet: driver_wallet, -amount)
  driver_wallet.balance -= amount
```

### Safeguards

- **Balance stored in kobo** (integers) — no floating point rounding errors
- **balance_after on every transaction** — enables reconciliation without replaying history
- **Unique reference constraint** — prevents double-processing of Paystack webhooks
- **Row-level locking** on wallet during debit — prevents double-spend on concurrent bookings
- **Append-only transactions** — never update/delete, only insert new rows

### External Dependencies

| Layer | Service | When it's needed |
|-------|---------|-----------------|
| Money in | Paystack (Charge API) | User funding wallet |
| Money out | Paystack (Transfers API) | Driver/carrier weekly payouts |
| Webhook verification | Paystack webhook signature | Confirming successful charges |
| Everything else | Own Postgres | Wallet ops, escrow, commission |

## Consequences

**Positive:**
- Sub-50ms booking confirmation (no external payment call)
- 5-10x fewer Paystack fees (bulk funding vs per-booking charges)
- Full control of escrow timing and dispute resolution
- Driver trust — guaranteed payment visible in their wallet
- Works during Paystack outages (for users with existing balance)

**Negative:**
- Must build reconciliation tooling (cron comparing Paystack webhooks vs ledger)
- Must handle edge cases carefully (concurrent bookings, race conditions)
- Admin dashboard needs wallet management features (freeze, adjust, audit)
- Need to implement payout scheduling (weekly batch or on-demand)

## Alternatives Considered

1. **Pay-to-confirm (card every booking)** — Rejected: too much friction, high abandonment, expensive in fees
2. **Pay-on-accept (pay after driver accepts)** — Rejected: driver waits for payment, timeout risk, terrible driver experience
3. **Third-party wallet API (Flutterwave/OPay)** — Rejected: revenue share, no escrow control, external dependency for core flow
4. **Payment on Delivery** — Rejected: fraud risk, driver safety concerns, industry has moved away from this

## When to Revisit

- When holding >₦500M in wallets — may need CBN engagement
- If Paystack introduces a wallet-as-a-service product with better terms
- If we add P2P transfers between users (would need licensing review)
- When expanding beyond Nigeria (multi-currency wallet support)
