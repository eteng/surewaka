# Implementation Plan: Alert System

## Overview

Build a 60-second polling alert engine worker, admin push notification infrastructure, Pumble webhook routing, and a settings UI at `/settings/alerts`. The system evaluates 7 alert rules against live database state, manages alert lifecycle (insert/escalate/resolve), and routes Critical alerts to admin Expo push notifications and Pumble. Implementation follows a bottom-up approach: DB schema → shared types → worker scaffold → core modules → rules → polling loop → API → UI.

## Tasks

- [ ] 1. Database schema — alerts table, alert_settings, push_tokens extension
  - [ ] 1.1 Create Drizzle schema file `packages/db/src/schema/alerts.ts`
    - Define `alerts` table with columns: `id` (UUID PK, defaultRandom), `delivery_id` (nullable FK → deliveries ON DELETE CASCADE), `leg_id` (nullable FK → delivery_legs ON DELETE SET NULL), `rule` (text NOT NULL), `severity` (text NOT NULL, pgEnum or CHECK for info/warning/critical), `original_severity` (nullable, same constraint), `context` (JSONB NOT NULL DEFAULT '{}'), `fired_at` (timestamptz NOT NULL DEFAULT now()), `escalated_at` (nullable), `resolved_at` (nullable), `ack_by` (nullable FK → users ON DELETE SET NULL)
    - Define partial index `idx_alerts_unresolved` on `fired_at DESC` WHERE `resolved_at IS NULL`
    - Define partial index `idx_alerts_delivery_id` on `delivery_id` WHERE `delivery_id IS NOT NULL`
    - Export table and indexes from `packages/db/src/schema/index.ts`
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ] 1.2 Create Drizzle schema file `packages/db/src/schema/alert-settings.ts`
    - Define `alert_settings` singleton table with all threshold columns (defaults: driverSilentWarningMin=15, driverSilentCriticalMin=30, legOverdueWarningMin=30, legOverdueCriticalMin=60, customerUpdateGapWarningMin=45, customerUpdateGapCriticalMin=90, ontimeRateWarningPct=80, ontimeRateCriticalPct=60, pushEnabled=true, pumbleEnabled=false, pumbleWebhookUrl=null, updatedAt=now)
    - Export table from `packages/db/src/schema/index.ts`
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ] 1.3 Update `push_tokens` schema to extend `app` enum/constraint to include `'admin'`
    - Modify `packages/db/src/schema/` file containing push_tokens to add `'admin'` to the allowed `app` values
    - _Requirements: 14.4_

  - [ ] 1.4 Generate and apply migration
    - Run `pnpm --filter @surewaka/db db:generate` to generate migration SQL
    - Review the generated SQL in `packages/db/drizzle/`
    - Run `pnpm --filter @surewaka/db db:migrate` to apply to Neon
    - Seed the singleton `alert_settings` row (INSERT DEFAULT VALUES) — either via migration SQL or a seed script
    - _Requirements: 14.1, 11.1_

