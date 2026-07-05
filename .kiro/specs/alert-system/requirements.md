# Requirements Document

## Introduction

A 60-second polling alert engine, admin push notification infrastructure, and Pumble webhook routing — wired to a settings UI at `/settings/alerts` — so critical delivery incidents on the SureWaka platform are never silent. The alert engine evaluates 7 operational rules against live database state, writes/escalates/resolves alert rows, and routes Critical-severity alerts to admin Expo push notifications and a Pumble channel. Warning and Info alerts remain in-app only. Alert thresholds are configurable by admins through an API and UI. WhatsApp Business is a future notification channel (placeholder only in this spec).

## Glossary

- **Alert_Engine**: The background worker (`workers/alert-engine/`) that runs a 60-second `setInterval` polling loop, evaluates alert rules, and manages alert lifecycle.
- **Alert_Rule**: One of seven named evaluation functions that assess a specific operational condition against live database state and return evaluation results.
- **Alert_Settings**: The singleton database row (`alert_settings` table) containing configurable thresholds, Pumble webhook URL, and notification routing toggles.
- **Alert_Record**: A row in the `alerts` database table representing a fired, escalated, or resolved alert for a specific rule and delivery/leg combination.
- **Pumble_Sender**: The module that POSTs Critical alert messages as JSON `{ text: "..." }` to a configured Pumble incoming webhook URL (Slack-compatible format).
- **Push_Enqueuer**: The module that enqueues admin push notification jobs into the existing BullMQ push-worker queue for delivery via Expo Push API.
- **Settings_API**: The admin-only API routes (`GET/PUT /api/v1/admin/alert-settings` and `POST /api/v1/admin/alert-settings/test`) for reading, updating, and testing alert configuration.
- **Settings_UI**: The admin dashboard page at `/settings/alerts` providing threshold sliders, Pumble webhook configuration, push notification toggle, and a test alert button.
- **Evaluation_Result**: The typed output of each Alert_Rule evaluation, containing delivery context, severity, rule name, and a `shouldFire` boolean indicating whether to create/escalate or resolve an alert.
- **Active_Leg**: A delivery leg with status in `accepted`, `en_route_pickup`, `arrived_pickup`, `picked_up`, `en_route_dropoff`, or `arrived_dropoff`.

## Requirements

### Requirement 1: Alert Engine Polling Loop

**User Story:** As a platform operator, I want a background process that continuously monitors delivery operations, so that incidents are detected and surfaced within 60 seconds of occurrence.

#### Acceptance Criteria

1. WHEN the Alert_Engine process starts, THE Alert_Engine SHALL execute the first evaluation tick within 1000 milliseconds of initialization completing, and then repeat the evaluation tick at a fixed 60-second polling interval.
2. WHEN a SIGTERM or SIGINT signal is received, THE Alert_Engine SHALL allow any in-progress tick to complete (up to a maximum of 10 seconds), clear the polling interval timer, and then exit the process with exit code 0, leaving no orphaned timers or pending async operations.
3. WHEN an individual Alert_Rule evaluation throws an error during a tick, THE Alert_Engine SHALL log the error to stderr with the rule name and error message, skip that rule, and continue evaluating all remaining rules within the same tick without aborting the tick.
4. THE Alert_Engine SHALL load the current Alert_Settings from the database at the start of each tick so that threshold changes take effect within one polling cycle.
5. IF the database is unreachable or the Alert_Settings query fails at the start of a tick, THEN THE Alert_Engine SHALL log the error to stderr, skip the entire tick, and retry on the next polling interval without crashing the process.
6. WHEN an evaluation tick completes, THE Alert_Engine SHALL evaluate all registered Alert_Rules (currently 7 rules) before the tick is considered complete, regardless of individual rule failures handled by criterion 3.

### Requirement 2: Driver Silent Rule

