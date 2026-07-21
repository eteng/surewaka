# Routing Worker — Tasks

Bottom-up order: schema → shared types → API → worker → mobile.
Pick up from the first unchecked task.

---

## Layer 0 — Prerequisite: move zone classifier to packages/db

- [x] 0. Move `apps/api/src/lib/zone-classifier.ts` → `packages/db/src/zone-classifier.ts` (no logic changes); export `classifyZone` and `invalidateZoneCache` from `packages/db/src/index.ts`; update `apps/api/src/lib/zone-classifier.ts` to re-export from `@surewaka/db` (or update all import sites directly); move the property test file to `packages/db/src/__tests__/zone-classifier.property.test.ts`; verify API still compiles and zone tests pass

## Layer 1 — Schema

- [ ] 1. Add `pending_routing` and `routing_failed` to `deliveryStatus` enum in `packages/db/src/schema/enums.ts`; add `transfer` to the `legType` check constraint in `packages/db/src/schema/delivery-legs.ts` (`first_mile | intercity | transfer | last_mile`); add `isActive boolean NOT NULL DEFAULT true` column to `delivery_legs` with an index on `(delivery_id) WHERE is_active = true`
- [ ] 2. Add `deliveryMode` text column (check: `on_demand | carrier_direct | surewaka_way`, nullable) and `cancellationDeadlineAt` timestamptz (nullable) to `packages/db/src/schema/deliveries.ts`
- [ ] 3. Create `packages/db/src/schema/carrier-parks.ts`: `id`, `carrier_id` (FK → carriers, cascade delete), `city` (text slug), `name`, `address`, `lat` (real), `lng` (real), `is_active`, `created_at`, `updated_at`; unique on `(carrier_id, name)` — NOT `(carrier_id, city)` because a carrier may operate multiple parks in one city; index on `city` where `is_active = true`
- [ ] 4. Create `packages/db/src/schema/carrier-routes.ts`: `id`, `carrier_id` (FK → carriers, cascade delete), `origin_park_id` (FK → carrier_parks, restrict), `destination_park_id` (FK → carrier_parks, restrict), `base_price_kobo`, `estimated_transit_hrs`, `max_weight_kg`, `is_active`, `created_at`, `updated_at`; unique on `(carrier_id, origin_park_id, destination_park_id)`; check `origin_park_id ≠ destination_park_id`; partial index on `(origin_park_id, destination_park_id)` where `is_active = true`
- [ ] 5. Create `packages/db/src/schema/carrier-route-schedules.ts`: `id`, `carrier_route_id` (FK → carrier_routes, cascade delete), `hour` (smallint, 0–23, WAT), `minute` (smallint, 0–59, default 0), `days_of_week` (smallint[], ISO 1–7, empty = every day), `is_active`, `created_at`; index on `(carrier_route_id)` where `is_active = true`; check constraints on hour and minute ranges
- [ ] 6. Export `carrierParks`, `carrierRoutes`, `carrierRouteSchedules` from `packages/db/src/schema/index.ts`
- [ ] 7. Generate migration: `pnpm --filter @surewaka/db db:generate`
- [ ] 8. Apply migration: `pnpm --filter @surewaka/db db:migrate`
- [ ] 9. Seed parks + routes + schedules: GIG parks (Lagos Jibowu, Abuja Utako, PH Rumuola) with real addresses and coordinates; `city` values must exactly match `zones.city` slugs already seeded by the dynamic-zones spec (e.g. `"lagos"` not `"Lagos"`); routes Lagos↔Abuja, Lagos↔PH; schedules e.g. GIG Lagos→Abuja 6AM + 2PM daily

---

## Layer 2 — Shared Types & Validators

- [ ] 10. Add `DeliveryMode` type (`'on_demand' | 'carrier_direct' | 'surewaka_way'`) to `packages/shared/src/types.ts`
- [ ] 11. Add `CarrierPark`, `CarrierRoute`, `DepartureSlot`, `CarrierRouteSchedule` types to `packages/shared/src/types.ts`
- [ ] 12. Add `createCarrierParkSchema`, `updateCarrierParkSchema`, `createCarrierRouteSchema`, `updateCarrierRouteSchema`, `createCarrierRouteScheduleSchema` Zod validators to `packages/shared/src/validators.ts`; `DepartureSlot` schema: `hour` (0–23), `minute` (0–59), `daysOfWeek` (array of 1–7)
- [ ] 13. Update `createDeliverySchema` in `packages/shared/src/validators.ts` to accept optional `mode: z.enum(['on_demand', 'carrier_direct', 'surewaka_way']).optional()`

