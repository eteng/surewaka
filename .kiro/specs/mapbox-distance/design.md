# Mapbox Distance Integration — Design

## Overview

A shared async distance function replaces `haversineKm()` at pricing-critical call sites.
The function calls Mapbox Directions API, caches results in an LRU map, and falls back to
haversine on any failure.

```
┌─────────────────────────────────────────────────────────────┐
│  Call Sites                                                   │
│                                                               │
│  booking-quote.ts    deliveries.ts    route-delivery.ts       │
│       │                   │                  │                │
│       └───────────────────┼──────────────────┘                │
│                           ▼                                   │
│              getRoadDistanceKm()                               │
│              packages/shared/src/lib/mapbox-distance.ts        │
│                           │                                   │
│                    ┌──────┴──────┐                            │
│                    ▼             ▼                            │
│              LRU Cache      Mapbox API                        │
│              (in-memory)    (3s timeout)                      │
│                                  │                            │
│                           on failure                          │
│                                  ▼                            │
│                          haversineKm()                        │
│                          (fallback)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Module: `packages/shared/src/lib/mapbox-distance.ts`

### Exports

```ts
/**
 * Returns driving road distance in km between two coordinates.
 * Falls back to haversine on Mapbox failure.
 */
export async function getRoadDistanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<number>;

/** Exposed for testing — resets the LRU cache and backoff state. */
export function _resetDistanceCache(): void;
```

Re-exported from `packages/shared/src/index.ts`:
```ts
export { getRoadDistanceKm } from './lib/mapbox-distance';
```

### Dependencies

- `MAPBOX_ACCESS_TOKEN` environment variable (already exists)
- `haversineKm()` — currently in `apps/api/src/lib/eta-calculator.ts`. Must be moved/re-exported
  from `packages/shared/src/lib/haversine.ts` so that `mapbox-distance.ts` can import it without
  circular dependency on the API app.

---

## Haversine Relocation

Move the pure `haversineKm` function to shared:

**New file:** `packages/shared/src/lib/haversine.ts`
```ts
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

**`apps/api/src/lib/eta-calculator.ts`** — change to re-export:
```ts
export { haversineKm } from '@surewaka/shared';
// ... rest of file unchanged (calculateSystemEta still uses it)
```

All existing imports of `haversineKm` from `eta-calculator` continue to work via the re-export.

---

## Caching Strategy

### Cache Key
Coordinates rounded to 3 decimal places (~111m precision):
```ts
function cacheKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `${fromLat.toFixed(3)},${fromLng.toFixed(3)}→${toLat.toFixed(3)},${toLng.toFixed(3)}`;
}
```

### LRU Implementation
Simple `Map`-based with max size and TTL:

```ts
type CacheEntry = { km: number; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
```

On get: check TTL, return if valid, delete if expired.
On set: if at capacity, delete oldest entry (first key in Map iteration order).

---

## Rate Limit Backoff

```ts
let backoffUntil = 0; // epoch ms; 0 = not in backoff

function isInBackoff(): boolean {
  return Date.now() < backoffUntil;
}

function activateBackoff(): void {
  backoffUntil = Date.now() + 60_000; // 60 seconds
}
```

When `isInBackoff()` is true, skip the Mapbox call entirely and return haversine immediately.

---

## Mapbox API Call

```ts
async function fetchMapboxDistance(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<number | null> {
  if (isInBackoff()) return null;

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return null;

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?access_token=${token}&overview=false`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 429) {
      activateBackoff();
      return null;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as { routes?: Array<{ distance?: number }> };
    const meters = data.routes?.[0]?.distance;
    if (typeof meters !== 'number' || meters <= 0) return null;

    return Math.round((meters / 1000) * 10) / 10; // km, 1 decimal
  } catch {
    clearTimeout(timeout);
    return null; // network error or abort
  }
}
```

Note: `overview=false` skips the geometry in the response (smaller payload, faster parse).

---

## Main Function

```ts
export async function getRoadDistanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<number> {
  const key = cacheKey(fromLat, fromLng, toLat, toLng);

  // 1. Check cache
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.km;
  }
  if (cached) cache.delete(key); // expired

  // 2. Try Mapbox
  const roadKm = await fetchMapboxDistance(fromLat, fromLng, toLat, toLng);

  if (roadKm !== null) {
    // Cache the result
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, { km: roadKm, expiresAt: Date.now() + CACHE_TTL_MS });
    return roadKm;
  }

  // 3. Fallback to haversine
  const fallbackKm = haversineKm(fromLat, fromLng, toLat, toLng);
  console.warn(
    `[mapbox-distance] Fallback to haversine: ${fallbackKm.toFixed(1)}km (${fromLat},${fromLng} → ${toLat},${toLng})`,
  );
  return Math.round(fallbackKm * 10) / 10;
}
```

---

## Call Site Migrations

### 1. `apps/api/src/routes/booking-quote.ts`

**Before:**
```ts
distanceKm = hub
  ? haversineKm(leg.pickup.lat, leg.pickup.lng, hub.lat, hub.lng)
  : haversineKm(leg.pickup.lat, leg.pickup.lng, leg.dropoff.lat, leg.dropoff.lng);