**User Story:** As a platform operator, I want to be alerted when a driver stops sending GPS pings while on an active delivery leg, so that I can intervene before a delivery is lost.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `driver_silent` rule, THE Alert_Engine SHALL query all delivery legs assigned to a driver that have an Active_Leg status and compute the elapsed minutes since the most recent `recorded_at` timestamp from `driver_locations` for each such leg.
2. IF the elapsed minutes since the last GPS ping is greater than or equal to `driverSilentWarningMin` (default 15) and less than `driverSilentCriticalMin` (default 30), THEN THE Alert_Engine SHALL produce an Evaluation_Result with severity `warning` and `shouldFire` set to true.
3. IF the elapsed minutes since the last GPS ping is greater than or equal to `driverSilentCriticalMin` (default 30), THEN THE Alert_Engine SHALL produce an Evaluation_Result with severity `critical` and `shouldFire` set to true.
4. IF the elapsed minutes since the last GPS ping is less than `driverSilentWarningMin` (default 15), THEN THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false.
5. IF no GPS ping has ever been recorded in `driver_locations` for the driver on an active leg, THEN THE Alert_Engine SHALL treat the elapsed time as the number of minutes since the leg's `started_at` timestamp.
6. THE Alert_Engine SHALL produce exactly one Evaluation_Result per active leg and include the delivery ID, driver name, elapsed minutes silent, and the leg's `dropoff_zone` in the Evaluation_Result context.

### Requirement 3: Leg Overdue Rule

**User Story:** As a platform operator, I want to be alerted when a delivery leg exceeds its estimated time of arrival, so that I can coordinate alternative delivery arrangements.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `leg_overdue` rule, THE Alert_Engine SHALL query all delivery legs with an Active_Leg status that have a non-null `driver_eta_at` or `system_eta_at` value, and compute the elapsed minutes past ETA as `(current_time − ETA) / 60000`, using `driver_eta_at` when non-null in preference to `system_eta_at`.
2. WHEN the elapsed minutes past ETA equals or exceeds the `legOverdueWarningMin` threshold (default 30) but is less than `legOverdueCriticalMin` (default 60), THE Alert_Engine SHALL produce an Evaluation_Result with severity `warning`, `shouldFire` set to true, and a context object containing the `deliveryId`, `legId`, `minutesOverdue` (integer floor), `zone`, and `etaSource` (either `driver` or `system`).
3. WHEN the elapsed minutes past ETA equals or exceeds the `legOverdueCriticalMin` threshold (default 60), THE Alert_Engine SHALL produce an Evaluation_Result with severity `critical`, `shouldFire` set to true, and the same context fields as the warning case.
4. WHEN the leg has not yet exceeded its ETA (elapsed minutes ≤ 0), THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false and severity `info`.
5. IF a delivery leg has an Active_Leg status but both `driver_eta_at` and `system_eta_at` are null, THEN THE Alert_Engine SHALL skip that leg and produce no Evaluation_Result for it.

### Requirement 4: Driver Ghost Rule

**User Story:** As a platform operator, I want to be alerted when a driver cancels a delivery before pickup, so that I can immediately reassign and minimize customer wait time.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `driver_ghost` rule, THE Alert_Engine SHALL query delivery events where the status transitioned to `cancelled` or `failed` from a pre-pickup status (`pending`, `accepted`, `en_route_pickup`, or `arrived_pickup`), the event occurred within the last 10 minutes, and the cancellation was not triggered by the customer.
2. WHEN a qualifying driver-triggered cancellation is detected, THE Alert_Engine SHALL produce an Evaluation_Result with severity `critical`, `shouldFire` set to true, and context containing the delivery ID, driver name, and trigger source (the actor who initiated the cancellation).
3. IF the Alert_Engine evaluates the `driver_ghost` rule and no qualifying cancellation events are found within the 10-minute window, THEN THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false and an empty context object.

### Requirement 5: Dispute Filed Rule

**User Story:** As a platform operator, I want to be alerted when a new delivery dispute is filed, so that I can acknowledge and begin resolution before escalation.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `dispute_filed` rule, THE Alert_Engine SHALL query deliveries with escrow status `disputed` that do not have an existing unresolved Alert_Record (where `resolved_at` is NULL) for the `dispute_filed` rule.
2. WHEN one or more unacknowledged disputed deliveries are detected, THE Alert_Engine SHALL produce one Evaluation_Result per delivery with severity `warning`, `shouldFire` set to true, and context containing at minimum the delivery ID and the timestamp at which the escrow status transitioned to `disputed`.
3. IF no deliveries with escrow status `disputed` lacking an unresolved Alert_Record are found during evaluation, THEN THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false.

### Requirement 6: Delivery Failed Rule

