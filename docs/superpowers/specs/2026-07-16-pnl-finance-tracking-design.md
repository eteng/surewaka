# P&L / Finance Tracking — Design Spec

**Date:** 2026-07-16
**Status:** Approved, pending implementation plan

---

## Overview

SureWaka needs a Finance page in the admin dashboard that shows true net profit — revenue earned from deliveries and withdrawal fees, minus operational costs (Paystack transaction fees) and infrastructure costs (Vercel, Fly.io, NeonDB, Clerk, Ably). Operational costs are captured in real time via ledger events; infrastructure costs are pulled daily from each provider's billing API.

---

## Architecture

### Two new DB tables

**`platform_ledger`** — one row per revenue or operational cost event, written in real time at the moment the underlying financial event occurs.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `type` | enum | See event types below |
| `amount_kobo` | bigint NOT NULL | Always positive — sign is implied by type prefix |
| `source_id` | uuid | ID of originating record |
| `source_type` | text | `escrow_hold`, `payout_request`, `wallet_transaction` |
| `occurred_at` | timestamptz | When the underlying event happened |
| `created_at` | timestamptz | |

`type` enum values:
- `revenue_commission` — SureWaka's cut from a completed delivery
- `revenue_withdrawal_fee` — flat ₦100 fee charged per payout request
- `cost_paystack_transfer` — Paystack fee on outgoing transfer
- `cost_paystack_collection` — Paystack fee on incoming wallet topup

**`cost_snapshots`** — one row per provider per day, written by the daily infrastructure cron.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `provider` | text | `vercel`, `fly`, `neon`, `clerk`, `ably` |
| `amount_usd` | numeric(12,4) | Cost in USD from provider API |
| `usd_to_ngn_rate` | numeric(10,2) | Exchange rate at time of snapshot |
| `amount_kobo` | bigint | `round(amount_usd × usd_to_ngn_rate × 100)` |
| `snapshot_date` | date | Calendar day this cost covers |
| `raw_response` | jsonb | Full provider API response for debugging |
| `created_at` | timestamptz | |

`UNIQUE(provider, snapshot_date)` — makes cron re-runs idempotent via upsert.

---

## Ledger Event Wiring

Three write points. All ledger inserts are **best-effort and non-blocking** — a failure must never prevent the primary financial operation from completing. Log errors; do not throw.

### A. Escrow release → commission revenue

**Where:** `workers/payment-worker/src/jobs/escrow-release.ts`, after the DB transaction commits.

```
INSERT platform_ledger (
  type = 'revenue_commission',
  amount_kobo = commissionAmount,       -- already computed in escrow-release.ts
  source_id = hold.id,
  source_type = 'escrow_hold',
  occurred_at = now()
)
```

### B. Transfer success → withdrawal fee revenue + Paystack transfer cost

**Where:** `apps/api/src/routes/webhook.ts`, `transfer.success` handler, after marking payout completed.

Two rows inserted:

```
INSERT platform_ledger (type = 'revenue_withdrawal_fee', amount_kobo = payout.feeKobo, ...)
INSERT platform_ledger (type = 'cost_paystack_transfer', amount_kobo = paystackTransferFee(payout.amount), ...)
```

**Paystack transfer fee formula** (from Paystack pricing page):

| Transfer amount | Fee |
|---|---|
| ≤ ₦5,000 (500,000 kobo) | ₦10 (1,000 kobo) |
| ₦5,001 – ₦50,000 | ₦25 (2,500 kobo) |
| > ₦50,000 | ₦50 (5,000 kobo) |
| Any transfer > ₦10,000 | + ₦50 stamp duty (5,000 kobo) |

### C. Charge success → Paystack collection cost

**Where:** `apps/api/src/routes/webhook.ts`, `charge.success` handler, after crediting wallet.

```
INSERT platform_ledger (
  type = 'cost_paystack_collection',
  amount_kobo = paystackCollectionFee(amount),
  source_id = walletTransaction.id,
  source_type = 'wallet_transaction',
  occurred_at = now()
)
```

**Paystack collection fee formula** (card payments, NGN):
```
if amount_kobo ≤ 250,000  →  fee = 0          (≤ ₦2,500, fee waived)
else                       →  fee = min(round(amount_kobo × 0.015) + 10,000, 200,000)
                               (1.5% + ₦100, capped at ₦2,000)
```

---

## Infrastructure Cost Cron