- [ ] 2. Shared types — AlertRule, AlertSeverity, Alert, constants, validators
  - [ ] 2.1 Add alert constants to `packages/shared/src/constants.ts`
    - Add `ALERT_RULES` array with all 7 rule names as const
    - Add `ALERT_SEVERITIES` array with `['info', 'warning', 'critical']` as const
    - _Requirements: 1.6, 9.1_

  - [ ] 2.2 Add alert types to `packages/shared/src/types.ts`
    - Add `AlertRule` type derived from `ALERT_RULES`
    - Add `AlertSeverity` type derived from `ALERT_SEVERITIES`
    - Add `Alert` type matching the `alerts` table schema (camelCase fields)
    - Add `AlertSettings` type with all threshold fields, `pumbleWebhookUrl`, `pushEnabled`, `pumbleEnabled`
    - _Requirements: 11.1, 11.3, 14.1_

  - [ ] 2.3 Add `updateAlertSettingsSchema` validator to `packages/shared/src/validators.ts`
    - All fields optional (partial updates supported)
    - `driverSilentWarningMin`: int [5, 60]
    - `driverSilentCriticalMin`: int [10, 120]
    - `legOverdueWarningMin`: int [10, 120]
    - `legOverdueCriticalMin`: int [20, 240]
    - `customerUpdateGapWarningMin`: int [15, 120]
    - `customerUpdateGapCriticalMin`: int [30, 240]
    - `ontimeRateWarningPct`: int [50, 100]
    - `ontimeRateCriticalPct`: int [30, 90]
    - `pumbleWebhookUrl`: URL string starting with `https://`, max 2048 chars, or null
    - `pushEnabled`, `pumbleEnabled`: boolean
    - Add `.superRefine` for cross-field ordering: warning < critical for time-based pairs, warning > critical for percentage pair
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 11.5_

  - [ ]* 2.4 Write property tests for validation schema bounds (Property 9, Property 10)
    - **Property 9: Validation Schema Bounds** — For any integer value, values within [min, max] pass and values outside fail
    - **Property 10: Cross-Field Threshold Ordering** — For any update with both warning and critical, time pairs reject if warning ≥ critical, percentage pair rejects if warning ≤ critical
    - Use fast-check with `fc.integer()` arbitraries for each field
    - File: `packages/shared/src/__tests__/alert-validators.property.test.ts`
    - **Validates: Requirements 15.1–15.12, 11.5**

- [ ] 3. Checkpoint — Shared types compile and validate
  - Ensure `pnpm --filter @surewaka/shared build` passes with no errors, ask the user if questions arise.

- [ ] 4. Alert engine worker scaffold
  - [ ] 4.1 Create worker package structure
    - Create `workers/alert-engine/package.json` with name `@surewaka/alert-engine`, dependencies on `@surewaka/db`, `@surewaka/shared`, `bullmq`, `ioredis`
    - Create `workers/alert-engine/tsconfig.json` (target ES2022, module ESNext, moduleResolution bundler, strict)
    - Create `workers/alert-engine/vitest.config.ts` with globals enabled
    - _Requirements: 1.1_

  - [ ] 4.2 Create worker-local types and DB client
    - Create `workers/alert-engine/src/types.ts` with `EvaluationResult` type (deliveryId, legId, rule, severity, context, shouldFire)
    - Create `workers/alert-engine/src/db.ts` initializing Drizzle + Neon HTTP client from `DATABASE_URL`
    - _Requirements: 1.1, 1.4_

- [ ] 5. Alert engine core modules — settings loader, Pumble sender, admin push enqueuer
  - [ ] 5.1 Create settings loader `workers/alert-engine/src/settings.ts`
    - Export `loadSettings(): Promise<AlertSettings>` that reads the singleton `alert_settings` row
    - Throw if no row exists (migration not run)
    - _Requirements: 1.4, 11.1_

  - [ ] 5.2 Create Pumble webhook sender `workers/alert-engine/src/pumble.ts`
    - Export `formatPumbleMessage(rule: AlertRule, context: Record<string, unknown>): string`
    - Export `sendPumbleAlert(webhookUrl: string, rule: AlertRule, context: Record<string, unknown>): Promise<void>`
    - POST JSON `{ text: "..." }` to webhook URL with 10-second timeout
    - Non-blocking: catch all errors, log to stderr, never throw
    - Message format: `🔴 CRITICAL — {Rule Label}\n{Delivery Ref} | {Details}\n→ View: {admin URL}`
    - _Requirements: 10.3, 10.4_

  - [ ] 5.3 Create admin push enqueuer `workers/alert-engine/src/push.ts`
    - Export `enqueueAdminPush(rule: AlertRule, context: Record<string, unknown>, adminUserIds: string[]): Promise<void>`
    - Enqueue one BullMQ job per admin user with `targetApp: 'admin'`, `priority: 'high'`, attempts: 3, exponential backoff (delay: 1000, maxDelay: 30000)
    - Non-blocking: catch queue errors per user, log and continue
    - _Requirements: 10.1, 10.2_

  - [ ]* 5.4 Write unit tests for Pumble sender
    - Test `formatPumbleMessage` includes rule label, delivery context fields
    - Test `sendPumbleAlert` POSTs JSON with `text` field
    - Test `sendPumbleAlert` does not throw on network failure
    - File: `workers/alert-engine/src/__tests__/pumble.test.ts`
    - _Requirements: 10.3, 10.4_

  - [ ]* 5.5 Write property test for critical-only routing (Property 7)
    - **Property 7: Critical-Only External Routing** — For any alert with severity warning or info, Push_Enqueuer and Pumble_Sender are never invoked
    - Use fast-check to generate random severities and verify routing behavior
    - File: `workers/alert-engine/src/__tests__/routing.property.test.ts`
    - **Validates: Requirements 10.1, 10.5**