**User Story:** As a platform operator, I want to be alerted when a delivery status transitions to failed, so that I can investigate and arrange recovery.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `delivery_failed` rule, THE Alert_Engine SHALL query deliveries with status `failed` whose `updated_at` timestamp is within the last 2 minutes and that do not have an existing Alert_Record for the `delivery_failed` rule where the Alert_Record has no `resolved_at` timestamp.
2. WHEN a newly-failed delivery is detected, THE Alert_Engine SHALL produce one Evaluation_Result per matched delivery with severity `warning`, `shouldFire` set to true, and context containing at minimum the delivery ID and the `updated_at` timestamp of the failed delivery.
3. IF the Alert_Engine evaluates the `delivery_failed` rule and no deliveries match the query criteria, THEN THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false and an empty context.
4. WHEN multiple deliveries match the `delivery_failed` query in a single evaluation cycle, THE Alert_Engine SHALL produce a separate Evaluation_Result for each matched delivery.

### Requirement 7: On-Time Rate Drop Rule

**User Story:** As a platform operator, I want to be alerted when the platform's daily on-time delivery rate drops below acceptable thresholds, so that I can identify systemic issues.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `ontime_rate_drop` rule, THE Alert_Engine SHALL compute the percentage of today's deliveries with status `delivered` that have an `updated_at` timestamp on or before their `system_eta_at`, using Africa/Lagos (WAT) timezone for the "today" date boundary. Deliveries with a null `system_eta_at` SHALL be excluded from the calculation.
2. IF the computed on-time rate is below the `ontimeRateCriticalPct` threshold (default 60), THEN THE Alert_Engine SHALL produce an Evaluation_Result with severity `critical` and `shouldFire` set to true.
3. IF the computed on-time rate is below the `ontimeRateWarningPct` threshold (default 80) but at or above `ontimeRateCriticalPct`, THEN THE Alert_Engine SHALL produce an Evaluation_Result with severity `warning` and `shouldFire` set to true.
4. IF fewer than 5 deliveries with status `delivered` exist for today, THEN THE Alert_Engine SHALL skip the `ontime_rate_drop` evaluation and produce no Evaluation_Result, to avoid false alerts from insufficient data.
5. THE Alert_Engine SHALL include the on-time rate percentage (rounded to 1 decimal place), total delivered count, and on-time count in the Evaluation_Result context.
6. IF the computed on-time rate is at or above the `ontimeRateWarningPct` threshold, THEN THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false.

### Requirement 8: Customer Update Gap Rule

**User Story:** As a platform operator, I want to be alerted when a customer has not received a status update for an extended period, so that I can ensure communication continuity.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `customer_update_gap` rule, THE Alert_Engine SHALL query all deliveries with a status that is not in (`delivered`, `cancelled`, `failed`, `returned`, `draft`) and compute the elapsed minutes since the most recent customer-facing delivery event for each delivery. IF a delivery has no prior customer-facing event, THEN THE Alert_Engine SHALL use the delivery `created_at` timestamp as the baseline for elapsed time computation.
2. WHEN the elapsed minutes equals or exceeds the `customerUpdateGapCriticalMin` threshold (default 90), THE Alert_Engine SHALL produce an Evaluation_Result with severity `critical` and `shouldFire` set to true.
3. WHEN the elapsed minutes equals or exceeds the `customerUpdateGapWarningMin` threshold (default 45) but is less than `customerUpdateGapCriticalMin`, THE Alert_Engine SHALL produce an Evaluation_Result with severity `warning` and `shouldFire` set to true.
4. THE Alert_Engine SHALL include the delivery ID, customer name, and minutes since last update in the Evaluation_Result context.
5. IF the elapsed minutes is below the `customerUpdateGapWarningMin` threshold for a delivery, THEN THE Alert_Engine SHALL produce an Evaluation_Result with `shouldFire` set to false for that delivery.

### Requirement 9: Alert Lifecycle — Upsert, Escalation, and Resolution

**User Story:** As a platform operator, I want alerts to escalate in-place when conditions worsen and auto-resolve when conditions clear, so that the alerts table reflects current state without duplicate rows.

#### Acceptance Criteria

