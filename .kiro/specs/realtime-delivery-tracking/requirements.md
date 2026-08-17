# Requirements Document

## Introduction

Two customer-facing screens need to move from static/polling content to genuinely realtime: `booking/confirmed.tsx` (currently a static "Booking Confirmed!" screen) becomes a live matching-progress experience, and `/tracking/[id].tsx` (currently 30-second polling, no realtime) becomes push-driven. Neither mobile app has any realtime/Ably wiring today — that capability is built once (Phase 1) and reused by both screens. See `design.md` for the full architecture and the specific existing gaps found while scoping this (a dead `EVENTS.statusUpdate` constant, an already-published-but-unconsumed `'driver-assigned'` event, a status-enum mismatch in the tracking screen's stepper).

## Glossary

- **Matching_Progress_Screen**: The rewritten `booking/confirmed.tsx` — shows live status while the system searches for a driver.
- **Realtime_Token_Endpoint**: The new endpoint that mints a scoped, short-lived Ably token per tracking session (Requirement 1).
- **Retry_Matching**: The user-initiated action, via a new endpoint, that re-enqueues driver matching after a `routing_failed` delivery.

## Requirements

### Phase 1: Matching-Progress Screen + Shared Realtime Infrastructure

#### Requirement 1: Ably Token-Auth Endpoint

**User Story:** As a mobile client, I want to obtain a realtime connection credential without the app embedding a shared API key, so realtime access is properly scoped and revocable per session.

##### Acceptance Criteria

1. WHEN an authenticated user requests a token for a specific `deliveryId`, THE Realtime_Token_Endpoint SHALL verify the delivery belongs to that user before issuing a token
2. THE issued token SHALL be scoped (Ably capability) to only that delivery's `CHANNELS.deliveryTracking(deliveryId)` channel, not a broad capability covering other deliveries or users
3. IF the requesting user does not own the delivery, THEN THE endpoint SHALL return a 403/404 rather than issuing a token
4. THE token SHALL be short-lived per Ably's standard token-expiry mechanism, requested fresh per tracking session rather than cached long-term client-side

#### Requirement 2: Shared Client-Side Realtime Hook

**User Story:** As a developer, I want one reusable way to subscribe to a delivery's realtime channel, so both screens (and `mobile-driver` later) don't each reimplement token-fetching, connection handling, and reconnection logic.

##### Acceptance Criteria

1. THE hook SHALL live in `packages/mobile-shared`, not duplicated per app
2. THE hook SHALL fetch a token via Requirement 1, connect, subscribe to specified events on a delivery's channel, and unsubscribe/disconnect on unmount
3. WHEN the realtime connection drops (a real, common scenario on Nigerian mobile networks, not an edge case), THE hook SHALL attempt to reconnect and re-subscribe rather than silently going stale
4. Consumers of the hook SHALL have a way to fall back to a REST fetch if a realtime event may have been missed (e.g. on reconnect, or on initial mount before the subscription is ready) — realtime SHALL be a live-update mechanism layered on top of REST state, not the sole source of truth

#### Requirement 3: Matching-Progress Screen

**User Story:** As a customer who just booked a delivery, I want to see live progress while a driver is being found, so I know the app is actively working rather than wondering if anything is happening.

##### Acceptance Criteria

1. WHEN `booking/confirmed.tsx` mounts, THE screen SHALL show a "searching" state (an animated hero illustration + "Finding your driver…" or similar text) by default, and SHALL also fetch the delivery's current state via REST in case matching already resolved before the screen mounted
2. WHEN the screen receives the existing `'driver-assigned'` event (already published by `delivery-accept.ts` — no backend change required for this transition) on the delivery's realtime channel, THE screen SHALL transition to a matched state and redirect to `/tracking/:deliveryId`
3. WHEN the screen receives a `'matching-failed'` event (Requirement 5), THE screen SHALL show a distinct failed-state illustration, an explanatory message, and a "Try Again" action
4. THE searching state SHALL use one evolving animated illustration with status text changing beneath it, not a distinct illustration per matching tier/stage — matching-tier granularity (e.g. "expanding search radius") is explicitly out of scope for the UI, per simplified scope agreed during design

#### Requirement 4: Retry Matching

**User Story:** As a customer whose delivery failed to match a driver, I want to retry from within the app, so I'm not stuck needing manual intervention (as every occurrence was handled this session).

##### Acceptance Criteria

1. WHEN the user taps "Try Again" on the failed state, THE app SHALL call a new retry-matching endpoint for that delivery
2. THE endpoint SHALL verify the delivery belongs to the caller and is in a `routing_failed` state before acting
3. IF the delivery is not in a retryable state, THEN THE endpoint SHALL reject the request rather than silently no-op or re-matching an already-progressing delivery
4. ON a valid retry request, THE endpoint SHALL reset the delivery to a matchable state and enqueue a fresh matching job, handling the case where a prior job with the same deterministic job ID still exists (must not fail with a duplicate-ID error, as the manual version of this did earlier this session before that was worked around by hand)

#### Requirement 5: Matching-Worker Failure Notification

**User Story:** As the matching-progress screen, I need to know when matching has permanently failed, so I can show the failed state instead of waiting forever.

##### Acceptance Criteria

1. WHEN `matching-worker` exhausts all retry attempts for a delivery (the existing `routing_failed` path), THE worker SHALL, in addition to its existing DB update and push notification, publish a `'matching-failed'` event on that delivery's realtime channel
2. This SHALL use the same channel (`CHANNELS.deliveryTracking(deliveryId)`) the matched-state event (Requirement 3.2) and Phase 2's status updates use, so the client only needs one subscription per delivery

### Phase 2: Tracking Screen Realtime + Status Enum Fix

#### Requirement 6: Tracking Screen Goes Realtime

**User Story:** As a customer tracking an in-progress delivery, I want status changes to appear instantly, not up to 30 seconds late.

##### Acceptance Criteria

1. `/tracking/[id].tsx` SHALL subscribe to the delivery's realtime channel via Requirement 2's shared hook instead of relying solely on its current 30-second poll
2. THE initial REST fetch on mount SHALL remain (first paint before a subscription is established)
3. Pull-to-refresh SHALL remain available as a manual fallback
4. A longer-interval poll (e.g. 60 seconds) SHALL remain active even while the realtime subscription is connected, as a resilience safety net — not removed outright, per Requirement 2.3's reconnection-is-not-an-edge-case principle
5. THE screen SHALL re-sync (REST fetch) when the app returns to the foreground, in case events were missed while backgrounded

#### Requirement 7: Publish Leg Status Changes

**User Story:** As the tracking screen, I need the server to actually tell me when a leg's status changes, not just when a driver is first assigned.

##### Acceptance Criteria

1. WHEN a delivery leg's status is successfully updated (`PATCH /deliveries/:deliveryId/legs/:legId/status`), THE handler SHALL publish `EVENTS.statusUpdate` on `CHANNELS.deliveryTracking(deliveryId)` — a constant that already exists in `packages/realtime/src/types.ts` but is currently never published anywhere in the codebase
2. THE published payload SHALL include the leg's new status and, if it also changed as a result (per the delivery-completion logic added in `.kiro/specs/actor-simulator/`), the delivery's overall status

#### Requirement 8: Fix the Status Stepper's Enum Mismatch

**User Story:** As a customer viewing the tracking screen, I want the status stepper to actually highlight my delivery's real progress, not silently mismatch because the app is checking against status values that don't exist in the real system.

##### Acceptance Criteria

1. THE tracking screen's status type and step-ordering SHALL be updated to match the real backend `delivery_status` enum (`accepted`, `en_route_pickup`, `arrived_pickup`, `picked_up`, `en_route_dropoff`, `arrived_dropoff`, `delivered`, plus terminal `cancelled`/`failed`/`returned` states) rather than the current `pending/matched/picked_up/in_transit/delivered/cancelled` set, which does not match and causes most real statuses to fail to highlight (`indexOf` returns `-1`)
2. THE fix SHALL cover both the type definition and the `statusSteps`/`statusOrder` arrays driving the stepper UI

## Out of Scope

- Live map / driver location marker on the tracking screen (the existing "Map view coming soon" placeholder) — explicitly deferred per design discussion, not part of this spec
- Per-tier ("expanding search radius") granularity in the matching-progress UI — explicitly simplified out per Requirement 3.4
- `mobile-driver` consuming the shared realtime hook — the hook is built reusably (Requirement 2.1) but no consumer in `mobile-driver` is required by this spec
