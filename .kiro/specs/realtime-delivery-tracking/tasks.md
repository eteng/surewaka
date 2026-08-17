# Implementation Plan: Realtime Delivery Tracking

## Overview

Phase 1 first (shared infra + matching-progress screen) — it's smaller than it first looked, since the "matched" transition reuses an already-published event. Phase 2 (tracking screen realtime + status-enum fix) builds on Phase 1's infra and can slip to a later session without blocking Phase 1 from shipping. Within each phase: backend plumbing before client consumption, illustration assets sourced early since they block screen completion the same way the sound asset blocked `custom-notification-sound`.

## Tasks

### Phase 1: Shared Infrastructure + Matching-Progress Screen

- [x] 1. Ably Token-Auth Endpoint
  - [x] 1.1 Implement `GET /api/v1/realtime/token` in `apps/api`
    - Verify caller owns the `deliveryId` in the query param
    - Call the Ably SDK directly (not through `RealtimeProvider`, which doesn't expose token auth) to create a token request scoped to `CHANNELS.deliveryTracking(deliveryId)` only
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.2 Tests
    - Requires auth, verifies ownership, rejects non-owners, returns a correctly-scoped token on success
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Shared Client-Side Realtime Hook
  - [x] 2.1 Implement `useRealtimeChannel` (or similar) in `packages/mobile-shared`
    - Fetch token (Task 1) → connect via `ably` JS client → subscribe to specified events → clean up on unmount
    - Reconnect + re-subscribe on connection drop
    - Expose a way for consumers to trigger a REST fallback fetch (missed-event recovery)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.2 Spike: confirm `ably`'s React Native compatibility doesn't require a native rebuild
    - Given this session's pattern of "assumed working, wasn't" (location-store/reservation-layer init gaps) — verify early, don't assume
    - Verified via static package inspection: `ably`'s package.json declares a dedicated `"react-native"` export condition (`build/ably-reactnative.js`), which Expo SDK 57's default Metro config resolves automatically (package-exports + RN condition on by default). That build has zero native `require()`s — only `fastestsmallesttextencoderdecoder` (pure JS) and `react-native` core itself — and the package ships no `ios/`, `android/`, podspec, or `expo-module.config.json`. No EAS dev-client rebuild needed to add this dependency. **Not yet confirmed by actually booting the app** — that's Task 7's manual e2e pass; flag immediately if it contradicts this.
    - _Requirements: (informs Rollout in design.md, no specific acceptance criterion)_

- [ ] 3. Illustration Assets
  - [ ] 3.1 Source/produce three assets: searching (animated), matched/success (static), failed (static)
    - Blocks Task 4's screen completion, same as the sound asset blocked `custom-notification-sound` — flag early
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 4. Matching-Progress Screen (`booking/confirmed.tsx` rewrite)
  - [x] 4.1 Implement the three-state UI (searching / matched-redirect / failed-retry)
    - Initial REST fetch on mount (race: matching may already have resolved) + subscribe via Task 2's hook
    - Matched: redirect to `/tracking/:deliveryId` on the existing `'driver-assigned'` event — confirmed no backend change was needed for this transition
    - Failed: show failed illustration + message + "Try Again" (Task 6)
    - Illustrations use plain Ionicons/Animated placeholders, clearly commented, pending Task 3's real assets
    - Added a "Cancel" action on the searching state (calls the existing cancel endpoint, same pattern as `booking/routing-pending.tsx`) — not explicitly in the written requirements but the only other "waiting on backend" screen in the app has one, and leaving searching with zero way out seemed like a regression versus the old static screen. Deliberately **not** added to the failed state — `booking-payment.ts`'s `REFUND_RATES` has no entry for `routing_failed`, so cancelling from there would currently refund $0 of a fully-escrowed delivery; flagging as a separate follow-up rather than silently fixing or shipping a cancel button that triggers it.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Matching-Worker Failure Publish
  - [x] 5.1 Add `realtime.publish(..., 'matching-failed', ...)` to the exhausted-retries branch in `workers/matching-worker/src/index.ts`
    - Reuse the existing `createAblyProvider()` ad-hoc pattern already used in this worker
    - _Requirements: 5.1, 5.2_
  - [x] 5.2 Test the publish call happens in that branch
    - Mirror the mocking approach used for `delivery-legs-status.test.ts` this session
    - _Requirements: 5.1_

- [x] 6. Retry-Matching Endpoint
  - [x] 6.1 Implement `POST /api/v1/deliveries/:id/retry-matching`
    - Verify ownership + `routing_failed` status; reject otherwise
    - Reset status to `pending`, remove any existing job under the same deterministic `jobId` (duplicate-ID add is otherwise rejected — hit this exact error manually this session), enqueue a fresh `match-driver` job
    - Factored the job-construction logic shared with `booking-payment.ts`'s initial trigger and `trigger-next-leg.ts`'s sequential trigger into `apps/api/src/lib/enqueue-match-driver.ts` — both existing call sites refactored to use it instead of writing a third copy of the same `matchDriverJobDataSchema.parse(...)` block
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 6.2 Tests
    - Rejects non-owners, rejects non-`routing_failed` deliveries, enqueues correctly on the happy path, handles the duplicate-job-id case
    - _Requirements: 4.2, 4.3, 4.4_

- [ ] 7. Phase 1 Manual Verification
  - [ ] 7.1 End-to-end: book a delivery, watch the searching state, confirm redirect on match (real or via the actor-simulator's bots — `.kiro/specs/actor-simulator/`)
  - [ ] 7.2 End-to-end: force a `routing_failed` (e.g. no eligible bot in range, as happened naturally this session), confirm the failed state + working Try Again
    - _Requirements: all of Phase 1_

### Phase 2: Tracking Screen Realtime + Status Enum Fix

- [x] 8. `delivery-legs.ts` Status Publish
  - [x] 8.1 Publish `EVENTS.statusUpdate` on `CHANNELS.deliveryTracking(deliveryId)` after a successful leg status update
    - Include new leg status and, if changed, delivery-level status
    - Extended `StatusUpdatePayload` (`packages/shared/src/types.ts`) with optional `legId`/`legStatus`, keeping `previousStatus`/`newStatus` delivery-level for backward compatibility with `apps/admin`'s already-built (but never-yet-fed-real-data) `useDeliveryRealtime` consumer of this same event
    - _Requirements: 7.1, 7.2_
  - [x] 8.2 Test the publish call
    - _Requirements: 7.1_

- [x] 9. Status Enum Fix
  - [x] 9.1 Update `/tracking/[id].tsx`'s `Delivery['status']` type and `statusSteps`/`statusOrder` to the real backend enum
    - `status` now typed as `DeliveryStatus` from `@surewaka/shared` (single source of truth) instead of a locally redefined union
    - Terminal failure states (`cancelled`/`failed`/`returned`) no longer forced through the progression stepper — shown as a distinct banner instead, since none of them have a meaningful position in the accepted→delivered sequence
    - Also fixed the header status text's `.replace('_', ' ')` → `.replace(/_/g, ' ')` (non-global replace was directly relevant now that real statuses have multiple underscores, e.g. `en_route_pickup`)
    - _Requirements: 8.1, 8.2_

- [x] 10. Tracking Screen Realtime Rewrite
  - [x] 10.1 Replace the 30s poll with Task 2's hook subscribed to `EVENTS.statusUpdate`
    - Keep initial fetch, pull-to-refresh, and add a 60s resilience-fallback poll
    - Re-sync on app foreground
    - Local state updates directly from the pushed payload (`legStatus ?? newStatus`) rather than re-fetching per event
    - Re-exported `CHANNELS`/`EVENTS` from `@surewaka/mobile-shared`'s barrel so mobile apps consume realtime constants through the one shared package rather than adding a direct `@surewaka/realtime` dependency per app
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 11. Phase 2 Manual Verification
  - [x] 11.1 End-to-end: track a delivery through multiple leg status changes (via the actor-simulator), confirm the stepper updates live and correctly for real status values
    - Verified on a real device. Surfaced a real bug in the process: a `delivered` delivery's tracking screen, left mounted in the nav stack (expo-router's Stack doesn't unmount on navigate-past), kept its Ably connection alive and kept re-authenticating for a channel that would never receive another event — logged as Ably's generic "Auth.requestToken()... Request failed" with no deliveryId context on-device. Traced via API access/error logs cross-referenced against a live DB query (confirmed the visible delivery's ownership check was correct; the failing request was a stale background screen for a different/already-terminal delivery). Fixed: `useRealtimeChannel` now receives `deliveryId: null` once `delivery.status` is terminal, tearing down the subscription — mirrors `apps/admin`'s existing `useDeliveryRealtime` auto-unsubscribe behavior. Also added a `console.error` with the actual deliveryId in the hook's auth-failure path so this class of issue is traceable on-device next time without a server-log hunt.
    - _Requirements: all of Phase 2_