- [ ] 6. Alert rules — all 7 evaluation rules
  - [ ] 6.1 Implement `driver_silent` rule at `workers/alert-engine/src/rules/driver-silent.ts`
    - Query active legs with MAX(driver_locations.recorded_at) per leg
    - Compute elapsed minutes since last GPS ping
    - If no ping exists, use leg's `started_at` as baseline
    - Classify: elapsed ≥ criticalMin → critical, ≥ warningMin → warning, else shouldFire=false
    - Context: deliveryId, driverName, minutesSilent (integer), zone
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 6.2 Implement `leg_overdue` rule at `workers/alert-engine/src/rules/leg-overdue.ts`
    - Query active legs with non-null `driver_eta_at` or `system_eta_at`
    - Use `driver_eta_at` in preference to `system_eta_at`
    - Skip legs where both ETAs are null
    - Classify: elapsed ≥ criticalMin → critical, ≥ warningMin → warning, elapsed ≤ 0 → shouldFire=false
    - Context: deliveryId, legId, minutesOverdue (integer floor), zone, etaSource
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 6.3 Implement `driver_ghost` rule at `workers/alert-engine/src/rules/driver-ghost.ts`
    - Query delivery_events within last 10 minutes where status → cancelled/failed from pre-pickup status
    - Exclude customer-triggered cancellations
    - Always severity critical, always shouldFire=true
    - Context: deliveryId, driverName, triggeredBy
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 6.4 Implement `dispute_filed` rule at `workers/alert-engine/src/rules/dispute-filed.ts`
    - Query deliveries with escrow status `disputed` without existing unresolved alert for this rule
    - One EvaluationResult per matched delivery, severity warning, shouldFire=true
    - Context: deliveryId, disputeTimestamp
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ] 6.5 Implement `delivery_failed` rule at `workers/alert-engine/src/rules/delivery-failed.ts`
    - Query deliveries with status `failed`, `updated_at` within last 2 minutes, no existing unresolved alert
    - One EvaluationResult per matched delivery, severity warning, shouldFire=true
    - Context: deliveryId, updatedAt
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 6.6 Implement `ontime_rate_drop` rule at `workers/alert-engine/src/rules/ontime-rate-drop.ts`
    - Compute percentage of today's delivered orders with `updated_at ≤ system_eta_at` (Africa/Lagos TZ for date boundary)
    - Exclude deliveries with null `system_eta_at` from calculation
    - Skip if fewer than 5 delivered today (return empty array)
    - Classify: rate < criticalPct → critical, < warningPct → warning, else shouldFire=false
    - Context: ratePct (rounded to 1 decimal), delivered count, onTime count
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ] 6.7 Implement `customer_update_gap` rule at `workers/alert-engine/src/rules/customer-update-gap.ts`
    - Query active deliveries (status not in delivered/cancelled/failed/returned/draft)
    - Compute elapsed minutes since last customer-facing delivery event; fallback to `created_at` if no events
    - Classify: elapsed ≥ criticalMin → critical, ≥ warningMin → warning, else shouldFire=false
    - Context: deliveryId, customerName, minutesSinceUpdate
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 6.8 Write property tests for threshold classification rules (Properties 1–4)
    - **Property 1: Driver Silent Threshold Classification** — For any elapsed ≥ 0 and valid thresholds (warning < critical), classification is deterministic
    - **Property 2: Leg Overdue Threshold Classification** — For any elapsed past ETA and valid thresholds, classification matches spec
    - **Property 3: On-Time Rate Threshold Classification** — For any rate 0–100 and valid thresholds (warningPct > criticalPct), classification matches spec
    - **Property 4: Customer Update Gap Threshold Classification** — For any elapsed ≥ 0 and valid thresholds, classification matches spec
    - File: `workers/alert-engine/src/__tests__/threshold-classification.property.test.ts`
    - **Validates: Requirements 2.2–2.4, 3.2–3.4, 7.2–7.3–7.6, 8.2–8.3–8.5**

  - [ ]* 6.9 Write unit tests for driver-silent, leg-overdue, and customer-update-gap rules
    - Test driver-silent: no active legs → empty results, 20 min elapsed → warning, 35 min → critical
    - Test leg-overdue: null ETAs skipped, within ETA → no fire, past ETA → warning/critical
    - Test customer-update-gap: below warning → no fire, above warning → warning, above critical → critical
    - Files: `workers/alert-engine/src/__tests__/driver-silent.test.ts`, `leg-overdue.test.ts`, `customer-update-gap.test.ts`
    - _Requirements: 2.1–2.6, 3.1–3.5, 8.1–8.5_

