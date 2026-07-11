# Requirements Document

## Introduction

The Dynamic Zones feature replaces the hardcoded `LAGOS_ZONES` constant with a database-driven zone entity. This is a clean break — text zone columns are dropped outright, `LAGOS_ZONES` and `LagosZone` are deleted (not deprecated), and no backfill scripts are needed. Zones become first-class data records with geographic definitions (bounding boxes and keyword sets), enabling multi-city and multi-country expansion without code changes. The system supports adding Port Harcourt, Abuja, or international cities by inserting rows into the `zones` table — no deployment required.

**Scope:** Zone infrastructure only. Delivery leg creation (where the classifier is called) is a separate spec; this spec provides the classifier contract.

## Glossary

- **Zone_Service**: The API-layer service responsible for CRUD operations on zone records and caching zone data for classification lookups.
- **Zone_Classifier**: The module that determines which zone a geographic coordinate belongs to, using two-phase matching: local keyword match against provided address text, then remote LocationIQ fallback.
- **Zone_Record**: A single row in the `zones` table representing a named geographic area within a city.
- **Bounding_Box**: A rectangular geographic region defined by southwest (min lat/lng) and northeast (max lat/lng) corners, used as a fast pre-filter before keyword matching.
- **Zone_Admin_UI**: The admin dashboard interface for managing zone records, under `/coverage/zones`.
- **Delivery_Leg**: A segment of a multi-leg delivery with pickup and dropoff locations, each classified into a zone via UUID FK.
- **Carrier_SLA_Override**: A carrier-specific service-level agreement that varies by origin and destination zone pair (referenced by UUID).
- **Alert_Engine**: The background worker that evaluates alert rules and includes zone context in alert payloads.
- **Analytics_Service**: The service that aggregates delivery performance data, including metro-scoped zone-based delay heatmaps.

## Requirements

### Requirement 1: Zone Data Model

**User Story:** As a platform operator, I want zones stored as database records with geographic metadata, so that new zones can be added without code deployments.

#### Acceptance Criteria

1. THE Zone_Service SHALL store each Zone_Record with the following fields: id (UUID), name (text, max 100 characters, unique per city+country), city (text, max 100 characters), country (text, max 100 characters), keywords (text array, min 1 entry, max 50 entries, each keyword max 100 characters), bounding box coordinates (sw_lat, sw_lng, ne_lat, ne_lng as nullable reals), is_active (boolean, default true), created_at (timestamptz), and updated_at (timestamptz).
2. THE Zone_Service SHALL enforce a unique constraint on the combination of (name, city, country) to prevent duplicate zone definitions.
3. THE Zone_Service SHALL require that name, city, and country fields are non-empty strings after trimming leading and trailing whitespace, rejecting whitespace-only values with HTTP 400.
4. WHERE a bounding box is provided, THE Zone_Service SHALL require all four coordinates (sw_lat, sw_lng, ne_lat, ne_lng) to be present, validate that latitude values are within -90 to 90 and longitude values are within -180 to 180, and validate that sw_lat < ne_lat and sw_lng < ne_lng.
5. THE Zone_Service SHALL seed the database with all Nigeria zones: 6 Lagos zones (Tier 1 with full bounding boxes and keywords), 4–6 zones each for Abuja, Port Harcourt, Ibadan, and Kano (Tier 2 with keywords), and 1 zone each for ~30 remaining state capitals (Tier 3 with city-name keywords). Total: ~55–70 zone rows.
6. THE Zone_Service SHALL NOT include an "Other" zone. The classifier returns null for unclassifiable coordinates.
7. IF a zone creation or update request fails validation, THEN THE Zone_Service SHALL return HTTP 400 with an error message indicating which field(s) failed validation and the reason.

### Requirement 2: Zone CRUD API

**User Story:** As an admin, I want to create, read, update, and deactivate zones through the API, so that I can manage zone coverage for new cities.

#### Acceptance Criteria

1. WHEN a zone creation request is received with a name (1–100 characters), city (1–100 characters), country (1–100 characters), keywords (min 1), and is_active flag, THE Zone_Service SHALL insert a new Zone_Record and return the created record with HTTP 201.
2. WHEN a zone listing request is received, THE Zone_Service SHALL return active Zone_Records filtered by optional city and country query parameters, paginated with a default page size of 50 and a maximum page size of 100.
3. WHEN a zone update request is received with a valid zone ID, THE Zone_Service SHALL update only the specified fields and return the updated record with HTTP 200.
4. IF a zone update or deactivation request references a zone ID that does not exist, THEN THE Zone_Service SHALL return HTTP 404 with an error message indicating the zone was not found.
5. WHEN a zone deactivation request is received for an existing zone, THE Zone_Service SHALL set is_active to false rather than deleting the record, preserving referential integrity with historical delivery data (ON DELETE RESTRICT prevents hard deletion).
6. IF a zone creation or update request would result in a duplicate (name, city, country) combination, THEN THE Zone_Service SHALL return HTTP 409 with an error message indicating the combination already exists.
7. THE Zone_Service SHALL require the `surewaka_admin` role for all zone mutation endpoints (create, update, deactivate).
8. THE Zone_Service SHALL require authentication (`requireAuth`) for the zone listing endpoint. Any authenticated user can read active zones (no role check required).
9. IF a zone creation or update request is missing required fields or contains values exceeding the allowed character limits, THEN THE Zone_Service SHALL return HTTP 400 with an error message indicating which fields failed validation.
10. WHEN a zone is created or updated, THE Zone_Service SHALL check that no keyword in the request overlaps with keywords of other active zones in the same (city, country). IF overlap is detected, THEN return HTTP 409 with the conflicting keyword and zone name.

