# Coverage Map — Tasks

Bottom-up: schema → cron logic → API → backfill → tests. UI needs no changes
(already written against the target contract).

## Already done (prior sessions / this spec's earlier work)

- [x] 1. H3 utility module (`packages/shared/src/h3.ts`)
- [x] 2. `coverage_gaps` table + `drivers.h3_index` column (base schema)
- [x] 3. `GET /api/v1/admin/coverage-map`, `coverage-gaps`, `driver-density` routes mounted and auth-gated
- [x] 4. Admin sidebar "Coverage" nav section + three routes registered
- [x] 5. `apps/admin/app/routes/coverage/map.tsx` aligned to `coverage-map.ts` response shape (stat tiles)
- [x] 6. `CoverageHexMap` component (Mapbox render, graceful degradation, popup) wired into `map.tsx`
- [x] 7. Fixed `.gitignore` shadowing `apps/admin/app/components/coverage/`
- [x] 8. `packages/db/src/scripts/seed-zones.ts` uses shared local/Neon-aware connection
- [x] 9. Local DB synced via `db:push` (has `coverage_gaps` table + `drivers.h3_index`)

## Schema

- [x] 10. Add `resolved_at`, `nearest_park_km`, `nearest_driver_km` to `packages/db/src/schema/coverage-gaps.ts` (all nullable)
- [x] 11. Generate migration: `pnpm --filter @surewaka/db db:generate` → `drizzle/0015_misty_mandrill.sql`
- [x] 12. Apply locally: `pnpm --filter @surewaka/db db:push`. **Not yet applied to Neon** — carried forward as an open item, same as the pre-existing migration 0014 gap noted in requirements.md.

## Carrier park H3 indexing

- [x] 13. `POST /api/v1/admin/carrier-parks` — compute `h3Index` from `lat`/`lng` on insert
- [x] 14. `PATCH /api/v1/admin/carrier-parks/:id` — recompute `h3Index` from effective (merged) coordinates only when `lat` and/or `lng` is part of the update; leave untouched otherwise
- [x] 15. `packages/db/src/scripts/backfill-carrier-park-h3.ts` — one-time script recomputing `h3Index` for all existing carrier park rows; added `backfill:carrier-park-h3` script to `packages/db/package.json`
- [x] 16. Ran the backfill against local DB: 0 updated, 15 already correct (all 15 local rows came from `seed-routing.ts`, which already computed `h3Index` at insert — the bug this fixes only ever affected parks created through the admin API, none of which exist locally). Script verified idempotent; still needed wherever admin-created parks actually exist.

## Coverage gap resolution + proximity

- [x] 17. `workers/cron/src/jobs/compute-coverage-gaps.ts` — upsert active cells with `resolved_at: null` (reopens recurring gaps)
- [x] 18. Same job — after the upsert loop, resolve cells absent from this run's demand map (`resolved_at IS NULL AND h3_index NOT IN (...)`, or all active cells when demand is empty this run)
- [x] 19. Same job — compute `nearest_park_km` / `nearest_driver_km` via `haversineKm` from each touched cell's H3 center to the nearest active carrier park / available driver; `null` when none exist
- [x] 20. `GET /api/v1/admin/coverage-gaps` — include `resolvedAt`, `nearestParkKm`, `nearestDriverKm`, and `detectedAt` (mapped from `createdAt` — a third contract mismatch found mid-implementation; the page reads `detectedAt`, the route sent `lastSeenAt`) in the response mapping (both `json` and `geojson` formats)

## Tests

- [x] 21. `apps/api/src/__tests__/carrier-parks-h3.test.ts` — 5 tests, all passing: create computes h3Index; update with new lat/lng recomputes; update with only one of lat/lng merges against the existing row; update without lat/lng leaves it untouched (and skips the merge lookup entirely); 404 on a non-existent park
- [x] 22. `workers/cron/src/__tests__/compute-coverage-gaps.test.ts` — 7 tests, all passing: active-stays-active, active-becomes-resolved (including the empty-demand-resolves-everything edge case), resolved-reopens-on-recurrence, distance computed correctly against real haversine, null when no parks/drivers exist, inactive parks/unavailable drivers excluded

## Verification checkpoint

- [x] 23. Ran the backfill and a real (unmocked) `computeCoverageGaps()` invocation against local DB — completed cleanly with 0 failed deliveries present locally, which confirms the new columns/queries are valid against the actual schema (a real mismatch would have thrown a SQL error immediately) even though it couldn't exercise the resolve/distance logic with live data. That logic is covered by task 22's unit tests instead. Did **not** visually confirm the `/coverage/gaps` page in a browser — that requires a real Clerk admin login, out of reach for this session's tooling. Full test suites for `apps/api` and `workers/cron` were also run; failures present in both are pre-existing on `main` (verified via `git stash`) and unrelated to this spec's files.
- [x] 24. Re-ran admin `typecheck` — clean aside from the same 3 pre-existing `zones.test.tsx` errors noted before this spec started (unrelated file, unrelated cause).

## Explicitly out of scope (see requirements.md)

- Surge pricing wiring (`surge-service.ts` is dead code, separate concern)
- Tests for `coverage-map.ts`, `driver-density.ts`, or the React pages (unchanged by this spec)
- Confirming migration state on the real Neon database (local-only verification; flagged as a pre-existing open question, not resolved here)
