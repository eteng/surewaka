# Booking City Classification — Requirements

## Why

The `surewaka_way` booking path (`deliveries.ts`) and the carrier-route
search (`carrier-routes.ts`) both decide "does this pickup/dropoff have
carrier coverage" and "are these different cities" by exact-string-matching
a client-supplied `city` field against `carrier_parks.city`. That client
string comes from LocationIQ's free-text `address.city` field, which is
inconsistent for Nigerian locations (e.g. returns "Ikeja" — an LGA — instead
of "Lagos" for a Lagos address). The current fix is a hand-maintained
`CITY_NORMALIZATION_MAP` in `packages/mobile-shared/src/maps/locationiq.ts`
mapping known LGA variants to canonical city names.

Et: "I did not want to use the city normalization as it would fail in the
future" — the map only covers 4 cities' variants today and requires manual
upkeep for every new city/LGA Nigeria-wide as coverage expands. It's also a
second, disconnected source of truth from the `zones` table
([[dynamic-zones]] spec), which already solves "which curated place is this
coordinate in" via bounding-box + keyword classification, is seeded for 34
cities, and gets maintained as part of normal zone upkeep anyway.

## Decision

Replace client-trusted city strings with server-side classification via the
existing `classifyZone()` (from `dynamic-zones`) for every place this app
actually *matches* on city (carrier-route search, `surewaka_way` validation).
Cosmetic-only uses of city (saved-address labels, recent-location labels)
are unaffected in behavior but lose the normalization map, since it no
longer has a reason to exist once nothing depends on its correctness.

## Requirement 1 — `classifyZone` exposes the zone's city

1. WHEN `classifyZone` finds a matching zone THEN it SHALL return that
   zone's `city` alongside the existing `id`/`name`, so callers don't need a
   second lookup.

## Requirement 2 — Carrier route search is classification-driven

1. WHEN a client requests `GET /api/v1/carrier-routes` THEN it SHALL supply
   `fromLat`/`fromLng`/`fromAddress` and `toLat`/`toLng`/`toAddress` instead
   of `fromCity`/`toCity`.
2. WHEN either coordinate pair fails to classify into a zone THEN the
   endpoint SHALL return `422 UNCLASSIFIED_LOCATION` rather than silently
   returning an empty route list (which looks identical to "no coverage
   here" but means something different: "we don't know where this is").
3. WHEN both classify successfully THEN the endpoint SHALL match carrier
   parks by the classified `city` values (not client-supplied strings) and
   SHALL include the classified `fromCity`/`toCity` and a `sameCity` flag in
   the response `meta`, so the client can drive UI decisions (show/hide the
   "SureWaka picks best route" option) without reimplementing
   classification.

## Requirement 3 — `surewaka_way` booking creation is classification-driven

1. WHEN a customer creates a `surewaka_way` delivery THEN the server SHALL
   classify `pickup` and `dropoff` via `classifyZone` (using each location's
   `address` text and `lat`/`lng`) and use the classified `city` — not the
   client-supplied `pickup.city`/`dropoff.city` — for the same-city check,
   the "does this city have an active carrier park" check, and the
   `pickupCity`/`dropoffCity` values stored on the `deliveries` row.
2. WHEN either location fails to classify THEN the endpoint SHALL return
   `422 UNCLASSIFIED_LOCATION` with a message the UI can show directly
   ("We couldn't determine the service area for this location").
3. Other delivery-creation paths in this file (`on_demand`/`carrier_direct`
   with explicit legs, and the legacy no-legs draft path) do not perform any
   city-based matching today and are unchanged by this spec — they store
   the client-supplied city as a label only, which was never the broken
   behavior.

## Requirement 4 — Mobile client stops gating on client-side city strings

1. WHEN the customer has picked both a pickup and dropoff location THEN the
   carriers screen SHALL always query `carrier-routes` (using coordinates,
   not a client-side same-city guess) rather than skipping the request based
   on `pickup.city !== dropoff.city` string comparison.
2. WHEN the `carrier-routes` response's `sameCity` flag is true, or the
   request itself comes back `UNCLASSIFIED_LOCATION`, THEN the "SureWaka
   picks best route" option SHALL be hidden.
3. WHEN the response's route list is non-empty THEN the "Registered
   Carriers" section SHALL render those routes; otherwise it SHALL be
   hidden — this was already the intent, now driven by real data instead of
   a client-side guess.

## Requirement 5 — Retire the normalization map

1. `normalizeCity()` and `CITY_NORMALIZATION_MAP`
   (`packages/mobile-shared/src/maps/locationiq.ts`) SHALL be deleted —
   nothing depends on their correctness after Requirements 2–4 ship.
2. `pickup.tsx`/`dropoff.tsx`'s saved-address and recent-location `city`
   labels SHALL use the raw geocoded city text directly (no normalization
   wrapper) — these were always cosmetic and unaffected by the matching bug;
   removing the wrapper doesn't change their correctness, just removes the
   now-pointless indirection.

## Out of scope

- Re-deriving `pickupCity`/`dropoffCity` for the non-`surewaka_way`
  creation paths (Requirement 3.3) — those never matched on city, so
  there's no equivalent bug to fix there.
- Backfilling `pickupCity`/`dropoffCity` on existing `deliveries` rows.
- `carrier_parks` city coverage itself (still only Lagos/Abuja/Port
  Harcourt seeded) — a data gap, not this spec's concern.