```

**After:**
```ts
distanceKm = hub
  ? await getRoadDistanceKm(leg.pickup.lat, leg.pickup.lng, hub.lat, hub.lng)
  : await getRoadDistanceKm(leg.pickup.lat, leg.pickup.lng, leg.dropoff.lat, leg.dropoff.lng);
```

For multiple legs, wrap in `Promise.all` where independent:
```ts
const distancePromises = legs.map(async (leg) => {
  // ... compute distanceKm with getRoadDistanceKm
});
const distances = await Promise.all(distancePromises);
```

### 2. `apps/api/src/routes/deliveries.ts`

**Before (quoteLegs mapping):**
```ts
const distanceKm = dbLeg.actorType === 'driver'
  ? haversineKm(dbLeg.pickupLat, dbLeg.pickupLng, dbLeg.dropoffLat, dbLeg.dropoffLng)
  : undefined;
```

**After:**
```ts
const distanceKm = dbLeg.actorType === 'driver'
  ? await getRoadDistanceKm(dbLeg.pickupLat, dbLeg.pickupLng, dbLeg.dropoffLat, dbLeg.dropoffLng)
  : undefined;
```

Same change in the requote endpoint's loop.

### 3. `workers/routing-worker/src/jobs/route-delivery.ts`

**Before:**
```ts
const firstMileDistKm = haversineKm(delivery.pickupLat, delivery.pickupLng, firstHopOrigin.lat, firstHopOrigin.lng);
const lastMileDistKm = haversineKm(lastHopDest.lat, lastHopDest.lng, delivery.dropoffLat, delivery.dropoffLng);
```

**After:**
```ts
const firstMileDistKm = await getRoadDistanceKm(delivery.pickupLat, delivery.pickupLng, firstHopOrigin.lat, firstHopOrigin.lng);
const lastMileDistKm = await getRoadDistanceKm(lastHopDest.lat, lastHopDest.lng, delivery.dropoffLat, delivery.dropoffLng);
```

Transfer legs between parks:
```ts
const transferDist = await getRoadDistanceKm(
  prevHop.destPark.lat, prevHop.destPark.lng,
  hop.originPark.lat, hop.originPark.lng,
);
```

---

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `MAPBOX_ACCESS_TOKEN` | Yes | Already exists in `.env` for admin map |

No new env vars needed.

---

## Error Handling Matrix

| Scenario | Behavior | Logged? |
|----------|----------|---------|
| `MAPBOX_ACCESS_TOKEN` not set | Immediate haversine fallback | Yes (warn once at startup) |
| Network timeout (>3s) | Haversine fallback | Yes (per-call warn) |
| HTTP 429 (rate limit) | Activate 60s backoff + haversine | Yes |
| HTTP 4xx (invalid request) | Haversine fallback | Yes |
| HTTP 5xx (server error) | Haversine fallback | Yes |
| Invalid response shape | Haversine fallback | Yes |
| Coordinates identical (0 distance) | Return 0 without API call | No |

---

## Testing Strategy

### Unit tests (`packages/shared/src/lib/__tests__/mapbox-distance.test.ts`)

- Mock global `fetch` with `vi.fn()`
- Test: successful response → returns km
- Test: cache hit → no second fetch call
- Test: coordinate rounding → different 4th-decimal coords hit same cache key
- Test: timeout → haversine fallback
- Test: 429 → activates backoff → next call skips Mapbox
- Test: backoff expires after 60s → next call tries Mapbox again
- Test: invalid response shape → haversine fallback
- Test: same coordinates (0 distance) → returns 0 without fetch
- Test: `_resetDistanceCache()` clears state

### Integration test (optional, gated by `MAPBOX_INTEGRATION=1`)

- Real Mapbox call with known coordinates (Lagos Jibowu → Lagos Island)
- Asserts distance is > haversine and < 5× haversine (sanity bounds)
- Skipped in CI unless env var is set
