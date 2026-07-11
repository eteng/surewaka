# Implementation Plan: Dynamic Zones

## Overview

Replace the hardcoded `LAGOS_ZONES` constant and `LagosZone` type with a database-driven `zones` table. This is a clean break — text zone columns are dropped, no backfill scripts, no deprecation phases. Implementation proceeds: DB schema → seed script → shared types → classifier rewrite → CRUD API → alert engine → analytics → admin UI. The delivery leg creation integration (where the classifier gets called) is a separate spec; this spec establishes the infrastructure and contract.

## Tasks

- [x] 1. Create zones table schema and migration
  - [x] 1.1 Create `packages/db/src/schema/zones.ts` with the zones table definition
    - Define `zones` pgTable with columns: id (UUID PK), name, city, country, keywords (text array), sw_lat, sw_lng, ne_lat, ne_lng (nullable reals), is_active (boolean default true), created_at, updated_at
    - Add unique constraint on (name, city, country)
    - Add index on (city, is_active) for filtered lookups
    - Export the table from `packages/db/src/schema/index.ts`
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Modify `packages/db/src/schema/delivery-legs.ts` — drop text columns, add UUID FKs
    - Remove `pickupZone` and `dropoffZone` text columns
    - Add `pickupZoneId` (nullable UUID FK → zones.id, ON DELETE RESTRICT) and `dropoffZoneId` (nullable UUID FK → zones.id, ON DELETE RESTRICT)
    - Add indexes on both new columns
    - _Requirements: 4.1, 4.2_

  - [x] 1.3 Modify `packages/db/src/schema/carrier-sla-overrides.ts` — drop text columns, add UUID FKs
    - Remove `originZone` and `destinationZone` text columns
    - Add `originZoneId` (NOT NULL UUID FK → zones.id, ON DELETE RESTRICT) and `destinationZoneId` (NOT NULL UUID FK → zones.id, ON DELETE RESTRICT)
    - Replace unique constraint to use (carrierId, originZoneId, destinationZoneId)
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 1.4 Generate Drizzle migration
    - Run `pnpm --filter @surewaka/db db:generate`
    - Review generated SQL: zones table creation, column drops, FK additions, constraint changes
    - _Requirements: 1.1, 4.1, 5.1_

- [x] 2. Create seed script for Nigeria zones
  - [x] 2.1 Create `packages/db/src/scripts/seed-zones.ts`
    - **Tier 1 — Lagos (6 zones):** Lekki, Victoria Island, Ikeja, Surulere, Mainland, Island — with full keyword sets from current `ZONE_KEYWORDS` and bounding box coordinates
    - **Tier 2 — Major metros (4–6 zones each):** Abuja, Port Harcourt, Ibadan, Kano — key areas with keywords
    - **Tier 3 — State capitals (~30 zones, 1 each):** City name + common area keywords
    - No "Other" zone anywhere
    - Make idempotent (skip if zone exists by name+city+country)
    - Total: ~55–70 rows
    - _Requirements: 1.5, 1.6_

- [x] 3. Checkpoint — Migration applies and seed runs cleanly
  - Apply migration with `pnpm --filter @surewaka/db db:push` (dev prototyping) or `db:generate` + `db:migrate`
  - Run seed script
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update shared types and validators
  - [x] 4.1 Replace zone types in `packages/shared/src/types.ts`
    - Add `Zone` type: `{ id: string; name: string; city: string; country: string; isActive: boolean }`
    - Add `ZoneName` type as `string`
    - Update `DeliveryLeg` type: remove `pickupZone`/`dropoffZone` text fields, add `pickupZoneId: string | null` and `dropoffZoneId: string | null`
    - Update `CarrierSlaOverride` type: remove `originZone`/`destinationZone` text fields, add `originZoneId: string` and `destinationZoneId: string` (NOT NULL)
    - Delete `LagosZone` type entirely
    - Remove `LAGOS_ZONES` import from types file
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.2 Delete `LAGOS_ZONES` constant from `packages/shared/src/constants.ts`
    - Remove the `LAGOS_ZONES` array entirely
    - Fix any resulting import errors across the monorepo
    - _Requirements: 6.4_

  - [x] 4.3 Add zone Zod validators to `packages/shared/src/validators.ts`
    - Create `createZoneSchema`: name (1–100 trimmed), city (1–100 trimmed), country (1–100 trimmed), keywords (min 1, max 50 entries each max 100 chars), optional bounding box, isActive (default true)
    - Add `superRefine` for bounding box all-or-nothing and sw < ne checks
    - Create `updateZoneSchema` as `createZoneSchema.partial()`
    - Update `createCarrierSlaOverrideSchema`: replace `originZone`/`destinationZone` z.enum with `originZoneId: z.string().uuid()` and `destinationZoneId: z.string().uuid()`
    - _Requirements: 6.5, 5.4_

  - [x]* 4.4 Write unit tests for zone validators
    - Test `createZoneSchema` rejects empty keywords array (min 1 required)
    - Test bounding box all-or-nothing rule and sw < ne validation
    - Test `updateZoneSchema` allows partial updates
    - Test `createCarrierSlaOverrideSchema` requires valid UUIDs for zone IDs
    - _Requirements: 1.3, 1.4, 6.5, 5.4_

