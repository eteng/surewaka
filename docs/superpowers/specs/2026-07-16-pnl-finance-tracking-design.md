# P&L / Finance Tracking — Design Spec

**Date:** 2026-07-16
**Status:** Approved, pending implementation plan

---

## Overview

SureWaka needs a Finance page in the admin dashboard that shows true net profit — revenue earned from deliveries and withdrawal fees, minus operational costs (Paystack transaction fees) and infrastructure costs (Vercel, Fly.io, NeonDB, Clerk, Ably). Operational costs are captured in real time via ledger events; infrastructure costs are pulled daily from each provider's billing API. Accounting follows **cash basis** — events are recorded when money moves, not when a delivery is booked.

---

## Architecture

### Two new DB tables

**`platform_ledger`** — one row per revenue or operational cost event, written in real time at the moment the underlying financial event occurs.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `category` | text | `revenue` or `expense` |
| `type` | text | Specific event type within the category (see table below) |
| `amount_kobo` | bigint NOT NULL | Always positive — sign is implied by category |
| `source_id` | uuid | ID of originating record |
| `source_type` | text | `escrow_hold`, `payout_request`, `wallet_transaction` |
| `occurred_at` | timestamptz | When the underlying event happened (`now()` at insert) |
| `created_at` | timestamptz | |

`UNIQUE(source_id, category, type)` — prevents duplicate rows if a webhook fires more than once. Inserts use `ON CONFLICT DO NOTHING`.

Valid `(category, type)` combinations:

| category | type | Description |
|---|---|---|
| `revenue` | `commission` | SureWaka's cut from a completed delivery |
| `revenue` | `withdrawal_fee` | Flat ₦100 fee charged per payout request |
| `expense` | `paystack_transfer` | Paystack fee on outgoing transfer |
| `expense` | `paystack_collection` | Paystack fee on incoming wallet topup |
| `expense` | `commission_reversal` | Reverses a prior commission when escrow is refunded or disputed after release |

Aggregation is simple and stable — `WHERE category = 'revenue'` sums all revenue; `WHERE category = 'expense'` sums all operational costs. Adding new types never requires updating aggregate queries.

**`cost_snapshots`** — one row per provider per day, written by the daily infrastructure cron.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `provider` | text | `vercel`, `fly`, `neon`, `clerk`, `ably` |
| `amount_usd` | numeric(12,4) | Cost in USD from provider API |
| `usd_to_ngn_rate` | numeric(10,2) | Mid-market rate at time of snapshot (from ExchangeRate-API) |
| `amount_kobo` | bigint | `round(amount_usd × usd_to_ngn_rate × 100)` |
| `snapshot_date` | date | Calendar day this cost covers |
| `raw_response` | jsonb | Full provider API response for debugging |
| `created_at` | timestamptz | |

`UNIQUE(provider, snapshot_date)` — makes cron re-runs idempotent via upsert.

---

## Ledger Event Wiring

Three write points. All ledger inserts are **non-blocking** — a failure must never prevent the primary financial operation from completing. On failure, a retry job is enqueued to the dedicated `ledger` BullMQ queue (separate from the `payment` queue, same Redis instance) with exponential backoff. All inserts use `ON CONFLICT (source_id, category, type) DO NOTHING`.

A reconciliation query can surface any gaps:
```sql
SELECT id FROM escrow_holds
WHERE status = 'released'
  AND id NOT IN (
    SELECT source_id FROM platform_ledger
    WHERE category = 'revenue' AND type = 'commission'
  );
```

### A. Escrow release → commission revenue

**Where:** `workers/payment-worker/src/jobs/escrow-release.ts`, after the DB transaction commits.

```
INSERT platform_ledger (
  category = 'revenue',
  type = 'commission',
  amount_kobo = commissionAmount,       -- already computed in escrow-release.ts
  source_id = hold.id,
  source_type = 'escrow_hold',
  occurred_at = now()
) ON CONFLICT DO NOTHING
```

### B. Escrow refunded/disputed after release → commission reversal

**Where:** refund/dispute handler, when escrow status transitions from `released` to `refunded` or `disputed`.

```
INSERT platform_ledger (
  category = 'expense',
  type = 'commission_reversal',
  amount_kobo = commissionAmount,
  source_id = hold.id,
  source_type = 'escrow_hold',
  occurred_at = now()
) ON CONFLICT DO NOTHING
```

