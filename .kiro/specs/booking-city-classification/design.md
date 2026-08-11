# Booking City Classification — Design

## `classifyZone` return shape

```ts
// packages/db/src/zone-classifier.ts
type ClassifyResult = { id: string; name: string; city: string } | null;
```

`matchZone()` already has `zone.city` in scope (loaded into `ZoneDef` from
the `zones` table) — just include it in the returned object. No new query,
no cache-shape change.

## `GET /api/v1/carrier-routes` contract change

Old: `?fromCity=lagos&toCity=abuja`
New: `?fromLat=6.52&fromLng=3.37&fromAddress=...&toLat=9.05&toLng=7.49&toAddress=...`

`fromAddress`/`toAddress` are the full display address text (what the client
already has from `pickup.address`/`dropoff.address`) — needed because
`classifyZone`'s phase-1 keyword match runs against address text, not just
coordinates; state-capital zones (Tier 3 in `seed-zones.ts`) have no
bounding box, so keyword match against the address is often the only signal
that resolves them. Passing lat/lng alone would fall through to a remote
LocationIQ reverse-geocode call on every search, which is slower and costs
API quota for no benefit when the client already has the address text.

Response gains `meta.fromCity`, `meta.toCity`, `meta.sameCity` — computed
once, server-side, and handed to the client instead of asking it to
re-derive "same city" from anything itself.

```ts
// classify both ends
const pickupZone = await classifyZone(fromAddress, fromLat, fromLng);
const dropoffZone = await classifyZone(toAddress, toLat, toLng);
if (!pickupZone || !dropoffZone) return 422 UNCLASSIFIED_LOCATION;

// existing park-matching logic, unchanged, just fed classified cities
const fromCity = pickupZone.city.toLowerCase();
const toCity = dropoffZone.city.toLowerCase();
```

## `surewaka_way` creation path

Same pattern, reusing the same two `classifyZone` calls' shape:

```ts
const pickupZone = await classifyZone(parsed.data.pickup.address, parsed.data.pickup.lat, parsed.data.pickup.lng);
const dropoffZone = await classifyZone(parsed.data.dropoff.address, parsed.data.dropoff.lat, parsed.data.dropoff.lng);
if (!pickupZone || !dropoffZone) {
  return c.json({ error: { code: 'UNCLASSIFIED_LOCATION', message: "We couldn't determine the service area for this location." } }, 422);
}
if (pickupZone.city === dropoffZone.city) return SAME_CITY;
// NO_PARKS_IN_CITY checks against pickupZone.city / dropoffZone.city
// deliveries.pickupCity / dropoffCity store pickupZone.city / dropoffZone.city — the
// canonical classified value, not parsed.data.pickup.city
```

`parsed.data.pickup.city`/`dropoff.city` (client-supplied, still required by
`locationSchema` — unchanged, other paths still use it as a label) are
simply not read by this branch anymore.

## Mobile client (`carriers.tsx`)

- Drop the `isIntercity` city-string comparison entirely.
- `loadRoutes()` guard becomes: both `pickup` and `dropoff` have
  `lat`/`lng`/`address` set (basic completeness check, not a city guess).
- New local state holds the response `meta` (`fromCity`/`toCity`/`sameCity`)
  instead of deriving anything from `pickup.city`/`dropoff.city`.
- "SureWaka picks best route" renders when `meta.sameCity === false` (and
  the request didn't come back `UNCLASSIFIED_LOCATION`).
- "Registered Carriers" section renders when `routes.length > 0`, as today
  — just no longer wrapped in the `isIntercity` guard, since that guard's
  job is now split correctly across the two conditions above.

## `normalizeCity` removal

`pickup.tsx`/`dropoff.tsx` call `normalizeCity(...)` at 6 call sites, all
feeding `selectedCity`, which flows into: (a) `setPickup`/`setDropoff` →
`locationSchema.city` (now unread by anything matching-critical), and (b)
`client.create()`/`client.upsertRecent()` for saved-address/recent-location
labels (always cosmetic, never matching-critical). Deleting the wrapper and
using the raw fallback chain (`address?.city ?? address?.town ?? address?.suburb ?? address?.county ?? ''`)
directly at each call site preserves current behavior for (b) exactly —
these fields were never guaranteed to be a canonical metro name even before
this spec (a saved address showing "Ikeja" was already possible whenever a
normalization entry was missing) — and stops (a) mattering at all.