- [x] 5. Checkpoint — Shared types compile
  - Ensure `pnpm --filter @surewaka/shared build` passes, ask the user if questions arise.

- [x] 6. Rewrite zone classifier
  - [x] 6.1 Rewrite `apps/api/src/lib/zone-classifier.ts` with two-phase DB-driven implementation
    - New signature: `classifyZone(addressText: string, lat: number, lng: number, opts?: { skipRemote?: boolean }): Promise<{ id: string; name: string } | null>`
    - Phase 1: local keyword match against `addressText`, filtered by bounding box
    - Phase 2 (if Phase 1 returns null and `skipRemote` !== true): call LocationIQ reverse-geocode, match against `address` object fields (not `display_name`)
    - Implement in-memory cache with 5-minute TTL
    - Implement `invalidateZoneCache()` export function
    - Implement `getActiveZones()` with cache-miss fetch from DB
    - Implement `isInBoundingBox()` pre-filter
    - Implement `matchZone()` with longest-keyword-wins, earliest-index-breaks-ties logic
    - 5-second AbortController timeout for LocationIQ
    - Log failures with lat, lng, and HTTP status
    - Return null if both phases fail
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9_

  - [x]* 6.2 Write unit tests for zone classifier
    - Test two-phase: local match skips remote
    - Test keyword matching priority (longest wins, earliest index breaks ties)
    - Test bounding box filtering (inside, outside, no bbox)
    - Test LocationIQ failure returns null
    - Test cache invalidation resets cached data
    - Test `skipRemote` option prevents Phase 2
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.9_

  - [x]* 6.3 Write property tests for classifier
    - **Property 2: Classifier Determinism** — matchZone always returns the zone with the longest matching keyword, ties broken by earliest index
    - **Property 3: Bounding Box Pre-Filter** — zones excluded if point outside box; zones without bbox always pass
    - **Property 8: Two-Phase Order** — Phase 1 result prevents Phase 2 execution
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 7. Checkpoint — Classifier compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement zone CRUD API routes
  - [x] 8.1 Create `apps/api/src/routes/zones.ts` for authenticated zone listing
    - GET `/api/v1/zones` — requires `requireAuth` (any authenticated user, no role check)
    - Returns active zones with optional `city`, `country` filters
    - Pagination: default 50, max 100
    - Response: `{ data, error, meta: { page, pageSize, total } }`
    - _Requirements: 2.2, 2.8_

  - [x] 8.2 Create `apps/api/src/routes/admin/zones.ts` for admin mutations
    - POST `/api/v1/admin/zones` — create zone (validate with `createZoneSchema`)
    - PUT `/api/v1/admin/zones/:id` — full update (validate with `updateZoneSchema`)
    - PATCH `/api/v1/admin/zones/:id` — partial update (e.g., toggle active)
    - Apply `requireAuth` + `requireRole('surewaka_admin')`
    - Keyword uniqueness check: query active zones in same (city, country), reject if overlap → 409 with `"Keyword '${kw}' is already assigned to zone '${name}' in ${city}, ${country}"`
    - Handle unique constraint violation → 409
    - Handle not found → 404
    - Call `invalidateZoneCache()` after every mutation
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 3.8_

  - [x] 8.3 Register zone routes in `apps/api/src/index.ts`
    - Mount public routes at `/api/v1/zones`
    - Mount admin routes at `/api/v1/admin/zones`
    - _Requirements: 2.1, 2.2_

  - [x]* 8.4 Write integration tests for zone CRUD endpoints
    - Test create → list → update → deactivate flow
    - Test duplicate name+city+country returns 409
    - Test keyword overlap returns 409 with specific message
    - Test missing fields returns 400
    - Test non-existent zone returns 404
    - Test listing requires auth
    - Test listing returns active only
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.10_