**Job:** `sync-infra-costs` added to `workers/cron/src/jobs/sync-infra-costs.ts`
**Schedule:** Daily at 05:00 UTC (06:00 WAT), pulling the **previous day's** costs
**Exchange rate:** Fetched once per run from ExchangeRate-API (free tier) with the CBN rate as fallback

### Provider integrations

| Provider | API | Method |
|---|---|---|
| **Fly.io** | `https://api.fly.io/graphql` | Query org daily usage cost |
| **NeonDB** | `https://console.neon.tech/api/v2/consumption_history/projects` | Compute + storage for the project |
| **Vercel** | `https://api.vercel.com/v2/billing` | Daily spend from usage billing |
| **Clerk** | `https://api.clerk.com/v1/billing/invoices` | Latest monthly invoice ÷ days in month (~estimated) |
| **Ably** | `https://rest.ably.io/stats?unit=day` | Message + connection counts × per-unit rate from `ABLY_COST_PER_MILLION_MESSAGES_USD` env var |

Clerk and Ably values are **estimates**, not actuals. The Finance UI prefixes these with `~` to signal approximation.

Each provider result is upserted into `cost_snapshots` on `(provider, snapshot_date)`. If a provider API call fails, that provider is skipped for the day and logged — the cron does not fail entirely.

---

## API Endpoints

All routes under `/api/v1/admin/finance/`, gated with `requireRole('surewaka_admin')`.

### `GET /summary`

Query params: `from` (date), `to` (date). Defaults to current calendar month.

Aggregates `platform_ledger` + `cost_snapshots` for the period.

Response shape:
```json
{
  "data": {
    "period": { "from": "2026-07-01", "to": "2026-07-31" },
    "currency": "NGN",
    "unit": "kobo",
    "revenue": {
      "commission": 4200000,
      "withdrawal_fees": 150000,
      "total": 4350000
    },
    "expenses": {
      "operational": {
        "paystack_transfer": 45000,
        "paystack_collection": 82000,
        "total": 127000
      },
      "infrastructure": {
        "vercel": 210000,
        "fly": 380000,
        "neon": 95000,
        "clerk": 60000,
        "ably": 40000,
        "total": 785000
      },
      "total": 912000
    },
    "summary": {
      "revenue": 4350000,
      "operational_expenses": 127000,
      "gross_profit": 4223000,
      "total_expenses": 912000,
      "net_profit": 3438000,
      "margin_percent": 79.03
    }
  },
  "error": null,
  "meta": null
}
```

Formulas:
- `gross_profit = revenue.total − expenses.operational.total`
- `net_profit = revenue.total − expenses.total`
- `margin_percent = round((net_profit / revenue.total) × 100, 2)` — returns `null` if revenue is 0

### `GET /trend`

Query param: `months` (integer, default 6, max 12).

Returns one summary object per calendar month, oldest first. Same shape as `/summary` data but without the `period` envelope — each item has a `month` field (`"2026-07"`).

### `GET /ledger`

Query params: `from`, `to`, `type` (optional filter), `limit` (max 100, default 50), `offset`.

Returns paginated `platform_ledger` rows for drill-down. Response includes `meta.total`.

### `GET /costs`

Query params: `from`, `to`.

Returns `cost_snapshots` rows grouped by provider, for the infrastructure cost breakdown table.

---

## Admin Finance Page

**Route:** `apps/admin/app/routes/finance.tsx`

### Layout (top to bottom)

**Header:** "Finance" heading + date range picker (defaults to current month).

**Summary cards (4):**
- Total Revenue
- Total Expenses
- Gross Profit (with label "before infrastructure")
- Net Profit (with margin % badge)

**Breakdown section (two columns):**
- Left — Revenue: commission row + withdrawal fees row, with a small bar showing the split
- Right — Expenses: Operational subtotal (Paystack transfer + collection) and Infrastructure subtotal (per-provider rows). Clerk and Ably rows show `~` prefix.

**Trend chart:** 6-month grouped bar chart — Revenue, Gross Profit, Net Profit per month. Uses `/trend` endpoint.

**Ledger table:** Paginated, filterable by type via tab strip. Columns: Date, Type (badge), Amount, Source reference. Links drill into the source record where possible.

---

## Out of Scope

- Historical backfill of ledger events before this feature ships (data starts from go-live)
- Multi-currency P&L (everything is NGN; USD infra costs are converted at snapshot time)
- Per-delivery profit margin breakdown
- Export to CSV/PDF (can be added later)
- Real-time infrastructure cost polling (daily is sufficient)
- Automated alerts on margin drop (separate alert-engine concern)
