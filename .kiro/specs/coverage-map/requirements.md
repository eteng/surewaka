# Coverage Map — Requirements

## Status: retroactive spec — implemented

This spec was written after most of the implementation already existed. The H3
spatial infrastructure (`packages/shared/src/h3.ts`, `coverage_gaps` table,
`drivers.h3_index`) and three admin pages (Coverage Map, Coverage Gaps, Driver
Density) were built directly across two commits (`3240221`, `9078c47`) with no
spec, no tests, and — as this spec established — three real functional gaps
(carrier parks never indexed, coverage gaps never tracked resolution/distance,
and a `detectedAt`/`lastSeenAt` field-name mismatch found mid-implementation)
that made part of the feature silently non-functional. All requirements below
are now implemented and test-covered locally; see `tasks.md` for what each
task actually verified, and the one open item carried forward (Neon migration
state unconfirmed — same pre-existing gap noted for migration 0014).

Out of scope for this spec (tracked separately, not touched here):
- Surge pricing (`apps/api/src/services/surge-service.ts`) — built, never
  wired into the fee engine or any route. Dead code. Flagged for its own spec
  or removal, not addressed here.
- Intercity routing / path optimization (existing unspecced item in CLAUDE.md).

---

## Requirement 1 — Admin can see a unified coverage map

**User story:** As an ops admin, I want a single map showing carrier parks,
active drivers, and demand gaps as H3 hexagons, so I can see coverage health
at a glance.

1. WHEN an admin opens `/coverage/map` THEN the system SHALL fetch
   `GET /api/v1/admin/coverage-map` and render the returned GeoJSON as colored
   hexagons (covered / gap / active) on a Mapbox map. — **Done**
2. WHEN the map has more than zero features THEN the system SHALL show
   summary stat tiles (carrier-park hexes, active-driver hexes, gap hexes)
   computed from the same response, matching the API's classification exactly. — **Done**
3. WHEN a hex is clicked THEN the system SHALL show a popup with park count,
   driver count, and demand count for that hex. — **Done**
4. WHEN `react-map-gl`/`mapbox-gl` are not resolvable at runtime THEN the
   component SHALL degrade to a static summary instead of crashing. — **Done**

## Requirement 2 — Carrier parks are geospatially indexed

**User story:** As the coverage map, I need every carrier park's H3 cell so
"covered" hexes reflect real park locations, not an empty default.

1. WHEN an admin creates a carrier park via
   `POST /api/v1/admin/carrier-parks` THEN the system SHALL compute
   `h3Index` from the submitted `lat`/`lng` at `H3_RESOLUTION` and persist it
   on the new row. — **Done**
2. WHEN an admin updates a carrier park's `lat` and/or `lng` via
   `PATCH /api/v1/admin/carrier-parks/:id` THEN the system SHALL recompute
   `h3Index` from the resulting effective coordinates (merging the update
   with the existing row, since either field may arrive alone) and persist
   it. — **Done**
3. WHEN `lat`/`lng` are not part of a PATCH payload THEN `h3Index` SHALL be
   left unchanged. — **Done**
4. WHEN this spec ships THEN all pre-existing carrier park rows with
   `h3_index = ''` SHALL be backfilled once from their stored `lat`/`lng` via
   a one-time script, so the map reflects real coverage immediately rather
   than only for parks created after this fix. — **Done**

## Requirement 3 — Coverage gaps track resolution and proximity

**User story:** As an ops admin, I want to know whether a demand gap is still
open and how far the nearest park/driver is, so I know whether it needs a new
park or is already served.

1. WHEN the `compute-coverage-gaps` cron job runs (every 6h) THEN for every
   H3 cell with `routing_failed` demand in the last 7 days, the system SHALL
   upsert a `coverage_gaps` row with `resolved_at = NULL` — including
   re-opening a previously resolved gap if demand recurs in the same cell. — **Done**
2. WHEN a `coverage_gaps` row is currently active (`resolved_at IS NULL`) AND
   its H3 cell no longer appears in the current run's demand scan THEN the
   system SHALL set `resolved_at = now()` on that row, leaving `demand_count`
   and `last_seen_at` as the historical record of what was resolved. — **Done**
3. WHEN the cron job processes any cell (active or freshly resolved) THEN it
   SHALL compute and persist `nearest_park_km` (haversine distance from the
   cell's H3 center to the nearest active carrier park) and
   `nearest_driver_km` (same, to the nearest available driver), using `NULL`
   when no parks/drivers exist at all. — **Done**
4. WHEN an admin opens `/coverage/gaps` THEN
   `GET /api/v1/admin/coverage-gaps` SHALL return `resolvedAt`,
   `nearestParkKm`, `nearestDriverKm`, and `detectedAt` per gap, matching
   what the page already renders. `detectedAt` is a third, independently
   discovered contract mismatch (the API sent `lastSeenAt`; the page reads
   `detectedAt` and would have rendered "Invalid Date" for every row) — maps
   to the gap row's `createdAt` (when it was first detected), which the API
   now also sends alongside `lastSeenAt` (most recent demand). — **Done**
5. WHEN a gap has `resolvedAt` set THEN the admin UI SHALL badge it
   "Resolved"; otherwise "Active" — this UI behavior already exists and
   requires no frontend change once #4 ships. — **Done (frontend only)**

## Requirement 4 — Driver density view

**User story:** As an ops admin, I want to see available-driver counts per H3
cell in real time.

1. WHEN an admin opens `/coverage/density` THEN the system SHALL fetch
   `GET /api/v1/admin/driver-density` and render per-cell driver counts with
   a relative density bar. — **Done**
2. Driver `h3_index` SHALL be kept current on every location POST (already
   true via `apps/api/src/routes/driver-locations.ts`). — **Done**

## Requirement 5 — Repo hygiene

1. Source files under any directory literally named `coverage` SHALL be
   trackable by git — the blanket `coverage/` ignore rule (intended for test
   output) SHALL NOT shadow real source directories. — **Done**
2. The `zones` seed script SHALL work against both local Postgres and Neon,
   matching every other seed script's connection pattern. — **Done (unrelated
   fix, bundled in because it blocked verifying this spec's local DB state)**

## Requirement 6 — Test coverage

1. The `coverage-gaps` API route's resolved/proximity fields SHALL have at
   least one test exercising the resolve-then-reopen cycle. — **Done**
2. The carrier-park `h3Index`-on-write behavior (create + update, including
   the "update without lat/lng leaves h3Index untouched" case) SHALL have
   test coverage. — **Done**

`coverage-gaps.ts` (route) and `compute-coverage-gaps.ts` (cron job) now have
test coverage for the write path this spec added — the first tests either
file has had. `coverage-map.ts` and `driver-density.ts` remain untested,
unchanged from before this spec (out of scope — see the top of this doc).