---

## Layer 3 — Routing Engine (pure)

- [ ] 14. Create `workers/routing-worker/src/lib/schedule.ts`:
    - `nextDeparture(slots: DepartureSlot[], notBefore: Date): Date | null` — pure, returns next departure in WAT on or after `notBefore`; handles day-of-week filter; wraps to next day if no slot today is later than `notBefore`; returns null if slots is empty
- [ ] 15. Create `workers/routing-worker/src/lib/router.ts`:
    - `buildGraph(routes: RouteEdge[]): Map<string, RouteEdge[]>` — graph nodes = park IDs
    - `findCheapestRoute(graph, originParks, destParks, bookingTime, firstMileMinutes, lastMileMinutes, maxHops): RoutePath | null` — direct routes (1 intercity hop) always preferred over multi-hop; multi-hop only evaluated when no direct route exists; for each edge explored: compute transfer time from previous hop's destPark to this edge's originPark (haversine / 20 km/h, 0 for first hop), add to `arrivalAtPark`, call `nextDeparture`, skip if null; store `transferMinutesBefore` on `ResolvedHop`; propagate `arrivalAtDest` to next hop; tie-break: fewest hops → earliest `estimatedDeliveryAt`; routes with no active schedule rows excluded
- [ ] 16. Write unit tests for `nextDeparture`:
    - Slot later today → returns today's datetime
    - Slot earlier today → returns tomorrow's datetime
    - Day-of-week filter excludes today → advances to next matching day
    - Empty slots → null
- [ ] 17. Write unit tests for `findCheapestRoute`:
    - Direct route exists → always chosen over cheaper multi-hop (direct preference rule)
    - No direct route → multi-hop path returned
    - Booking before departure → correct next departure and arrival
    - Booking after last departure of the day → waits to next day's first slot
    - 2-hop path: transfer time between intermediate parks delays `arrivalAtPark` for second carrier; engine correctly skips missed departure slots
    - 2-hop path produces first_mile + intercity + transfer + intercity + last_mile leg sequence
    - Multiple parks in origin city — engine picks cheapest intercity path regardless of origin park
    - Multiple parks in destination city — engine picks cheapest path to any dest park
    - Route with no active schedule → excluded from graph
    - No route within maxHops → null
    - Tie-break: same cost, fewer hops → earlier ETA wins

---

## Layer 4 — Routing Worker Scaffold

- [ ] 18. Scaffold `workers/routing-worker/` with `package.json` (name: `@surewaka/worker-routing`), `tsconfig.json`, mirroring `workers/payment-worker/` structure
- [ ] 19. Create `workers/routing-worker/src/queue.ts` — exports `routingQueue` (BullMQ Queue `'routing'`), `RouteDeliveryJobData` type (includes `vehicleType`, `bookingTime` ISO string), shared Redis connection
- [ ] 20. Create `workers/routing-worker/src/jobs/route-delivery.ts` — `handleRouteDelivery(job)`:
    - Idempotency: load delivery status; if already `draft` or `routing_failed` return immediately
    - Staleness: if `now - bookingTime > 2h` → auto-re-route: reset delivery → `pending_routing`, re-enqueue fresh `route-delivery` job with `bookingTime = now`, enqueue push "We're finding your route, this may take a moment", return (no throw — new job owns outcome)
    - JOIN-load active `carrier_routes` with both parks + all active `carrier_route_schedules` → `RouteEdge[]` (schedule slots embedded per edge)
    - Load active parks by `pickupCity` and `dropoffCity`
    - Load `fee_settings` + `vehicle_type_rates`
    - Estimate `firstMileMinutes` and `lastMileMinutes` via haversine distance / 20 km/h
    - `findCheapestRoute(graph, originParks, destParks, bookingTime, firstMileMinutes, lastMileMinutes, 3)`
    - On null: update delivery → `routing_failed`, publish Ably `routing_failed`, return (no throw)
    - Build leg plan from `ResolvedHop[]`: first_mile → [intercity, transfer?]* → last_mile; insert one `transfer` leg (driver, NIL_UUID) between each consecutive intercity pair using `hop[i-1].destPark → hop[i].originPark` coordinates; set `systemEtaAt` per leg from resolved hop timestamps
    - For first_mile, transfer, and last_mile legs: call the zone classifier (from dynamic-zones spec) with leg pickup/dropoff coordinates to populate `pickupZoneId` and `dropoffZoneId` FKs; leave null if classifier returns null
    - `db.transaction(tx => { insert delivery_legs with systemEtaAt per leg; createAuthoritativeQuotesForDelivery(tx,..., expiresAt: cancellationDeadlineAt); update delivery → draft + priceKobo + systemEtaAt + cancellationDeadlineAt = hop[0].nextDeparture - 60min })`
    - Publish Ably `routed` — payload: composite quote + per-hop `{ carrierName, originParkName, destParkName, nextDepartureAt, arrivalAt }` + top-level `estimatedDeliveryAt`
    - Enqueue push notification (`routing-complete` type) via existing push-worker queue — "Your route is ready, tap to confirm"
    - On any `routing_failed` path: after Ably publish, also enqueue push notification (`routing-failed` type) — "We couldn't find a route, tap to pick a carrier manually"
