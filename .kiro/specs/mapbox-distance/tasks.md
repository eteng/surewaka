# Mapbox Distance Integration — Tasks

Bottom-up order: shared lib → API routes → routing worker → tests.
Pick up from the first unchecked task.

---

## Layer 1 — Shared Library

- [x] 1. Create `packages/shared/src/lib/haversine.ts`: move the pure `haversineKm` function from `apps/api/src/lib/eta-calculator.ts` into this new file as a named export. Update `apps/api/src/lib/eta-calculator.ts` to re-export `haversineKm` from `@surewaka/shared` (preserves all existing imports). Export `haversineKm` from `packages/shared/src/index.ts`.

- [x] 2. Create `packages/shared/src/lib/mapbox-distance.ts`: implement `getRoadDistanceKm(fromLat, fromLng, toLat, toLng): Promise<number>` with LRU cache (Map-based, max 500 entries, 10-min TTL), coordinate rounding to 3 decimal places for cache keys, 3-second timeout via AbortController, rate-limit backoff (60s on 429), and haversine fallback. Export `_resetDistanceCache()` for test cleanup. Short-circuit and return 0 if coordinates are identical.

- [x] 3. Export `getRoadDistanceKm` from `packages/shared/src/index.ts`.

- [x] 4. Verify `packages/shared` compiles: `pnpm --filter @surewaka/shared exec tsc --noEmit`

---

## Layer 2 — Unit Tests

- [x] 5. Create `packages/shared/src/lib/__tests__/mapbox-distance.test.ts`: mock global `fetch` with `vi.fn()`. Test cases: successful response returns km; cache hit skips fetch; coordinate rounding increases cache hits; timeout falls back to haversine; 429 activates backoff; backoff expires after 60s; invalid response shape falls back; identical coordinates return 0 without fetch; `_resetDistanceCache()` clears state. Use `vi.useFakeTimers()` for backoff expiry tests.

- [x] 6. Create `packages/shared/src/lib/__tests__/haversine.test.ts`: basic sanity tests for the relocated function (Lagos coords → expected ~km range). Ensures the move didn't break anything.

---

## Layer 3 — API Route Migration

- [x] 7. Update `apps/api/src/routes/booking-quote.ts`: replace `haversineKm()` calls in the leg loop with `await getRoadDistanceKm()`. For legs processed in the for-loop, refactor to process distance calls in parallel with `Promise.all` where legs are independent. Import `getRoadDistanceKm` from `@surewaka/shared`.

- [x] 8. Update `apps/api/src/routes/deliveries.ts` (POST / — quoteLegs mapping): replace `haversineKm(dbLeg.pickupLat, dbLeg.pickupLng, dbLeg.dropoffLat, dbLeg.dropoffLng)` with `await getRoadDistanceKm(...)` for on-demand legs. Same change in the requote endpoint's leg loop.

- [x] 9. Verify API compiles: `pnpm --filter @surewaka/api exec tsc --noEmit`

---

## Layer 4 — Routing Worker Migration

- [x] 10. Update `workers/routing-worker/src/jobs/route-delivery.ts`: replace the three pricing-critical `haversineKm()` calls with `await getRoadDistanceKm()`:
    - `firstMileDistKm`: customer pickup → selected origin park
    - `lastMileDistKm`: selected destination park → customer dropoff
    - Transfer leg `transferDist`: previous dest park → next origin park
    
    Leave `firstMileMinutesPerPark` / `lastMileMinutesPerPark` (schedule heuristics) using the local `haversineKm` — those are non-pricing.

- [x] 11. Verify routing worker compiles: `pnpm --filter @surewaka/routing-worker exec tsc --noEmit` (or the equivalent build command for the worker)

---

## Layer 5 — Integration Verification

- [x] 12. Run existing test suites to confirm no regressions: `pnpm test` (all packages). Fix any tests that were asserting haversine distances in quote outputs — they'll now get mock-distance results since `fetch` should be mocked in the test environment.

- [x] 13. Manual smoke test (optional, if `MAPBOX_ACCESS_TOKEN` is available in dev): create a delivery via the API with Lagos pickup and Abuja dropoff, verify `quotes.distance_km` is significantly larger than haversine distance for the same coordinates.

---

## Layer 6 — Cleanup

- [x] 14. Remove the duplicate `haversineKm` function from `workers/routing-worker/src/jobs/route-delivery.ts` (it has its own local copy). Replace with import from `@surewaka/shared`. The local copy is only needed for the non-pricing `firstMileMinutesPerPark` calculation — import it once and use for both.

- [x] 15. Update `docs/issues/pricing-grilling-outcomes.md`: mark the "Replace haversine with Mapbox Directions API" task as complete.