### Requirement 3: Zone Classification from Coordinates

**User Story:** As the system, I want to classify coordinates into zones using database-stored definitions, so that zone assignment works for any configured city.

#### Acceptance Criteria

1. WHEN the Zone_Classifier receives an address text, latitude, and longitude, THE Zone_Classifier SHALL first perform a case-insensitive substring match of the address text against each keyword in the keywords array of active Zone_Records (Phase 1: local match).
2. WHEN multiple Zone_Records match the address text, THE Zone_Classifier SHALL return the zone with the longest matching keyword; IF two or more zones share the same longest keyword length, THEN THE Zone_Classifier SHALL return the zone whose matching keyword appears first (lowest character index) in the address text.
3. IF no Zone_Record keywords match the address text in Phase 1 and `skipRemote` is not true, THEN THE Zone_Classifier SHALL call LocationIQ reverse-geocode using the latitude and longitude, and perform keyword matching against the `address` object fields from the response (Phase 2: remote fallback).
4. WHERE a Zone_Record has bounding box coordinates defined (all four values non-null), THE Zone_Classifier SHALL check if the input latitude is between sw_lat and ne_lat (inclusive) and longitude is between sw_lng and ne_lng (inclusive) before performing keyword matching, skipping zones whose bounding box excludes the point.
5. THE Zone_Classifier SHALL only consider Zone_Records where is_active is true.
6. IF the LocationIQ API does not respond within 5 seconds or returns a non-2xx HTTP status, THEN THE Zone_Classifier SHALL return null and log the failure including the HTTP status code (if available), latitude, and longitude.
7. THE Zone_Classifier SHALL cache the active zone definitions in memory with a configurable TTL (default 5 minutes) to avoid repeated database queries on every classification call.
8. WHEN a zone is created, updated, or deactivated via the Zone CRUD API, THE Zone_Classifier SHALL invalidate its in-memory zone cache so that subsequent classification calls reflect the change within one classification request.
9. IF both Phase 1 and Phase 2 produce no match, THEN THE Zone_Classifier SHALL return null rather than a hardcoded fallback value.

### Requirement 4: Delivery Leg Zone References

**User Story:** As a developer, I want delivery legs to reference zone IDs via UUID foreign keys, so that zone data remains consistent and queryable across the system.

#### Acceptance Criteria

1. THE Delivery_Leg table SHALL have pickup_zone_id and dropoff_zone_id columns as nullable UUID foreign keys referencing the zones table, with an ON DELETE RESTRICT constraint.
2. THE Delivery_Leg table SHALL NOT have text-based pickup_zone or dropoff_zone columns (clean break — these are dropped in the migration).
3. THE Zone_Classifier integration contract SHALL be: `classifyZone(addressText, lat, lng)` returns `{ id, name } | null`; the leg stores `result?.id ?? null` in the zone_id column.
4. IF the Zone_Classifier returns null for a coordinate pair, THEN THE Delivery_Leg SHALL store null in the zone_id column for that coordinate pair.

### Requirement 5: Carrier SLA Override Zone References

**User Story:** As a developer, I want carrier SLA overrides to reference zone IDs via UUID foreign keys, so that SLA rules work correctly as zones expand beyond Lagos.

#### Acceptance Criteria

1. THE Carrier_SLA_Override table SHALL have origin_zone_id and destination_zone_id columns as NOT NULL UUID foreign keys referencing the zones table, with ON DELETE RESTRICT constraint.
2. THE Carrier_SLA_Override table SHALL NOT have text-based origin_zone or destination_zone columns (clean break — these are dropped in the migration).
3. THE Carrier_SLA_Override table SHALL enforce a unique constraint on (carrier_id, origin_zone_id, destination_zone_id).
4. THE `createCarrierSlaOverrideSchema` validator SHALL accept `originZoneId` and `destinationZoneId` as `z.string().uuid()` (not text zone names).
5. THE Admin UI SHALL present a zone picker dropdown for SLA override creation, submitting zone UUIDs directly.

### Requirement 6: Shared Zone Type

**User Story:** As a developer, I want a generic zone type that replaces the Lagos-specific `LagosZone` type, so that the type system supports dynamic zone sets.

#### Acceptance Criteria