1. WHEN an Evaluation_Result has `shouldFire` set to true and no Alert_Record with a NULL `resolved_at` exists for the same rule, delivery_id, and leg_id combination, THE Alert_Engine SHALL insert a new Alert_Record with the evaluation severity, the Evaluation_Result payload as context, and `fired_at` set to the current UTC timestamp.
2. WHEN an Evaluation_Result has `shouldFire` set to true and an Alert_Record with a NULL `resolved_at` already exists for the same rule, delivery_id, and leg_id combination with a severity lower in the ordinal ranking (info < warning < critical), THE Alert_Engine SHALL update the existing Alert_Record by setting the severity to the new higher value, copying the current severity into `original_severity`, setting `escalated_at` to the current UTC timestamp, and replacing the context with the new Evaluation_Result payload.
3. WHEN an Evaluation_Result has `shouldFire` set to true and an Alert_Record with a NULL `resolved_at` already exists for the same rule, delivery_id, and leg_id combination with a severity equal to or higher in the ordinal ranking (info < warning < critical), THE Alert_Engine SHALL take no action on that Alert_Record.
4. WHEN an Evaluation_Result has `shouldFire` set to false and at least one Alert_Record with a NULL `resolved_at` exists matching the same rule, delivery_id, and leg_id combination, THE Alert_Engine SHALL set `resolved_at` to the current UTC timestamp on each matching Alert_Record.
5. IF an Evaluation_Result has `shouldFire` set to false and no Alert_Record with a NULL `resolved_at` exists for the matching rule, delivery_id, and leg_id combination, THEN THE Alert_Engine SHALL take no action.
6. THE Alert_Engine SHALL perform each insert or update to an Alert_Record within a single atomic operation scoped to the rule, delivery_id, and leg_id combination, so that concurrent Evaluation_Results for the same combination cannot produce duplicate or conflicting records.

### Requirement 10: Critical Alert Routing — Push and Pumble

**User Story:** As a platform operator, I want Critical alerts to be immediately pushed to my phone and team Pumble channel, so that I am aware of urgent incidents even when not watching the dashboard.

#### Acceptance Criteria

1. WHEN a new Alert_Record is inserted with severity `critical` or an existing Alert_Record is escalated to `critical`, AND the `pushEnabled` setting is true, THE Push_Enqueuer SHALL enqueue a push notification job for each admin user whose account status is `active` and who has at least one registered device token, into the BullMQ push-worker queue with priority `high` and a maximum of 3 retry attempts using exponential backoff starting at 1 second with a maximum delay of 30 seconds.
2. IF the Push_Enqueuer fails to enqueue a push notification job due to a queue connection error or serialization error, THEN THE Push_Enqueuer SHALL log the failure including the Alert_Record ID and affected user ID, and continue processing remaining admin users without throwing.
3. WHEN a new Alert_Record is inserted with severity `critical` or an existing Alert_Record is escalated to `critical`, AND the `pumbleEnabled` setting is true and the `pumbleWebhookUrl` is a non-empty string, THE Pumble_Sender SHALL POST a JSON payload to the configured webhook URL within a 10-second timeout, where the `text` field contains the rule label, delivery reference, alert severity, and timestamp of the triggering event.
4. IF the Pumble_Sender POST request fails due to a network error, non-2xx response, or timeout exceeding 10 seconds, THEN THE Pumble_Sender SHALL log the failure including the Alert_Record ID, HTTP status code (if available), and error reason, and continue without throwing so that the alert lifecycle is not interrupted.
5. WHEN a new Alert_Record is inserted with severity `warning` or `info`, THE Alert_Engine SHALL NOT route the alert to push notifications or Pumble, keeping those alerts as in-app notifications only.

### Requirement 11: Alert Settings Storage and Defaults

**User Story:** As a platform operator, I want alert thresholds stored in the database with sensible defaults for Nigerian network conditions, so that the system works out of the box and I can tune thresholds later.

#### Acceptance Criteria