### C. Transfer success → withdrawal fee revenue + Paystack transfer cost

**Where:** `apps/api/src/routes/webhook.ts`, `transfer.success` handler, after marking payout completed.

Two rows inserted:

```
INSERT platform_ledger (category = 'revenue',  type = 'withdrawal_fee',    amount_kobo = payout.feeKobo,                       source_id = payout.id, source_type = 'payout_request', ...)
INSERT platform_ledger (category = 'expense',  type = 'paystack_transfer', amount_kobo = paystackTransferFee(payout.amount),   source_id = payout.id, source_type = 'payout_request', ...)
```

Note: `UNIQUE(source_id, category, type)` allows both rows since their category+type pairs differ.

**Paystack transfer fee formula** (verified from Paystack pricing):

| Transfer amount | Fee |
|---|---|
| ≤ ₦5,000 (500,000 kobo) | ₦10 (1,000 kobo) |
| ₦5,001 – ₦50,000 | ₦25 (2,500 kobo) |
| > ₦50,000 | ₦50 (5,000 kobo) |
| Any transfer > ₦10,000 | + ₦50 stamp duty (5,000 kobo) |

### D. Charge success → Paystack collection cost

**Where:** `apps/api/src/routes/webhook.ts`, `charge.success` handler, after crediting wallet. `source_id` = the `wallet_transaction.id` returned by `creditWallet`.

Fee formula **branches on `data.channel`** from the Paystack webhook payload:

**DVA / bank transfer** (`channel === 'dedicated_nuban'`):
```
fee = 5,000 kobo  (flat ₦50)
```

**Card and all other channels:**
```
if amount_kobo ≤ 250,000  →  fee = 0          (≤ ₦2,500, Paystack waives fee)
else                       →  fee = min(round(amount_kobo × 0.015) + 10,000, 200,000)
                               (1.5% + ₦100, capped at ₦2,000)
```

---

## Infrastructure Cost Cron

**Prerequisite:** The `workers/cron` worker has no active scheduler. This feature must wire up cron scheduling first — a BullMQ repeating job seeded at startup (same Redis instance as the payment worker).

**Job:** `sync-infra-costs` in `workers/cron/src/jobs/sync-infra-costs.ts`
**Schedule:** Daily at 05:00 UTC (06:00 WAT), pulling the **previous day's** costs
**Exchange rate:** Mid-market USD/NGN fetched once per run from ExchangeRate-API (free tier). Stored in `cost_snapshots.usd_to_ngn_rate` so historical conversions are frozen at the rate used.

### Provider integrations

Each provider uses a **dedicated env var** so the cron worker's access surface is explicit:

| Provider | Env var | API endpoint | Method |
|---|---|---|---|
| **Fly.io** | `CRON_FLY_TOKEN` | `https://api.fly.io/graphql` | Query org daily usage cost (read-only token) |
| **NeonDB** | `CRON_NEON_API_KEY` | `https://console.neon.tech/api/v2/consumption_history/projects` | Compute + storage for the project |
| **Vercel** | `CRON_VERCEL_TOKEN` | `https://api.vercel.com/v2/billing` | Daily spend (viewer token) |
| **Clerk** | `CRON_CLERK_SECRET_KEY` | `https://api.clerk.com/v1/billing/invoices` | Latest monthly invoice ÷ days in month (~estimated). Lags until invoice is issued at month close — UI shows "Based on prior month invoice" on the Clerk row. |
| **Ably** | `CRON_ABLY_API_KEY` | `https://rest.ably.io/stats?unit=day` | Message + connection counts × per-unit rate from `ABLY_COST_PER_MILLION_MESSAGES_USD` env var (~estimated) |

Clerk and Ably values are **estimates**, not actuals. The Finance UI prefixes these rows with `~`.

If a provider API call fails, that provider is skipped for the day and logged — the cron does not fail entirely. Each provider result is upserted on `(provider, snapshot_date)`.

---

## API Endpoints

All routes under `/api/v1/admin/finance/`, gated with `requireRole('surewaka_admin')`.

`currency` and `unit` always appear in `meta` — consistent across all four endpoints regardless of whether `data` is an object or array.

### `GET /summary`

Query params: `from` (date), `to` (date). Defaults to current calendar month.

Aggregates `platform_ledger` + `cost_snapshots` for the period. Returns zeros for all fields when no data exists — never returns 404 or null fields.

