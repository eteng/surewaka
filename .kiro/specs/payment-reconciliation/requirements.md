# Requirements Document

## Introduction

A durable safety net for Paystack wallet top-ups so that a payment Paystack actually confirmed is never left uncredited because the webhook didn't arrive and the customer's in-app polling missed the window (the failure class found and fixed reactively in this session: a stale-token bug in client polling, `neon-http`'s missing transaction support, and a webhook that had never once reached local dev). Every top-up initialization is now persisted as its own record independent of whether it ever gets credited, a background job re-verifies anything left stuck directly against Paystack, and support gets a lookup surface to answer "where did my top-up go" without reading server logs. Scoped to wallet top-ups (`POST /api/v1/wallet/fund`) only — payout/transfer reconciliation is a related but separate concern (see Non-Goals).

## Glossary

- **Payment_Intent**: A row in the new `payment_intents` table created at top-up initialization time, tracking a Paystack transaction's reference, wallet, amount, and lifecycle status independent of whether `wallet_transactions` has a corresponding credited row yet.
- **Verification_Path**: Any of the three ways a Payment_Intent can be confirmed against Paystack — the Paystack webhook (`POST /api/v1/webhook/paystack`), client-side polling (`GET /api/v1/wallet/fund/:reference`), or the Reconciliation_Job.
- **Reconciliation_Job**: The new `reconcile-pending-topups` cron job in `workers/cron/src/jobs/`, following the existing `rescue-stale-routing`/`rescue-missed-matching` pattern, that re-verifies stuck Payment_Intents directly against Paystack on a fixed schedule.
- **Terminal_Status**: One of `succeeded`, `failed`, or `expired` — once a Payment_Intent reaches one of these, no Verification_Path acts on it again.
- **Wallet_Transaction**: An existing row in `wallet_transactions` (`packages/db/src/schema/wallets.ts`), the actual ledger entry created by `creditWallet`. Its `reference` column has a unique constraint — this is the existing idempotency guard this spec relies on rather than replaces.
- **Admin_Lookup_API**: The new read-only admin endpoint(s) for looking up Payment_Intent status by reference or by customer.

## Requirements

### Requirement 1: Persist a Payment Intent at Initialization

**User Story:** As a customer, I want my top-up attempt recorded the moment I start it, so that the system has a durable record even if verification never completes.

#### Acceptance Criteria

1. WHEN `POST /api/v1/wallet/fund` successfully initializes a transaction with Paystack, THE System SHALL resolve the customer's wallet via `getOrCreateWallet` and insert a Payment_Intent row with `walletId`, `reference`, `amount`, `topupType`, and `status` set to `pending`, before returning the `authorization_url` response to the client.
2. IF the Payment_Intent insert fails after Paystack's initialize call already succeeded, THEN THE System SHALL log the failure including the reference and still return the `authorization_url` to the client, so a new tracking-table failure does not block an otherwise-working checkout.
3. THE Payment_Intent `reference` column SHALL be unique, matching the existing uniqueness of `wallet_transactions.reference`, so a reference can never be tracked by more than one Payment_Intent row.

### Requirement 2: Idempotent Crediting Across All Verification Paths

**User Story:** As a customer, I want my wallet credited exactly once no matter which path confirms my payment first, so that I'm never double-credited or left uncredited because of a race between the webhook, my app's polling, and the reconciliation job.

#### Acceptance Criteria

1. THE System SHALL continue to treat the existing unique constraint on `wallet_transactions.reference` as the single source of truth for whether a Payment_Intent has been credited; no Verification_Path SHALL be the sole authority for crediting.
2. WHEN any Verification_Path confirms a Payment_Intent as Paystack `status: success` and no `wallet_transactions` row exists for that reference, THE System SHALL call the existing `creditWallet` function and, in the same operation, update the Payment_Intent's `status` to `succeeded` and `creditedAt` to the current timestamp.
3. IF two Verification_Paths attempt to credit the same reference concurrently, THEN THE database unique constraint on `wallet_transactions.reference` SHALL reject the second insert, and THE System SHALL treat that rejection as "already credited" — updating the Payment_Intent to `succeeded` without crediting again and without surfacing an error to the caller.
4. WHEN a Verification_Path observes a Payment_Intent whose `status` is already `succeeded`, THE System SHALL take no further action on that reference.

### Requirement 3: Reconciliation Job for Stuck Payment Intents

**User Story:** As a platform operator, I want stuck top-up attempts automatically re-verified against Paystack, so that a temporary failure in the webhook or client polling doesn't permanently strand a customer's payment.

#### Acceptance Criteria

1. THE Reconciliation_Job SHALL run every 5 minutes via the existing `cron` BullMQ queue, registered with the same repeat-job pattern used by `rescue-stale-routing` and `rescue-missed-matching` in `workers/cron/src/index.ts`.
2. WHEN the Reconciliation_Job runs, THE System SHALL query Payment_Intent rows with `status` = `pending` and `createdAt` more than 3 minutes in the past, ordered oldest-first, limited to a batch of 50.
3. FOR each candidate Payment_Intent, THE Reconciliation_Job SHALL call `verifyTransaction(reference)` directly against Paystack.
4. IF the `verifyTransaction` response is `status: success`, THEN THE Reconciliation_Job SHALL apply the crediting rules in Requirement 2.
5. IF the `verifyTransaction` response is `status: failed` or `status: abandoned`, THEN THE Reconciliation_Job SHALL set the Payment_Intent `status` to `failed` and record the Paystack response status in `metadata`.
6. IF the `verifyTransaction` call itself throws (network or Paystack API error, as distinct from a definitive failed/abandoned response), THEN THE Reconciliation_Job SHALL leave the Payment_Intent `status` as `pending`, increment `verificationAttempts`, and retry it on a subsequent run.
7. WHEN a Payment_Intent has `status` = `pending` and `createdAt` is more than 24 hours in the past, THE Reconciliation_Job SHALL set its `status` to `expired`, and THE System SHALL exclude `expired` Payment_Intents from all future reconciliation queries.
8. IF processing one candidate Payment_Intent throws an unexpected error, THEN THE Reconciliation_Job SHALL log the failure with the reference, continue processing the remaining candidates in the batch, and SHALL NOT abort the run.

### Requirement 4: Database Schema — Payment Intents Table

**User Story:** As a developer, I want a dedicated table tracking top-up attempts independent of `wallet_transactions`, so a top-up's lifecycle is visible even before — or if never — credited.

#### Acceptance Criteria

1. THE `payment_intents` table SHALL contain: `id` (UUID PK, default `gen_random_uuid()`), `wallet_id` (FK to `wallets.id`), `reference` (text, unique, not null), `amount` (bigint, not null), `topup_type` (text, not null), `status` (text, not null, CHECK constraint limiting to `pending`, `succeeded`, `failed`, `expired`), `verification_attempts` (integer, default 0, not null), `metadata` (jsonb, default `'{}'::jsonb`, not null), `created_at` (timestamptz, default `now()`, not null), `credited_at` (timestamptz, nullable), `updated_at` (timestamptz, default `now()`, not null).
2. THE `payment_intents` table SHALL have a unique index on `reference`.
3. THE `payment_intents` table SHALL have a partial index on `created_at` filtered to rows where `status = 'pending'`, to serve the Reconciliation_Job's query efficiently.
4. THE `payment_intents` table SHALL have an index on `wallet_id` to support per-customer lookups.

### Requirement 5: Support Lookup by Reference or Customer

**User Story:** As a support agent, I want to look up the status of a specific top-up by its reference or by the customer, so I can answer "where did my top-up go" without reading server logs.

#### Acceptance Criteria

1. WHEN an authenticated admin sends `GET /api/v1/admin/payment-intents?reference=<ref>`, THE Admin_Lookup_API SHALL return HTTP 200 with the matching Payment_Intent's status, amount, timestamps, and — if `status` is `succeeded` — the linked `wallet_transactions` row, in the response `data` field.
2. WHEN an authenticated admin sends `GET /api/v1/admin/payment-intents?userId=<id>`, THE Admin_Lookup_API SHALL return HTTP 200 with all Payment_Intent rows belonging to that user's wallet, ordered newest-first, paginated at 50 rows per page.
3. IF neither `reference` nor `userId` is supplied, THEN THE Admin_Lookup_API SHALL return HTTP 400 indicating one of the two query parameters is required.
4. IF no Payment_Intent matches the supplied `reference`, THEN THE Admin_Lookup_API SHALL return HTTP 404 with `data: null`.
5. IF a non-admin or unauthenticated caller sends a request to this endpoint, THEN THE Admin_Lookup_API SHALL return HTTP 401 or 403 with `data: null`, without revealing Payment_Intent data.

### Requirement 6: Customer Notification on Delayed Credit

**User Story:** As a customer whose top-up didn't confirm immediately, I want to be notified once it's actually credited, so I don't have to keep checking manually.

#### Acceptance Criteria

1. WHEN the Reconciliation_Job — specifically, not the webhook or client poll, since those already resolve within the customer's active session — credits a wallet for a Payment_Intent, THE System SHALL enqueue a push notification to the customer via the existing push-worker queue informing them their top-up completed.
2. IF the push notification enqueue fails, THEN THE System SHALL log the failure and SHALL NOT retry the credit or fail the reconciliation attempt — the wallet credit itself SHALL already be considered complete and correct regardless of notification delivery.

## Non-Goals / Out of Scope

- **Payout/transfer reconciliation.** `payoutRequests` already tracks its own status via the existing `transfer.success` / `transfer.failed` / `transfer.reversed` webhook handlers in `apps/api/src/routes/webhook.ts`. A similar stuck-payout safety net is a candidate for a follow-up spec, not this one.
- **Configurable reconciliation thresholds via an admin settings UI.** The 3-minute stuck threshold, 24-hour expiry, and 5-minute cadence are fixed constants for this version, matching the existing `rescue-stale-routing` pattern rather than introducing a new settings table.
- **Automatic retry of `failed`/`abandoned` Paystack transactions.** Those are terminal on Paystack's side; the customer must initiate a new top-up.
- **Customer-facing intent-level status UI.** Customers already see wallet balance and transaction list (`GET /wallet/balance`, `GET /wallet/transactions`); this spec only adds the backend safety net and a support-facing lookup, not new customer-facing screens.
