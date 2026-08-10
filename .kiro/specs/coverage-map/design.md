# Coverage Map — Design

## Architecture (existing, unchanged)

```
apps/admin/app/routes/coverage/
  map.tsx       → GET /api/v1/admin/coverage-map     (unified GeoJSON: parks + gaps + drivers)
  gaps.tsx      → GET /api/v1/admin/coverage-gaps     (table view, demand-sorted)
  density.tsx   → GET /api/v1/admin/driver-density    (table view, driver counts)

apps/admin/app/components/coverage/
  coverage-hex-map.tsx   → Mapbox renderer (react-map-gl), degrades gracefully if unavailable

apps/api/src/routes/admin/
  coverage-map.ts / coverage-gaps.ts / driver-density.ts

apps/api/src/routes/admin/carrier-parks.ts   ← touched by this spec (h3Index on write)
apps/api/src/routes/driver-locations.ts      ← reference pattern, already correct

workers/cron/src/jobs/compute-coverage-gaps.ts  ← touched by this spec (resolved + distance)

packages/shared/src/h3.ts     → getH3Cell, getH3Center, getH3Neighborhood, h3CellsToGeoJSON
packages/shared/src/lib/haversine.ts → haversineKm(lat1, lng1, lat2, lng2) — reused, not new

packages/db/src/schema/coverage-gaps.ts   ← touched by this spec (3 new columns)
packages/db/src/schema/carrier-parks.ts   ← unchanged (h3Index column already exists, default '')
packages/db/src/schema/drivers.ts         ← unchanged (h3Index + lat/lng already correct)
```

## Decision 1 — h3Index computed server-side on write, not client-side

`createCarrierParkSchema`/`updateCarrierParkSchema` stay unchanged (still just
`lat`/`lng`). The route computes `h3Index = getH3Cell(lat, lng, H3_RESOLUTION)`
itself, mirroring `driver-locations.ts:119`. Keeps the admin client dumb and
the invariant ("h3Index always matches lat/lng") enforced in one place.

**Update case:** `updateCarrierParkSchema` is a `.partial()`, so a PATCH may
carry `lat` alone, `lng` alone, both, or neither. To recompute correctly we
need the *effective* final coordinates, not just whatever arrived in this
request. Route logic:

```ts
if (updates.lat !== undefined || updates.lng !== undefined) {
  const [existing] = await db.select({ lat: carrierParks.lat, lng: carrierParks.lng })
    .from(carrierParks).where(eq(carrierParks.id, id)).limit(1);
  if (!existing) return 404;
  const lat = updates.lat ?? existing.lat;
  const lng = updates.lng ?? existing.lng;
  setValues.h3Index = getH3Cell(lat, lng, H3_RESOLUTION);
}
```

One extra SELECT only on the (uncommon) path where coordinates actually
change — no cost on ordinary field-only updates.

## Decision 2 — Backfill is a one-time script, not a migration

Mirrors `packages/db/src/scripts/seed-zones.ts`: a standalone `tsx` script
under `packages/db/src/scripts/`, run manually via a `pnpm` script, using the
shared `seeds/db.ts` connection (local/Neon auto-detect — the exact bug fixed
in `seed-zones.ts` last session, not repeating it here). Not a Drizzle
migration, because it's a data fix (recompute a derived column for existing
rows), not a schema change. Idempotent: recomputes `h3Index` for every row
regardless of current value, safe to re-run.

## Decision 3 — Resolved-gap tracking lives entirely in the cron job

No new endpoint. `compute-coverage-gaps.ts` already runs every 6h and already
has the full current-demand picture in memory (`hexDemand`). Two passes:

1. **Upsert active cells** (unchanged data collection, extended write): every
   h3Index in this run's `hexDemand` gets `resolved_at: null` explicitly on
   upsert — this is what re-opens a previously-resolved gap if demand
   recurs. Same `onConflictDoUpdate` as today, just a bigger `set`.
2. **Resolve stale cells** (new): `UPDATE coverage_gaps SET resolved_at = now() WHERE resolved_at IS NULL AND h3_index NOT IN (<current hexDemand keys>)`. One query, after the upsert loop. If `hexDemand` is empty (no failed deliveries this run), this resolves *everything* still open — correct behavior, means demand genuinely dried up everywhere.

## Decision 4 — Distance via haversine on real coordinates, not H3 grid-steps

Rejected computing `nearest_park_km` from `gridDistance()` (hex-step count ×
average edge length) — it's an approximation of an approximation and h3-js's
edge-length tables would need unit-converting for no real benefit. Instead:
`getH3Center(gapH3Index)` → real lat/lng, then `haversineKm()` (already in
`@surewaka/shared`, already used for ETA) against every active carrier park's
real `lat`/`lng` and every available driver's real `lat`/`lng`. Straight-line
distance, same accuracy tier the rest of the codebase uses for non-pricing
estimates (see the doc comment on `haversine.ts` itself). O(gaps × parks) and
O(gaps × drivers) per run — at Lagos-launch scale (tens of parks, low
hundreds of gap cells) this is trivial; revisit only if a metro's gap count
grows enough to matter.

`nearest_park_km`/`nearest_driver_km` computed for every cell touched in a
run (both newly-active and newly-resolved), so a resolved gap's last known
distance stays a meaningful historical value instead of going stale forever.

## Decision 5 — No new API route; existing `coverage-gaps.ts` GET just returns more fields

The frontend (`gaps.tsx`) already reads `resolvedAt`, `nearestParkKm`,
`nearestDriverKm` — it was written against this intended contract, just ahead
of the backend. Once the schema + cron job produce the data, the GET handler
adds three fields to its existing `.map()`. No other route changes.

## Schema change

```ts
// packages/db/src/schema/coverage-gaps.ts — add:
resolvedAt: timestamp('resolved_at', { withTimezone: true }),       // nullable
nearestParkKm: real('nearest_park_km'),                             // nullable
nearestDriverKm: real('nearest_driver_km'),                         // nullable
```

Nullable because: a gap may have no parks/drivers to measure against at all
(new metro), and `resolvedAt` is null by definition while active.

## Testing approach

No test infra exists for any file in this feature today. Follow the existing
`apps/api/src/__tests__/zone-routes.test.ts` pattern (Hono app under test,
`vi.mock('@surewaka/db')` with a chainable in-memory mock store, mocked
`requireAuth`/`requireRole`) for:
- `carrier-parks.test.ts` — h3Index computed on create; recomputed on
  lat/lng update; left untouched on a metadata-only update.
- `compute-coverage-gaps.test.ts` — a cell with demand this run stays/becomes
  active; a previously-active cell absent from this run's demand becomes
  resolved; a resolved cell that reappears in demand re-opens.

Not adding tests for `coverage-map.ts`/`driver-density.ts`/the React pages —
they're unchanged by this spec and out of scope; flagged as pre-existing debt
in the requirements doc, not fixed here.