1. THE Zone_Service SHALL define a `Zone` type in `packages/shared/src/types.ts` containing the fields: `id` (string, UUID), `name` (string), `city` (string), `country` (string), and `isActive` (boolean).
2. THE Zone_Service SHALL define a `ZoneName` type as `string` for use in contexts where only the zone name is needed.
3. THE Zone_Service SHALL export the `Zone` type and `ZoneName` type from `@surewaka/shared`.
4. THE Zone_Service SHALL delete `LAGOS_ZONES` constant and `LagosZone` type entirely (not deprecated — removed outright). All references across the monorepo SHALL be updated or removed.
5. THE Zone_Service SHALL provide a `createZoneSchema` Zod validator in `packages/shared/src/validators.ts` requiring `name` (1–100 chars), `city` (1–100 chars), `country` (1–100 chars), `keywords` (min 1, max 50 entries), and `isActive` (boolean), and an `updateZoneSchema` that makes all fields optional via `.partial()`.

### Requirement 7: Alert System Zone Context

**User Story:** As an ops admin, I want alert context to include the zone name from the database, so that alerts remain accurate as zones expand.

#### Acceptance Criteria

1. WHEN the Alert_Engine evaluates the `driver_silent` rule, THE Alert_Engine SHALL resolve the zone name by LEFT JOINing the delivery leg's `dropoff_zone_id` to the `zones` table `id` column and reading the zone `name` field.
2. WHEN the Alert_Engine evaluates the `leg_overdue` rule, THE Alert_Engine SHALL resolve the zone name by LEFT JOINing the delivery leg's `dropoff_zone_id` to the `zones` table `id` column and include the resolved zone name in the alert context under the `zone` key.
3. IF a delivery leg has a null `dropoff_zone_id`, THEN THE Alert_Engine SHALL omit the `zone` field from alert context rather than including a placeholder value, null, or "Unknown".
4. IF a delivery leg's `dropoff_zone_id` references a zone record where `is_active` is false, THEN THE Alert_Engine SHALL still resolve and include the zone name in the alert context (LEFT JOIN does not filter by is_active).

### Requirement 8: Analytics Zone Queries

**User Story:** As an ops admin, I want analytics heatmaps to work with dynamic zone data scoped by metro, so that new zones automatically appear in reports.

#### Acceptance Criteria

1. WHEN the Analytics_Service generates a Time of Day × Zone delay heatmap, THE Analytics_Service SHALL accept a `city` query parameter (defaults to "Lagos") and query zones from the zones table for that city where `is_active` is true.
2. WHEN the Analytics_Service builds the heatmap for a given date range and metro, THE Analytics_Service SHALL include only active zones in that metro that have at least one delivery leg with a matching `dropoff_zone_id` and a non-null `completed_at` within that date range.
3. WHEN a new zone is inserted into the zones table and delivery legs are classified into the new zone within the queried date range, THE Analytics_Service SHALL include the new zone in the heatmap response without requiring a code deployment.
4. IF the zones table contains no active zones with delivery leg references in the queried date range and metro, THEN THE Analytics_Service SHALL return an empty heatmap array rather than an error.
5. THE Analytics_Service SHALL return the heatmap response within 5 seconds for date ranges up to 31 days.
6. THE frontend SHALL replace the zone filter dropdown with a metro/city picker that defaults to "Lagos" and dynamically renders heatmap columns from the API response.

### Requirement 9: Zone Admin UI

**User Story:** As an admin, I want a UI to manage zones, so that I can add zones for new cities without developer intervention.

#### Acceptance Criteria

1. WHEN an admin navigates to `/coverage/zones`, THE Zone_Admin_UI SHALL display a paginated table (20 rows per page) of all Zone_Records with columns for name, city, country, is_active status, and keyword count.
2. WHEN an admin clicks "Add Zone", THE Zone_Admin_UI SHALL present a form for name (1–100 characters), city (1–100 characters), country (1–100 characters), keywords (comma-separated input, min 1, max 50 keywords each 1–100 characters), and optional bounding box coordinates.
3. WHEN an admin submits a zone form where name, city, country are non-empty and at least one keyword is provided, THE Zone_Admin_UI SHALL call the zone creation API endpoint and display a success confirmation.
4. IF the zone creation API returns a duplicate-name or keyword-overlap error (409), THEN THE Zone_Admin_UI SHALL display the specific error message and preserve the form input.
5. IF a zone creation or update API call fails due to a network or server error, THEN THE Zone_Admin_UI SHALL display an error message indicating the failure reason and preserve the current UI state without data loss.
6. WHEN an admin toggles a zone's active status, THE Zone_Admin_UI SHALL call the zone update API endpoint and reflect the new status in the table row without a full page reload.
7. THE Zone_Admin_UI SHALL allow filtering the zone list by city and country.
8. THE Zone_Admin_UI SHALL allow editing a zone's keywords and bounding box coordinates via a detail panel accessible from each table row.
9. THE Zone_Admin_UI SHALL be placed under a new "Coverage" navigation section with the route `/coverage/zones`.