- [x] 9. Checkpoint — CRUD API works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update alert engine to resolve zones via JOIN
  - [x] 10.1 Update `workers/alert-engine/src/rules/driver-silent.ts`
    - Change SQL: LEFT JOIN `zones z ON z.id = dl.dropoff_zone_id`, select `z.name AS zone`
    - Remove reference to `dl.dropoff_zone` text column
    - If `z.name` is null (dropoff_zone_id is null), omit `zone` key from alert context entirely
    - Do not filter by `z.is_active` (inactive zones still resolve for alerts)
    - _Requirements: 7.1, 7.3, 7.4_

  - [x] 10.2 Update `workers/alert-engine/src/rules/leg-overdue.ts`
    - Same JOIN pattern: LEFT JOIN zones via dropoff_zone_id
    - Remove reference to `dl.dropoff_zone` text column
    - Omit `zone` key when null
    - _Requirements: 7.2, 7.3, 7.4_

  - [x]* 10.3 Write unit tests for alert engine zone resolution
    - Test zone name resolved via JOIN for active zone
    - Test zone name resolved via JOIN for inactive zone (still resolves)
    - Test zone key omitted when dropoff_zone_id is null
    - _Requirements: 7.1, 7.3, 7.4_

- [x] 11. Update analytics heatmap to metro-scoped dynamic zones
  - [x] 11.1 Update analytics API endpoint
    - Accept `city` query param (default "Lagos")
    - Query zones from DB for that city (active only) instead of using `LAGOS_ZONES`
    - Include only zones with at least one delivery leg in the queried date range
    - Return `{ metro, zones: string[], cells: Array<{ zone, timeOfDay, avgDelayMinutes }> }`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 11.2 Update `apps/admin/app/components/analytics/root-cause-tab.tsx`
    - Remove `import { LAGOS_ZONES } from '@surewaka/shared'`
    - Replace zone filter dropdown with metro/city picker (defaults to "Lagos")
    - Read zone names from API response, render heatmap columns dynamically
    - Handle empty zones array gracefully (empty state)
    - _Requirements: 8.1, 8.3, 8.6_

- [x] 12. Checkpoint — Alert engine and analytics work with dynamic zones
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Build zone admin UI
  - [x] 13.1 Create "Coverage" nav section in admin sidebar
    - Add new nav group "Coverage" with icon
    - Route: `/coverage/zones`
    - Future siblings placeholder: `/coverage/service-areas`, `/coverage/pricing-regions`
    - _Requirements: 9.9_

  - [x] 13.2 Create `apps/admin/app/routes/coverage/zones.tsx` zone management page
    - Paginated table (20 per page): Name, City, Country, Active status, Keywords count
    - Filter bar with city dropdown and country dropdown
    - "Add Zone" button → modal form (requires at least 1 keyword, Zod client-side validation)
    - Inline active/inactive toggle per row (sends PATCH to API)
    - Row click → detail panel for editing keywords and bounding box
    - Handle 409 (duplicate name or keyword overlap) with specific user-friendly error, preserve form
    - Handle network/server errors with error toast, preserve UI state
    - Loading skeletons, empty state, error boundary per frontend resilience standards
    - Null zones in delivery-related views render as "Unclassified" or "—"
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [-]* 13.3 Write component tests for zone admin UI
    - Test table renders with correct columns
    - Test add zone form requires at least 1 keyword
    - Test active toggle sends PATCH and updates row
    - Test filter by city/country works
    - Test error and loading states render correctly
    - _Requirements: 9.1, 9.3, 9.6, 9.7_

- [x] 14. Final checkpoint — Full integration verification
  - Ensure all tests pass across packages, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between phases
- This is a CLEAN BREAK — no dual-column coexistence, no backfill scripts, no deprecation phases
- `LAGOS_ZONES` constant and `LagosZone` type are deleted outright, not deprecated
- The delivery leg creation service (where `classifyZone` is called) is OUT OF SCOPE — this spec only provides the classifier contract
- Existing delivery/SLA data should be re-seeded after migration (dev/staging), or handled by the deployment plan for production
- Keyword uniqueness is enforced at the application layer (CRUD routes), not via DB constraint

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "4.4"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "10.1", "10.2"] },
    { "id": 9, "tasks": ["10.3", "11.1"] },
    { "id": 10, "tasks": ["11.2", "13.1"] },
    { "id": 11, "tasks": ["13.2"] },
    { "id": 12, "tasks": ["13.3"] }
  ]
}
```