1. THE Alert_Settings table SHALL be initialized with exactly one singleton row containing the following defaults: `driverSilentWarningMin` = 15, `driverSilentCriticalMin` = 30, `legOverdueWarningMin` = 30, `legOverdueCriticalMin` = 60, `customerUpdateGapWarningMin` = 45, `customerUpdateGapCriticalMin` = 90, `ontimeRateWarningPct` = 80, `ontimeRateCriticalPct` = 60, `pushEnabled` = true, `pumbleEnabled` = false.
2. THE Alert_Settings table SHALL enforce a single-row constraint so that attempts to insert a second row are rejected by the database.
3. THE Alert_Settings table SHALL store a `pumbleWebhookUrl` text field (nullable, maximum 2048 characters), a `push_enabled` boolean field, and a `pumble_enabled` boolean field.
4. WHEN any column in the Alert_Settings row is updated, THE Alert_Settings table SHALL set the `updated_at` timestamp to the current time.
5. IF an update attempts to set a minute-based warning threshold greater than or equal to its corresponding critical threshold, or a percentage-based warning threshold less than or equal to its corresponding critical threshold, THEN THE System SHALL reject the update with an error message indicating the invalid threshold relationship.

### Requirement 12: Admin Alert Settings API

**User Story:** As an admin, I want API endpoints to read and update alert settings and test my notification routing, so that I can configure the system programmatically or from the UI.

#### Acceptance Criteria

1. WHEN an authenticated admin sends a GET request to `/api/v1/admin/alert-settings`, THE Settings_API SHALL return HTTP 200 with the current Alert_Settings row in the response `data` field with shape `{ data, error: null, meta: null }`.
2. WHEN an authenticated admin sends a PUT request to `/api/v1/admin/alert-settings` with a valid partial update body, THE Settings_API SHALL validate the body against the `updateAlertSettingsSchema` (integer thresholds within the schema-defined min/max bounds, optional URL of at most 2048 characters, optional booleans), strip any unrecognized fields, apply the update to the singleton row, and return HTTP 200 with the updated Alert_Settings in the response `data` field.
3. IF the PUT request body fails Zod validation, THEN THE Settings_API SHALL return HTTP 400 with a response containing the validation failure details in the `error` field and `data: null`.
4. WHEN an authenticated admin sends a POST request to `/api/v1/admin/alert-settings/test`, THE Settings_API SHALL send a dummy Critical alert message through all currently-enabled channels (Pumble webhook if `pumbleEnabled` is true) with a maximum timeout of 10 seconds per channel, and return HTTP 200 with `{ data: { sent: true, channels: string[] }, error: null, meta: null }` where `channels` lists the channels that were attempted.
5. IF a non-admin or unauthenticated user sends a request to any alert-settings endpoint, THEN THE Settings_API SHALL return HTTP 401 or 403 with `data: null` without revealing settings data.
6. IF the test notification delivery fails for one or more enabled channels (network error or timeout), THEN THE Settings_API SHALL return HTTP 200 with `{ data: { sent: false, channels: string[], failedChannels: string[] }, error: null, meta: null }` indicating which channels failed delivery.

### Requirement 13: Alert Settings Admin UI

**User Story:** As an admin, I want a dedicated settings page at `/settings/alerts` with threshold sliders, notification routing toggles, and a test button, so that I can configure and verify alert behavior without touching the API directly.

#### Acceptance Criteria

1. THE Settings_UI SHALL display slider controls for each configurable threshold (`driverSilentWarningMin`, `driverSilentCriticalMin`, `legOverdueWarningMin`, `legOverdueCriticalMin`, `customerUpdateGapWarningMin`, `customerUpdateGapCriticalMin`, `ontimeRateWarningPct`, `ontimeRateCriticalPct`) with the current value displayed as a label.
2. WHEN an admin releases a threshold slider at a new value, THE Settings_UI SHALL send a PUT request to the Settings_API with the updated value within 500 milliseconds and, upon a success response, update the displayed label to reflect the saved value; IF the PUT request fails, THEN the slider SHALL revert to its previous saved value.
3. THE Settings_UI SHALL display a toggle switch to enable or disable Pumble webhook routing and an input field for the Pumble incoming webhook URL that accepts a maximum of 2048 characters; WHEN the admin submits the webhook URL, THE Settings_UI SHALL validate that the value is a well-formed HTTPS URL before sending and, if validation fails, display an inline error message indicating the URL format is invalid.
4. THE Settings_UI SHALL display a toggle switch to enable or disable admin push notifications.
5. WHEN the admin clicks the "Send test alert" button, THE Settings_UI SHALL send a POST request to `/api/v1/admin/alert-settings/test` and, upon a success response, display a confirmation message for 5 seconds; IF the POST request fails or does not respond within 10 seconds, THEN THE Settings_UI SHALL display an error message indicating the test alert could not be sent.
6. THE Settings_UI SHALL display a placeholder section indicating WhatsApp Business is a future notification channel.
7. WHILE the Settings_UI is loading Alert_Settings from the API, THE Settings_UI SHALL display skeleton placeholder elements in place of each slider, toggle, input field, and button.
8. IF the Settings_API returns an error on initial page load, THEN THE Settings_UI SHALL display an inline error message to the admin and provide a retry action to re-fetch the settings.