```json
{
  "data": {
    "period": { "from": "2026-07-01", "to": "2026-07-31" },
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
  "meta": { "currency": "NGN", "unit": "kobo" }
}
```

Formulas:
- `gross_profit = revenue.total − expenses.operational.total`
- `net_profit = revenue.total − expenses.total`
- `margin_percent = round((net_profit / revenue.total) × 100, 2)` — `null` only when `revenue.total = 0`; **negative values are valid** and rendered in red in the UI

### `GET /trend`

Query param: `months` (integer, default 6, max 12).

Returns one flat object per calendar month, oldest first. Each item contains only the metrics needed for chart rendering — the frontend draws charts directly without additional calculations. No per-provider infra breakdown; `infrastructure_expenses` is the subtotal only.

```json
{
  "data": [
    {
      "period": "2026-02",
      "revenue": 3950000,
      "operational_expenses": 118000,
      "infrastructure_expenses": 770000,
      "gross_profit": 3832000,
      "net_profit": 3062000
    },
    {
      "period": "2026-03",
      "revenue": 4100000,
      "operational_expenses": 122000,
      "infrastructure_expenses": 775000,
      "gross_profit": 3978000,
      "net_profit": 3203000
    }
  ],
  "error": null,
  "meta": { "currency": "NGN", "unit": "kobo", "months": 6 }
}
```

### `GET /ledger`

Query params: `from`, `to`, `category` (optional — `revenue` or `expense`), `type` (optional — specific type within category), `limit` (max 100, default 50), `offset`.

Returns paginated `platform_ledger` rows for drill-down. `category` is the primary filter for aggregation views; `type` allows drill-down to a specific event kind.

```json
{
  "data": [
    {
      "id": "uuid",
      "category": "revenue",
      "type": "commission",
      "amount_kobo": 630000,
      "source_id": "uuid",
      "source_type": "escrow_hold",
      "occurred_at": "2026-07-15T14:22:11Z",
      "created_at": "2026-07-15T14:22:11Z"
    }
  ],
  "error": null,
  "meta": { "currency": "NGN", "unit": "kobo", "total": 142, "limit": 50, "offset": 0 }
}
```

### `GET /costs`

Query params: `from`, `to`.

Returns `cost_snapshots` rows for the period. `estimated: true` on Clerk and Ably rows — the UI uses this to show the `~` prefix and tooltip, rather than hardcoding which providers are estimates.

```json
{
  "data": [
    {
      "provider": "vercel",
      "amount_usd": 18.40,
      "usd_to_ngn_rate": 1580.50,
      "amount_kobo": 2908120,
      "snapshot_date": "2026-07-15",
      "estimated": false
    },
    {
      "provider": "clerk",
      "amount_usd": 2.00,
      "usd_to_ngn_rate": 1580.50,
      "amount_kobo": 316100,
      "snapshot_date": "2026-07-15",
      "estimated": true
    }
  ],
  "error": null,
  "meta": { "currency": "NGN", "unit": "kobo" }
}
```

---

## Admin Finance Page

**Route:** `apps/admin/app/routes/finance.tsx`

### Layout (top to bottom)

**Header:** "Finance" heading + date range picker (defaults to current month).

**Summary cards (4):**
- Total Revenue
- Total Expenses
- Gross Profit (labelled "before infrastructure")
- Net Profit (with margin % badge — red when negative)

**Breakdown section (two columns):**
- Left — Revenue: commission row + withdrawal fees row with a small split bar
- Right — Expenses: Operational subtotal (Paystack transfer + collection) and Infrastructure subtotal (per-provider rows). Clerk and Ably rows show `~` prefix and a tooltip: "Based on prior month invoice" / "Estimated from usage stats"

**Trend chart:** 6-month grouped bar chart — Revenue, Gross Profit, Net Profit per month.

**Ledger table:** Paginated, filterable by `category` via tab strip (All / Revenue / Expense), then by `type` within category. Columns: Date, Category (badge), Type, Amount, Source reference.

---

## Out of Scope

- Historical backfill of ledger events before this feature ships (data starts from go-live)
- Multi-currency P&L (everything is NGN; USD infra costs are converted at snapshot time)
- Per-delivery profit margin breakdown
- Export to CSV/PDF
- Real-time infrastructure cost polling (daily is sufficient)
- Automated alerts on margin drop (separate alert-engine concern)
- Retroactive correction of past `cost_snapshots` rows when a monthly invoice is issued