- [ ] 7. Checkpoint — Alert rules compile and unit tests pass
  - Ensure `pnpm --filter @surewaka/alert-engine test` passes, ask the user if questions arise.

- [ ] 8. Alert engine main polling loop and lifecycle manager
  - [ ] 8.1 Implement `workers/alert-engine/src/index.ts` — polling loop entry point
    - Initialize DB client on startup
    - Run first tick immediately (within 1000ms of init)
    - Register `setInterval(runTick, 60_000)` for subsequent ticks
    - Register SIGTERM/SIGINT handlers: allow in-progress tick to complete (max 10s), clear interval, exit with code 0
    - `runTick()`: load settings + admin user IDs, evaluate all 7 rules via `Promise.allSettled`, flatten fulfilled results, iterate and call `upsertAlert` for each
    - Log failed rule evaluations to stderr with rule name (skip, don't abort)
    - Log tick completion with count of active conditions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 8.2 Implement `upsertAlert()` function in `workers/alert-engine/src/index.ts`
    - If `shouldFire=false` and existing unresolved alert exists for (rule, deliveryId, legId): set `resolved_at` to now
    - If `shouldFire=false` and no existing: no-op
    - If `shouldFire=true` and no existing: INSERT new alert row
    - If `shouldFire=true` and existing with lower severity: UPDATE severity, set `original_severity`, set `escalated_at`
    - If `shouldFire=true` and existing with equal/higher severity: no-op
    - On insert/escalate to critical: call `routeCritical()`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ] 8.3 Implement `routeCritical()` function in `workers/alert-engine/src/index.ts`
    - If `pumbleEnabled && pumbleWebhookUrl`: call `sendPumbleAlert()`
    - If `pushEnabled`: call `enqueueAdminPush()` with all active admin user IDs
    - Only invoked for severity=critical alerts (never for warning/info)
    - _Requirements: 10.1, 10.3, 10.5_

  - [ ]* 8.4 Write property test for alert lifecycle state machine (Property 5)
    - **Property 5: Alert Lifecycle State Machine** — For any evaluation result and any existing alert state, `upsertAlert` produces the correct state transition
    - Generate random combinations of (shouldFire, existing severity or none) and verify transitions
    - File: `workers/alert-engine/src/__tests__/lifecycle.property.test.ts`
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

  - [ ]* 8.5 Write property test for fault-tolerant rule evaluation (Property 6)
    - **Property 6: Fault-Tolerant Rule Evaluation** — For any subset of rules that throw, all non-throwing rules still produce results
    - Mock random rules to throw, verify remaining results are collected
    - File: `workers/alert-engine/src/__tests__/fault-tolerance.property.test.ts`
    - **Validates: Requirements 1.3, 1.6**

