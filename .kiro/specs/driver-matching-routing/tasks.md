# Implementation Plan: Driver Matching & Routing

## Overview

Implement the real-time driver matching and routing system for SureWaka. The system finds the best available driver for delivery legs using Redis geospatial queries, scores and ranks candidates, offers jobs through a tiered broadcast, and handles acceptance atomically via Redis SET NX. Supports both on-demand single-leg and multi-leg surewaka_way deliveries with timed dispatch per ADR-010.

Implementation is ordered by dependency: data layer first (schema + location store), then reservation/scoring primitives, then the orchestrator that composes them, then the acceptance API route, and finally multi-leg triggers and safety nets.

## Tasks

- [x] 1. Set up data models and shared types
  - [x] 1.1 Create the `delivery_offers` table schema
    - Create `packages/db/src/schema/delivery-offers.ts` with the `deliveryOffers` table definition
    - Add the `delivery_offer_status` pgEnum to `packages/db/src/schema/enums.ts`
    - Include indexes on `delivery_id`, `driver_id`, and `status`
    - Add foreign keys to `deliveries` and `drivers` tables
    - Export from `packages/db/src/schema/index.ts`
    - _Requirements: 8.1, 7.3_

  - [x] 1.2 Add driver stats columns and active-delivery partial index
    - Add `acceptance_rate`, `completion_rate`, `total_offers_received`, `total_offers_accepted`, `total_deliveries_completed`, `last_job_completed_at` columns to `packages/db/src/schema/drivers.ts`
    - Add a Postgres unique partial index `idx_deliveries_active_driver` on `deliveries(driver_id)` for active statuses to prevent double-assignment
    - _Requirements: 4.1, 7.2_

  - [x] 1.3 Add shared types and Zod validators for matching
    - Add `MatchDriverJobData`, `MatchResult`, `DriverCandidate`, `ScoredDriver`, `ScoringWeights`, `NearbyDriver`, `DriverMeta` types to `packages/shared/src/types.ts`
    - Add Zod schemas for location update request, accept request, and job data validation in `packages/shared/src/validators.ts`
    - Add matching-related constants (tier config, NIL_UUID, business hours) to `packages/shared/src/constants.ts`
    - _Requirements: 16.4, 3.1, 3.2, 3.3_

  - [x] 1.4 Generate and apply database migration
    - Run `pnpm --filter @surewaka/db db:generate` to create migration SQL
    - Verify the generated SQL includes the new table, columns, and index
    - _Requirements: 1.1, 7.2, 8.1_

- [x] 2. Implement Location Store
  - [x] 2.1 Implement `updateDriverLocation` function
    - Create `packages/realtime/src/location-store.ts`
    - Implement `GEOADD` to `drivers:active` geo set and `HSET` to `driver:{id}:meta` hash
    - Store `lastSeen` (unix timestamp ms), `status`, `vehicleType`, `lat`, `lng` in the hash
    - Publish position to Ably `driver-location:{driverId}` channel
    - Conditionally persist to Postgres `driver_locations` audit table when driver has active delivery
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 2.2 Implement `findNearbyDrivers` function
    - Use `GEOSEARCH` with `BYRADIUS` and `ASC` sort on `drivers:active`
    - Fetch metadata via `HGETALL` for each result
    - Filter out stale drivers (lastSeen > 30s), non-available status, and vehicle type mismatch
    - Return results sorted by distance ascending
    - Ensure no mutations to Redis state (read-only operation)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Implement `removeDriver` and `getDriverMeta` functions
    - `removeDriver`: `ZREM` from geo set + `DEL` metadata hash
    - `getDriverMeta`: `HGETALL` on `driver:{id}:meta`, return null if not found
    - _Requirements: 1.3_

  - [x] 2.4 Write property tests for Location Store
    - **Property 1: Location Update Round-Trip** — after `updateDriverLocation`, geo set and meta hash return stored values
    - **Property 2: Driver Removal Cleanup** — after `removeDriver`, both lookups return null
    - **Property 3: Spatial Query Correctness** — all returned drivers within radius, sorted by distance ascending
    - **Property 4: Driver Filtering Invariants** — only available, non-stale, matching vehicle type drivers returned
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4**