### Requirement 14: Database Schema — Alerts Table

**User Story:** As a developer, I want a well-structured alerts table with appropriate indexes and constraints, so that alert queries are performant and data integrity is maintained.

#### Acceptance Criteria

1. THE `alerts` table SHALL contain columns: `id` (UUID primary key with default `gen_random_uuid()`), `delivery_id` (nullable FK to `deliveries.id` with ON DELETE CASCADE), `leg_id` (nullable FK to `delivery_legs.id` with ON DELETE SET NULL), `rule` (text, not null), `severity` (text, not null, CHECK constraint limiting to `info`, `warning`, `critical`), `original_severity` (text, nullable, same CHECK constraint), `context` (JSONB, not null, default `'{}'::jsonb`), `fired_at` (timestamptz, not null, default `now()`), `escalated_at` (timestamptz, nullable), `resolved_at` (timestamptz, nullable), `ack_by` (nullable FK to `users.id` with ON DELETE SET NULL).
2. THE `alerts` table SHALL have a partial index on `fired_at DESC` filtered to rows where `resolved_at IS NULL` for efficient unresolved alert queries.
3. THE `alerts` table SHALL have a partial index on `delivery_id` filtered to rows where `delivery_id IS NOT NULL`.
4. THE `push_tokens` table app CHECK constraint SHALL be replaced to include `'admin'` as a valid value alongside `'customer'` and `'driver'`.

### Requirement 15: Alert Settings Validation Bounds

**User Story:** As a developer, I want strict validation on alert settings values, so that admins cannot set nonsensical thresholds that would flood or silence the system.

#### Acceptance Criteria

1. THE `updateAlertSettingsSchema` SHALL validate `driverSilentWarningMin` as an integer between 5 and 60 inclusive.
2. THE `updateAlertSettingsSchema` SHALL validate `driverSilentCriticalMin` as an integer between 10 and 120 inclusive.
3. THE `updateAlertSettingsSchema` SHALL validate `legOverdueWarningMin` as an integer between 10 and 120 inclusive.
4. THE `updateAlertSettingsSchema` SHALL validate `legOverdueCriticalMin` as an integer between 20 and 240 inclusive.
5. THE `updateAlertSettingsSchema` SHALL validate `customerUpdateGapWarningMin` as an integer between 15 and 120 inclusive.
6. THE `updateAlertSettingsSchema` SHALL validate `customerUpdateGapCriticalMin` as an integer between 30 and 240 inclusive.
7. THE `updateAlertSettingsSchema` SHALL validate `ontimeRateWarningPct` as an integer between 50 and 100 inclusive.
8. THE `updateAlertSettingsSchema` SHALL validate `ontimeRateCriticalPct` as an integer between 30 and 90 inclusive.
9. THE `updateAlertSettingsSchema` SHALL validate `pumbleWebhookUrl` as a URL string with a maximum length of 2048 characters beginning with `https://`, or null.
10. THE `updateAlertSettingsSchema` SHALL allow all fields to be optional so that partial updates are supported.
11. THE `updateAlertSettingsSchema` SHALL enforce that when both a warning and its corresponding critical field are provided, the warning value is strictly less than the critical value for time-based pairs (`driverSilentWarningMin` < `driverSilentCriticalMin`, `legOverdueWarningMin` < `legOverdueCriticalMin`, `customerUpdateGapWarningMin` < `customerUpdateGapCriticalMin`) and the warning value is strictly greater than the critical value for percentage pairs (`ontimeRateWarningPct` > `ontimeRateCriticalPct`).
12. IF the submitted payload fails schema validation, THEN THE `updateAlertSettingsSchema` SHALL return a Zod validation error identifying each invalid field and the constraint it violated.