- [ ] 9. Checkpoint — Alert engine runs and processes alerts
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Alert settings API route
  - [ ] 10.1 Create `apps/api/src/routes/admin/alert-settings.ts`
    - `GET /api/v1/admin/alert-settings`: return current settings row as `{ data, error: null, meta: null }`
    - `PUT /api/v1/admin/alert-settings`: validate body with `updateAlertSettingsSchema`, strip unrecognized fields, apply partial update, return updated row; 400 on validation failure
    - `POST /api/v1/admin/alert-settings/test`: send dummy Critical alert through enabled channels (Pumble POST if pumbleEnabled), return `{ data: { sent: true/false, channels: string[], failedChannels?: string[] }, error: null, meta: null }`
    - Apply `requireAuth` + `requireRole('surewaka_admin')` middleware on all routes
    - Return 401/403 for unauthorized/non-admin requests
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ] 10.2 Register alert-settings route in `apps/api/src/index.ts`
    - Import and mount at `/api/v1/admin/alert-settings`
    - _Requirements: 12.1_

  - [ ]* 10.3 Write unit tests for alert-settings API routes
    - Test GET returns current settings with 200
    - Test PUT with valid partial update returns updated settings
    - Test PUT with invalid threshold (below min) returns 400 with validation error
    - Test POST /test returns success shape
    - File: `apps/api/src/__tests__/alert-settings-routes.test.ts`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 11. Alert settings UI — `/settings/alerts` page
  - [ ] 11.1 Create data fetching hook `apps/admin/app/hooks/use-alert-settings.ts`
    - Export `useAlertSettings()` hook that manages: fetch settings (GET), save settings (PUT), send test alert (POST /test)
    - Handle loading, saving, and error states
    - Use auth token from session for Authorization header
    - _Requirements: 13.1, 13.7_

  - [ ] 11.2 Create settings page `apps/admin/app/routes/settings/alerts.tsx`
    - Display 8 threshold sliders with current value labels and min/max bounds
    - On slider release: send PUT with updated value, revert on failure
    - Pumble section: toggle switch for pumbleEnabled, input for webhook URL (validate HTTPS, max 2048 chars)
    - Push notification toggle switch for pushEnabled
    - "Send test alert" button: POST to /test endpoint, show confirmation toast for 5s on success, error on failure/timeout
    - WhatsApp Business placeholder section (future channel)
    - Loading state: skeleton placeholders for all controls
    - Error state: inline error message with retry button
    - Use shadcn/ui components (Slider, Switch, Input, Button, Skeleton, Label), Lucide icons, Tailwind v4
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [ ] 11.3 Add navigation link to alerts settings from parent settings layout
    - Modify `apps/admin/app/routes/settings.tsx` or settings navigation to include link to `/settings/alerts`
    - _Requirements: 13.1_

- [ ] 12. Final checkpoint — Full system integration
  - Ensure all tests pass across packages (`pnpm --filter @surewaka/alert-engine test`, `pnpm --filter @surewaka/api test`, `pnpm --filter @surewaka/shared build`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The alert engine worker runs as a standalone process at `workers/alert-engine/` — not integrated into the API server
- All notification routing (push + Pumble) is non-blocking: failures are logged but never crash the engine
- The singleton `alert_settings` row is seeded by the migration — no application-level initialization needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4", "5.5", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 7, "tasks": ["6.8", "6.9"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 9, "tasks": ["8.4", "8.5"] },
    { "id": 10, "tasks": ["10.1"] },
    { "id": 11, "tasks": ["10.2", "10.3"] },
    { "id": 12, "tasks": ["11.1"] },
    { "id": 13, "tasks": ["11.2", "11.3"] }
  ]
}
```