- [x] 3. Implement Driver Reservation Layer
  - [x] 3.1 Implement `reserveDriver` with Lua script
    - Create `workers/routing-worker/src/lib/reservation.ts`
    - Implement the Lua script that atomically checks `driver:{id}:meta` status AND `driver:{id}:reserved` key, then sets reservation with TTL
    - Return `{ reserved: true }` or `{ reserved: false, reason }` based on script result
    - Default TTL of 60 seconds for auto-expiry of zombie reservations
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.2 Implement `claimDelivery` (SET NX) and release functions
    - Implement `claimDelivery` using `SET delivery:{id}:claim driverId NX EX 300`
    - Implement `releaseReservation` (single driver) and `releaseReservations` (batch)
    - _Requirements: 6.1, 5.5_

  - [x] 3.3 Write property tests for Reservation Layer
    - **Property 10: Reservation Guards** — driver not available or already reserved → `{ reserved: false }` with no state change
    - **Property 11: Single-Assignment Invariant** — concurrent claims on same delivery → exactly one succeeds
    - **Validates: Requirements 5.2, 5.3, 6.1, 6.3, 7.1**

- [x] 4. Implement Scoring Engine
  - [x] 4.1 Implement `scoreDrivers` pure function
    - Create `workers/routing-worker/src/lib/scoring.ts`
    - Implement the weighted composite formula: base 100, distance (−10/km), acceptance rate (+20×rate), completion rate (+15×rate), rating bonus (+10 if ≥4.5, −15 if <4.0), idle bonus (+10 if >30min, +5 additional if >60min), heading bonus (+8)
    - Floor all scores at 0 via `Math.max(0, score)`
    - Sort output descending by score
    - Accept optional `weights` parameter for admin-configurable overrides
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 14.3_

  - [x] 4.2 Write property tests for Scoring Engine
    - **Property 7: Score Computation Correctness** — valid inputs always produce score ≥ 0
    - **Property 8: Score Output Invariants** — output length equals input, sorted descending
    - **Property 9: Score Determinism** — identical inputs → identical output across invocations
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Matching Orchestrator
  - [x] 6.1 Implement the `handleMatchDriver` BullMQ job handler
    - Create `workers/routing-worker/src/jobs/match-driver.ts`
    - Implement the three-tier matching loop: Tier 1 (5km, top 5, 30s), Tier 2 (8km, next 10, 30s), Tier 3 (12km, all up to 50, 3min)
    - Compose Location Store, Reservation, and Scoring Engine
    - Enrich candidates with DB stats (acceptance_rate, completion_rate, rating, last_job_completed_at)
    - Track `offeredDriverIds` set to prevent re-offering across tiers
    - Enforce 5-minute absolute timeout
    - Check delivery status at tier boundaries (exit if cancelled)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 13.1_

  - [x] 6.2 Implement offer recording and notification dispatch
    - Insert `delivery_offers` rows in Postgres before sending push notifications
    - Send push notifications via Ably to each reserved driver
    - Expire offers and release reservations on tier timeout
    - Cancel delivery and trigger refund on total timeout (no match found)
    - _Requirements: 7.3, 8.1, 8.3, 3.6_

  - [x] 6.3 Implement the `waitForAcceptance` mechanism
    - Use BullMQ job event listener or polling pattern to detect when a delivery is claimed during the tier wait window
    - Return the winning driver ID if claimed, or null on timeout
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.4 Write property tests for Matching Orchestrator
    - **Property 5: Tier Configuration Invariants** — radii monotonically increase, total wait ≤ 5min
    - **Property 6: No Duplicate Offers Across Tiers** — offered driver sets are disjoint per tier
    - **Property 12: Offer State Transitions on Resolution** — accepted → others cancelled; timeout → offers expired
    - **Property 18: Reservation and State Cleanup on Resolution** — no orphaned reservations or pending offers
    - **Validates: Requirements 3.4, 3.5, 3.7, 5.5, 6.4, 6.5, 8.3, 8.4, 13.3**

