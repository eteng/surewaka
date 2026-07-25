# Mapbox Distance Integration — Requirements

## Context

SureWaka's fee engine charges ₦150/km (`perKmRateKobo: 15000`) for on-demand legs. Distance is
currently computed via `haversineKm()` — a straight-line approximation that underestimates actual
road distance by 2–3× in cities like Lagos (complex road networks, bridges, one-way systems).

A 5km haversine route that is actually 12km by road results in a ₦1,050 undercharge per leg.
At scale this erodes unit economics and underpays drivers.

This spec replaces haversine with Mapbox Directions API road distance for all **pricing-critical**
call sites. Non-pricing uses (ETA estimation, zone bounding-box checks, router transfer-time
heuristics) retain haversine — rough estimates are acceptable there.

Mapbox is already integrated for the admin delivery map; `MAPBOX_ACCESS_TOKEN` exists in the
environment. The Directions API costs $0.60/1,000 requests (100,000 free/month).

---

## User Stories

### REQ-1 — Shared road distance function

WHEN any service in the monorepo needs the actual road distance between two coordinates,  
THEN it calls a shared async function that returns the driving distance in km from Mapbox Directions API.

Acceptance criteria:
- Function signature: `getRoadDistanceKm(fromLat: number, fromLng: number, toLat: number, toLng: number): Promise<number>`
- Located in `packages/shared/src/lib/mapbox-distance.ts` (importable by API and routing-worker via `@surewaka/shared`)
- Uses Mapbox Directions API v5 driving profile: `GET /directions/v5/mapbox/driving/{lng1},{lat1};{lng2},{lat2}`
- Returns `routes[0].distance` converted from meters to km (rounded to 1 decimal)
- Named export — no default export

### REQ-2 — Fallback to haversine on failure

WHEN the Mapbox API call fails (network timeout, HTTP 429, 5xx, malformed response),  
THEN the function falls back to haversine straight-line distance,  
THEN a warning is logged with the failure reason (for ops visibility).

Acceptance criteria:
- Timeout: 3 seconds per request (AbortController)
- On HTTP 429 (rate limit): fall back immediately, set a process-level backoff flag for 60 seconds (subsequent calls skip Mapbox and use haversine directly during backoff)
- On HTTP 5xx or network error: fall back for that single call; next call tries Mapbox again
- On invalid response shape (no `routes` array, empty routes): fall back and log
- Haversine fallback uses the existing `haversineKm()` from `apps/api/src/lib/eta-calculator.ts` (re-exported from shared)
- Log format: `[mapbox-distance] Fallback to haversine: ${reason} (${fromLat},${fromLng} → ${toLat},${toLng})`

### REQ-3 — Coordinate-rounded caching

WHEN the same origin–destination pair is requested multiple times within the same process,  
THEN the cached result is returned without making a duplicate Mapbox API call.

Acceptance criteria:
- Cache key: coordinates rounded to 3 decimal places (~111m precision) — e.g., `"6.438,3.422→6.512,3.378"`
- In-memory LRU cache, max 500 entries, TTL 10 minutes
- Cache is per-process (no Redis dependency for this — simple Map-based)
- Same coordinate pair in reverse (A→B vs B→A) is cached separately (road distance is directional)

### REQ-4 — Speculative quote migration (booking-quote route)

WHEN a customer requests a speculative quote via `POST /api/v1/booking/quote`,  
THEN first-mile and last-mile leg distances are computed using real road distance (not haversine).

Acceptance criteria:
- `apps/api/src/routes/booking-quote.ts` replaces `haversineKm()` calls with `await getRoadDistanceKm()`
- For carrier comparison quotes: measures road distance from pickup to nearest carrier park (first-mile) and from nearest park to dropoff (last-mile)
- For standalone on-demand quotes: measures road distance from pickup to dropoff
- Total response time for the endpoint stays under 2 seconds (multiple parallel distance calls where possible)

### REQ-5 — Authoritative quote migration (deliveries route)

WHEN a delivery is created via `POST /api/v1/deliveries` with legs,  
THEN on-demand leg distances use real road distance for the authoritative quote.

Acceptance criteria:
- `apps/api/src/routes/deliveries.ts` replaces the `haversineKm()` call in the `quoteLegs` mapping with `await getRoadDistanceKm()`
- The `distanceKm` stored in `quotes.distance_km` reflects road distance (not haversine)
- Re-quote (`POST /deliveries/:id/requote`) also uses road distance

### REQ-6 — Routing worker migration

WHEN the routing worker computes first-mile, last-mile, and transfer leg prices,  
THEN distances use real road distance.

Acceptance criteria:
- `workers/routing-worker/src/jobs/route-delivery.ts` replaces its local `haversineKm()` calls for pricing-related distances with `await getRoadDistanceKm()`
- First-mile distance: customer pickup → selected origin park (road km)
- Last-mile distance: selected destination park → customer dropoff (road km)
- Transfer legs between parks: road distance between parks (road km)
- The `firstMileMinutesPerPark` and `lastMileMinutesPerPark` maps used by the router for schedule matching continue to use haversine (REQ-7)

### REQ-7 — Non-pricing haversine calls are preserved

WHEN haversine is used for non-pricing purposes (ETA estimation, zone classification, router schedule heuristics),  
THEN those call sites remain unchanged.

Acceptance criteria:
- `apps/api/src/lib/eta-calculator.ts` — unchanged (ETA is a rough estimate)
- `apps/api/src/lib/zone-classifier.ts` — unchanged (bounding box checks)
- `workers/routing-worker/src/lib/router.ts` `transferMinutes()` — unchanged (schedule matching heuristic)
- `workers/routing-worker/src/jobs/route-delivery.ts` `firstMileMinutesPerPark` / `lastMileMinutesPerPark` — unchanged (used by Dijkstra for timing, not pricing)

### REQ-8 — Cost and rate-limit guardrails

WHEN Mapbox usage approaches the free tier limit or rate limit,  
THEN the system degrades gracefully without failing requests.

Acceptance criteria:
- Rate limit awareness: on 429 response, activate 60-second backoff (all calls use haversine during backoff)
- No retry logic on Mapbox calls — a single attempt + fallback is sufficient (avoids stacking latency)
- Batch potential: for the booking-quote route which may need 2+ distances per request, calls are made with `Promise.all` (parallel, not sequential)
- Monitoring: log a daily summary of Mapbox call count + fallback count (for cost tracking) — or expose via the existing health/metrics pattern
