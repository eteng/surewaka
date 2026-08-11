# Booking City Classification — Tasks

Bottom-up: shared classifier → API routes → mobile client → cleanup → tests.

- [x] 1. `packages/db/src/zone-classifier.ts` — `ClassifyResult` includes `city`
- [x] 2. `apps/api/src/routes/carrier-routes.ts` — accept `fromLat/fromLng/fromAddress/toLat/toLng/toAddress`; classify server-side; 422 `UNCLASSIFIED_LOCATION` on failure; include `meta.fromCity/toCity/sameCity`
- [x] 3. `apps/api/src/routes/deliveries.ts` (`surewaka_way` branch) — classify pickup/dropoff; use classified city for SAME_CITY, NO_PARKS_IN_CITY, and the stored `pickupCity`/`dropoffCity`; 422 `UNCLASSIFIED_LOCATION` on failure
- [x] 4. `apps/mobile-customer/app/booking/carriers.tsx` — drop `isIntercity` city-string guard; call `carrier-routes` with coordinates; derive "SureWaka picks best route" / "Registered Carriers" visibility from the response
- [x] 5. Delete `normalizeCity`/`CITY_NORMALIZATION_MAP` from `packages/mobile-shared/src/maps/locationiq.ts` and its export in `packages/mobile-shared/src/index.ts`
- [x] 6. `pickup.tsx`/`dropoff.tsx` — replace the 6 `normalizeCity(...)` call sites with the raw fallback chain directly
- [x] 7. Tests: `classifyZone` returns `city`; `carrier-routes.ts` classification + 422 path; `deliveries.ts` `surewaka_way` classification + 422 path
- [x] 8. Verification: typecheck (api, admin unaffected, mobile-customer if checkable), run affected test suites, confirm no leftover `normalizeCity`/`CITY_NORMALIZATION_MAP`/`fromCity`/`toCity` references