- [x] 7. Implement Acceptance Handler (API Route)
  - [x] 7.1 Create the `POST /api/v1/deliveries/:deliveryId/accept` route
    - Create `apps/api/src/routes/delivery-accept.ts`
    - Add `requireAuth` middleware (Clerk JWT)
    - Validate authenticated user has driver role and owns the pending offer
    - Validate input with Zod schema (deliveryId UUID format)
    - Verify offer exists in `delivery_offers` with status 'pending' for this driver/delivery
    - _Requirements: 6.8, 16.1, 16.2_

  - [x] 7.2 Implement atomic claim and state updates
    - Call `claimDelivery` for Redis SET NX
    - On success: update `deliveries` with driver_id and status='accepted' (WHERE driver_id IS NULL safety)
    - On success: update winning offer to 'accepted' with respondedAt
    - On success: cancel all other pending offers for this delivery
    - On success: release all driver reservations for this delivery
    - On failure: return `{ matched: false }` with no state mutations
    - Handle idempotent duplicate requests (same driver, same delivery → `matched: false`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.2, 8.4_

  - [x] 7.3 Publish assignment events
    - Publish `driver-assigned` event via Ably to `delivery:{deliveryId}` channel
    - Send push notification to customer
    - _Requirements: 6.6_

  - [x] 7.4 Write unit tests for Acceptance Handler
    - Test successful claim path (first driver wins)
    - Test race loss path (second driver gets `matched: false`)
    - Test missing offer validation (reject driver without pending offer)
    - Test idempotent duplicate request handling
    - _Requirements: 6.1, 6.3, 6.7, 6.8_

- [x] 8. Implement Location Update API Route
  - [x] 8.1 Create the `POST /api/v1/driver/location` route
    - Create or update `apps/api/src/routes/driver-locations.ts`
    - Add `requireAuth` middleware with driver role check
    - Validate input with Zod (lng in [-180,180], lat in [-90,90], optional deliveryId UUID)
    - Rate-limit to 1 request per 2 seconds per driver
    - Call `updateDriverLocation` with validated data
    - _Requirements: 1.1, 1.2, 1.4, 16.1, 16.3, 16.4_

  - [x] 8.2 Write unit tests for location update route
    - Test valid update stores position and publishes to Ably
    - Test rate limiting (reject if <2s since last update)
    - Test input validation (invalid coordinates rejected)
    - _Requirements: 1.1, 16.3, 16.4_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Multi-Leg Timed Dispatch
  - [x] 10.1 Implement first-mile delayed job scheduling
    - Add `scheduleFirstMileMatching` function to `workers/routing-worker/src/jobs/compute-route.ts`
    - Read buffer from `system_config` via `getConfig('matching.first_mile_dispatch_buffer_min')` (default: 45)
    - Compute delay as `max(carrierDeparture - legETA - buffer, now)` per ADR-010
    - Use deterministic jobId `match-leg:{legId}` to prevent duplicate enqueue
    - Configure 3 attempts with exponential backoff from 5s
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 10.2 Implement event-driven trigger for transfer and last-mile legs
    - Add `triggerNextLegMatching` function to the leg completion handler in `apps/api/src/routes/delivery-legs.ts`
    - For transfer: compute delay as `max(nextCarrierDeparture - legETA - buffer, now)`
    - For last-mile: compute delay as `max(nextBusinessHourStart, customerWindow - legETA - buffer, now)`
    - Implement `getNextBusinessHourStart` helper respecting 7am–9pm window
    - Ensure triggering only after preceding leg is marked 'delivered'
    - Use deterministic jobId `match-leg:{legId}` for deduplication
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 10.3 Write property tests for timed dispatch
    - **Property 13: Timed Dispatch Formula Correctness** — delay equals `max(deadline - legETA - buffer - now, 0)`, last-mile clamped to business hours
    - **Property 14: Deterministic Job ID** — jobId always `match-leg:{legId}` format
    - **Property 15: Leg Sequentiality** — matching never triggered until preceding legs complete
    - **Validates: Requirements 9.1, 9.3, 9.4, 10.2, 10.3, 10.4, 10.6, 11.4**

- [x] 11. Implement Cron Sweeper Safety Net
  - [x] 11.1 Implement `rescueMissedMatching` cron job
    - Create `workers/cron/src/jobs/rescue-missed-matching.ts`
    - Run every 5 minutes, scan for driver-type legs with `actorId = NIL_UUID`, status 'pending', `systemEtaAt - buffer <= now`
    - Check if BullMQ job already exists via `matchingQueue.getJob(jobId)` before enqueuing
    - Enqueue with `delayMs = 0` and deterministic jobId `match-leg:{legId}`
    - Limit to 20 legs per run (batch limit)
    - Read buffer from `system_config` via `getConfig()`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 11.2 Write property test for Cron Sweeper
    - **Property 16: Cron Sweeper Query Correctness** — returns exactly legs matching all filter conditions
    - **Validates: Requirement 11.1**

- [x] 12. Implement Self-Drop Fallback
  - [x] 12.1 Implement self-drop-off offer and acceptance flow
    - When first-mile matching fails: send push notification to customer with park name and cancellation deadline
    - On customer accept: cancel first-mile leg (`status = 'cancelled'`, `isActive = false`), refund first-mile quote
    - On customer accept: keep remaining legs active and proceeding normally
    - On customer decline or 15-minute timeout: cancel entire delivery with full refund and notify ops
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 12.2 Write property test for self-drop
    - **Property 17: Self-Drop Preserves Remaining Legs** — after self-drop acceptance, subsequent legs remain active with unchanged status
    - **Validates: Requirement 12.3**

- [x] 13. Implement Cancellation Handling
  - [x] 13.1 Implement cancellation cleanup logic
    - Check delivery status at each tier boundary in the matching orchestrator, exit immediately if cancelled
    - Implement `cancelScheduledMatching` to remove delayed BullMQ jobs before they fire
    - Release all driver reservations and expire all pending offers on cancellation exit
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 14. Implement Admin-Configurable Parameters
  - [x] 14.1 Wire `getConfig()` for matching parameters
    - Ensure `matching.first_mile_dispatch_buffer_min` is read from `system_config` with 5-min TTL cache
    - Wire configurable scoring weights that can be overridden from defaults
    - Verify changes reflect within 5 minutes without code deployment
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 15. Implement Error Recovery and Resilience
  - [x] 15.1 Configure BullMQ retry and stalled job settings
    - Configure matching jobs with 3 attempts and exponential backoff from 5s
    - Set stalled job detection interval to 60s
    - On all retries exhausted: mark delivery as 'routing_failed' and notify customer
    - Ensure stalled job re-runs start fresh from GEOSEARCH (reservations auto-expire via TTL)
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 15.2 Write unit tests for error recovery
    - Test retry exhaustion marks delivery as 'routing_failed'
    - Test stalled job re-run starts fresh (no stale reservation dependencies)
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 16. Implement Input Validation and Security
  - [x] 16.1 Add Zod validation and rate limiting
    - Validate all input coordinates (lng [-180,180], lat [-90,90]), UUIDs, and enum values via Zod schemas
    - Implement rate limiting on location updates (1 req/2s per driver)
    - Ensure all routes have `requireAuth` middleware and role checks
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 16.2 Write property test for input validation
    - **Property 19: Input Validation Rejection** — invalid coordinates, UUIDs, or enums are rejected before processing
    - **Validates: Requirement 16.4**

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementation follows existing project conventions (Hono API, Drizzle ORM, BullMQ workers, Ably realtime)
- Redis is already available via Docker (dev) and Fly Upstash (prod) — no new infrastructure needed
- The `system_config` table and `getConfig()` utility are assumed to exist per the design references

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "3.1"] },
    { "id": 4, "tasks": ["3.2", "4.1"] },
    { "id": 5, "tasks": ["3.3", "4.2"] },
    { "id": 6, "tasks": ["6.1", "8.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "8.2"] },
    { "id": 8, "tasks": ["6.4", "7.1"] },
    { "id": 9, "tasks": ["7.2", "7.3"] },
    { "id": 10, "tasks": ["7.4", "10.1"] },
    { "id": 11, "tasks": ["10.2", "11.1"] },
    { "id": 12, "tasks": ["10.3", "11.2", "12.1"] },
    { "id": 13, "tasks": ["12.2", "13.1"] },
    { "id": 14, "tasks": ["14.1", "15.1"] },
    { "id": 15, "tasks": ["15.2", "16.1"] },
    { "id": 16, "tasks": ["16.2"] }
  ]
}
```
