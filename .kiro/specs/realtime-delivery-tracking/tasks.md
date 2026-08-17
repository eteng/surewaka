# Implementation Plan: Realtime Delivery Tracking

## Overview

Phase 1 first (shared infra + matching-progress screen) — it's smaller than it first looked, since the "matched" transition reuses an already-published event. Phase 2 (tracking screen realtime + status-enum fix) builds on Phase 1's infra and can slip to a later session without blocking Phase 1 from shipping. Within each phase: backend plumbing before client consumption, illustration assets sourced early since they block screen completion the same way the sound asset blocked `custom-notification-sound`.

## Tasks

### Phase 1: Shared Infrastructure + Matching-Progress Screen

- [ ] 1. Ably Token-Auth Endpoint
  - [ ] 1.1 Implement `GET /api/v1/realtime/token` in `apps/api`
    - Verify caller owns the `deliveryId` in the query param
    - Call the Ably SDK directly (not through `RealtimeProvider`, which doesn't expose token auth) to create a token request scoped to `CHANNELS.deliveryTracking(deliveryId)` only
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [ ] 1.2 Tests
    - Requires auth, verifies ownership, rejects non-owners, returns a correctly-scoped token on success
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Shared Client-Side Realtime Hook
  - [ ] 2.1 Implement `useRealtimeChannel` (or similar) in `packages/mobile-shared`
    - Fetch token (Task 1) → connect via `ably` JS client → subscribe to specified events → clean up on unmount
    - Reconnect + re-subscribe on connection drop
    - Expose a way for consumers to trigger a REST fallback fetch (missed-event recovery)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ] 2.2 Spike: confirm `ably`'s React Native compatibility doesn't require a native rebuild
    - Given this session's pattern of "assumed working, wasn't" (location-store/reservation-layer init gaps) — verify early, don't assume
    - _Requirements: (informs Rollout in design.md, no specific acceptance criterion)_

- [ ] 3. Illustration Assets
  - [ ] 3.1 Source/produce three assets: searching (animated), matched/success (static), failed (static)
    - Blocks Task 4's screen completion, same as the sound asset blocked `custom-notification-sound` — flag early
    - _Requirements: 3.1, 3.3, 3.4_

- [ ] 4. Matching-Progress Screen (`booking/confirmed.tsx` rewrite)
  - [ ] 4.1 Implement the three-state UI (searching / matched-redirect / failed-retry)
    - Initial REST fetch on mount (race: matching may already have resolved) + subscribe via Task 2's hook
    - Matched: redirect to `/tracking/:deliveryId` on the existing `'driver-assigned'` event — confirm no backend change is actually needed here before writing client code
    - Failed: show failed illustration + message + "Try Again" (Task 6)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Matching-Worker Failure Publish
  - [ ] 5.1 Add `realtime.publish(..., 'matching-failed', ...)` to the exhausted-retries branch in `workers/matching-worker/src/index.ts`
    - Reuse the existing `createAblyProvider()` ad-hoc pattern already used in this worker
    - _Requirements: 5.1, 5.2_
  - [ ] 5.2 Test the publish call happens in that branch
    - Mirror the mocking approach used for `delivery-legs-status.test.ts` this session
    - _Requirements: 5.1_

- [ ] 6. Retry-Matching Endpoint
  - [ ] 6.1 Implement `POST /api/v1/deliveries/:id/retry-matching`
    - Verify ownership + `routing_failed` status; reject otherwise
    - Reset status to `pending`, remove any existing job under the same deterministic `jobId` (duplicate-ID add is otherwise rejected — hit this exact error manually this session), enqueue a fresh `match-driver` job
    - Consider factoring the job-construction logic shared with `booking-payment.ts`'s initial trigger into one function rather than a third copy of the same `matchDriverJobDataSchema.parse(...)` block
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 6.2 Tests
    - Rejects non-owners, rejects non-`routing_failed` deliveries, enqueues correctly on the happy path, handles the duplicate-job-id case
    - _Requirements: 4.2, 4.3, 4.4_

- [ ] 7. Phase 1 Manual Verification
  - [ ] 7.1 End-to-end: book a delivery, watch the searching state, confirm redirect on match (real or via the actor-simulator's bots — `.kiro/specs/actor-simulator/`)
  - [ ] 7.2 End-to-end: force a `routing_failed` (e.g. no eligible bot in range, as happened naturally this session), confirm the failed state + working Try Again
    - _Requirements: all of Phase 1_

### Phase 2: Tracking Screen Realtime + Status Enum Fix

- [ ] 8. `delivery-legs.ts` Status Publish
  - [ ] 8.1 Publish `EVENTS.statusUpdate` on `CHANNELS.deliveryTracking(deliveryId)` after a successful leg status update
    - Include new leg status and, if changed, delivery-level status
    - _Requirements: 7.1, 7.2_
  - [ ] 8.2 Test the publish call
    - _Requirements: 7.1_

- [ ] 9. Status Enum Fix
  - [ ] 9.1 Update `/tracking/[id].tsx`'s `Delivery['status']` type and `statusSteps`/`statusOrder` to the real backend enum
    - _Requirements: 8.1, 8.2_

- [ ] 10. Tracking Screen Realtime Rewrite
  - [ ] 10.1 Replace the 30s poll with Task 2's hook subscribed to `EVENTS.statusUpdate`
    - Keep initial fetch, pull-to-refresh, and add a 60s resilience-fallback poll
    - Re-sync on app foreground
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 11. Phase 2 Manual Verification
  - [ ] 11.1 End-to-end: track a delivery through multiple leg status changes (via the actor-simulator), confirm the stepper updates live and correctly for real status values
    - _Requirements: all of Phase 2_