- [ ] 21. Create `workers/routing-worker/src/index.ts` — BullMQ Worker on `'routing'` queue, `concurrency: 3`, retries: 3, exponential backoff, dead-letter on exhaustion
- [ ] 22. Add `workers/routing-worker` to turborepo workspace in `pnpm-workspace.yaml` and `turbo.json`

---

## Layer 5 — API: Admin carrier park + route + schedule endpoints

- [ ] 23. Create `apps/api/src/routes/admin/carrier-parks.ts` (surewaka_admin only):
    - `POST /` — create park
    - `PATCH /:id` — update address / coordinates / active flag
    - `GET /` — list (optional `?carrierId=` filter)
- [ ] 24. Create `apps/api/src/routes/admin/carrier-routes.ts` (surewaka_admin only):
    - `POST /` — create route
    - `PATCH /:id` — update price / transit hours / active flag
    - `GET /` — list (optional `?carrierId=` filter); join parks + schedule counts
    - `DELETE /:id` — soft-delete
    - `GET /:id/schedules` — list departure slots for a route
    - `POST /:id/schedules` — add a departure slot (hour, minute, daysOfWeek)
    - `PATCH /schedules/:scheduleId` — update or deactivate a slot
- [ ] 25. Mount routers under `/api/v1/admin/carrier-parks` and `/api/v1/admin/carrier-routes` in `apps/api/src/index.ts`

---

## Layer 6 — API: Public carrier route endpoint

- [ ] 26. Create `GET /api/v1/carrier-routes` handler (in `apps/api/src/routes/carrier-routes.ts`) — accepts `?fromCity=&toCity=`; joins parks + active schedule slots; computes `nextDepartureAt` server-side using `nextDeparture()` pure function; returns full response shape per design; `requireAuth` only
- [ ] 27. Mount under `/api/v1/carrier-routes` in `apps/api/src/index.ts`

---

## Layer 6a — Cancellation fee enforcement

- [ ] 26a. Update `POST /deliveries/:id/cancel` in `apps/api/src/routes/booking-payment.ts`:
    - Remove `draft` from `NON_CANCELLABLE` for `surewaka_way` deliveries: if `locked.status === 'draft'` and `locked.deliveryMode !== 'surewaka_way'` → still non-cancellable; if `surewaka_way` draft → free cancel, 0 refund (no escrow)
    - Before the `REFUND_RATES` lookup for `pending` status: check `locked.cancellationDeadlineAt`
    - If `cancellationDeadlineAt` set and `now >= cancellationDeadlineAt`: load first active `intercity` leg quote via `delivery_legs` + `quotes` join → `feeKobo`; `refundAmount = max(0, amountPaid - feeKobo)`; write `commission` ledger event for `feeKobo` to platform; write `refund` ledger event for `refundAmount` to customer wallet; skip `REFUND_RATES`
    - If `cancellationDeadlineAt` set and `now < cancellationDeadlineAt`: full refund (rate 1.0)
    - If no `cancellationDeadlineAt`: existing `REFUND_RATES` logic unchanged

## Layer 6b — Quote service: expiresAt override + re-route on confirm

- [ ] 26b. Add optional `expiresAt?: Date` parameter to `createAuthoritativeQuotesForDelivery` in `apps/api/src/services/quote-service.ts`; defaults to `now + 15 min` when omitted (existing behaviour unchanged)
- [ ] 26c. Update `POST /api/v1/booking/confirm` in `apps/api/src/routes/booking-payment.ts` to handle `QUOTE_EXPIRED` on `surewaka_way` deliveries: catch the error, run a transaction to supersede quotes + delete legs + reset delivery to `pending_routing`, re-enqueue routing job, return 409 `{ code: 'QUOTE_EXPIRED', reroutingStarted: true }`; for non-surewaka_way deliveries keep existing 409 behaviour

## Layer 7 — API: routing queue client + POST /deliveries update

- [ ] 28. Create `apps/api/src/lib/routing-queue.ts` — thin BullMQ Queue wrapper, exports `enqueueRouteDelivery(data: RouteDeliveryJobData)`; `bookingTime` = `new Date().toISOString()` stamped at enqueue time so the worker uses the correct "now" regardless of queue lag
- [ ] 29. Normalise `pickup.city` and `dropoff.city` to `.trim().toLowerCase()` in `POST /deliveries` before storing — applies to all delivery modes, not just `surewaka_way`; matches the zone spec's city slug convention
- [ ] 30. Update `POST /deliveries` handler in `apps/api/src/routes/deliveries.ts`:
    - Parse optional `mode` from request body
    - Add branch for `mode === 'surewaka_way'`:
      - Validate pickup_city ≠ dropoff_city → 422 `SAME_CITY`
      - Validate active park exists for pickup_city → 422 `NO_PARKS_IN_CITY`
      - Validate active park exists for dropoff_city → 422 `NO_PARKS_IN_CITY`
      - Insert delivery with `status: 'pending_routing'` + `deliveryMode: 'surewaka_way'`
      - Call `enqueueRouteDelivery` with `bookingTime: new Date().toISOString()`
      - Return 202
    - Default `mode` to `on_demand` for legacy requests (no `mode` field) — existing path unchanged
    - Default `mode` to `carrier_direct` for requests with explicit `legs` containing an intercity leg

---

## Layer 6c — Extend GET /deliveries/:id with quote data

- [ ] 26d. Extend `GET /api/v1/deliveries/:id` in `apps/api/src/routes/deliveries.ts` to include active quote when delivery is `draft` and `deliveryMode = 'surewaka_way'`: join `delivery_legs` + `quotes` (active, non-expired) and append `quote: { legs, compositeTotalKobo, expiresAt, estimatedDeliveryAt }` to the response — matches the shape returned by the synchronous 201 path so the confirm screen can use it identically regardless of how it arrived

## Layer 7b — Push notification types

- [ ] 29b. Add `routing-complete` and `routing-failed` to the push notification type registry in `workers/push-worker/src/push-triggers.ts`; payloads include `deliveryId` for deep-linking

## Layer 8 — Mobile

- [ ] 30. Update `apps/mobile-customer/app/booking/carriers.tsx`:
    - Fetch `GET /api/v1/carrier-routes?fromCity=&toCity=` on mount
    - Per carrier card: show origin park name, destination park name, next departure time ("Today 2:00 PM"), estimated arrival ("Arrives ~Wed 6 PM"), and price
    - Use returned routes to drive `POST /api/v1/booking/quote` calls
    - Add "SureWaka picks best route" option that sets `mode: 'surewaka_way'` in the booking store
- [ ] 31. Update `apps/mobile-customer/app/booking/review.tsx` `buildLegs()`:
    - If `mode === 'surewaka_way'`: send `{ mode: 'surewaka_way' }` in `POST /deliveries` body (no legs)
    - Handle 202 response: navigate to `booking/routing-pending` instead of `booking/confirm`
- [ ] 32. Create `apps/mobile-customer/app/booking/routing-pending.tsx`:
    - Show spinner + "Finding best route" copy
    - Subscribe to Ably `delivery:{deliveryId}` channel on mount
    - On `routed` event: navigate to `booking/confirm` passing composite quote + `estimatedDeliveryAt`
    - On `routing_failed` event: show error modal with "Choose a carrier manually" CTA → `booking/carriers`
    - On cancel: navigate back
- [ ] 33. Update `apps/mobile-customer/app/booking/confirm.tsx` (or review screen) to display `estimatedDeliveryAt` when present — "Estimated delivery: Wed 20 Aug, ~6:00 PM"
- [ ] 34. Register `routing-pending` in `apps/mobile-customer/app/_layout.tsx` or the booking stack navigator
