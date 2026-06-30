# Implementation Plan: Admin Driver Listing

## Overview

Implement the admin driver listing feature following the exact pattern established by the customer listing. This involves adding shared types/validators, a backend API route with service layer, and frontend hooks + components for search, filter, sort, pagination, and CSV export.

## Tasks

- [x] 1. Add shared types and validation schema
  - [x] 1.1 Add `DriverListItem` type to `packages/shared/src/types.ts`
    - Add the `DriverListItem` type with all fields: `id`, `name`, `phone`, `email`, `avatarUrl`, `vehicleType`, `licensePlate`, `vehicleModel`, `verified`, `available`, `rating`, `totalDeliveries`, `carrierName`, `carrierId`, `createdAt`
    - _Requirements: 7.1, 7.2_

  - [x] 1.2 Add `driverListQuerySchema` to `packages/shared/src/validators.ts`
    - Add the Zod schema validating `page`, `pageSize`, `search`, `vehicleType`, `verified`, `available`, `carrierId`, `affiliation`, `sortBy`, `sortDir` with proper defaults and constraints
    - Export the `DriverListQuery` inferred type
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_

- [x] 2. Implement backend API
  - [x] 2.1 Create the driver listing service at `apps/api/src/services/driver-listing-service.ts`
    - Implement `listDrivers(params: DriverListQuery)` function
    - Join `drivers` → `users` (INNER JOIN), LEFT JOIN `carrier_members` (where `isActive = true`), LEFT JOIN `carriers`
    - Use correlated subquery for `totalDeliveries` count from `deliveries` where `status = 'delivered'`
    - Implement all filter conditions: `search` (name/phone ILIKE), `vehicleType`, `verified`, `available`, `carrierId`, `affiliation` (independent = no carrier_members, carrier = has carrier_members)
    - Implement sort column mapping: `createdAt`, `rating`, `name`, `totalDeliveries`
    - Return `{ data: DriverListItem[], total: number }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13_

  - [x] 2.2 Create the driver routes handler at `apps/api/src/routes/admin/drivers.ts`
    - Create Hono route with `requireAuth` and `requireRole('surewaka_admin')` middleware
    - Validate query params with `driverListQuerySchema`
    - Return 400 with `VALIDATION_ERROR` on invalid input
    - Call `listDrivers` and return response in `{ data, error, meta }` shape
    - _Requirements: 1.14, 1.15, 8.1, 8.2_

  - [x] 2.3 Register the driver routes in `apps/api/src/index.ts`
    - Import `adminDriverRoutes` from `./routes/admin/drivers`
    - Add `app.route('/api/v1/admin/drivers', adminDriverRoutes)`
    - _Requirements: 1.1_

  - [ ]* 2.4 Write property tests for the driver listing service
    - **Property 2: Filter correctness** — Generate random filter combinations with seed data, verify all returned items satisfy active filters
    - **Property 3: Sort ordering** — Generate random sortBy/sortDir, verify returned array is ordered correctly
    - **Property 5: Total deliveries aggregation** — Generate drivers with varying delivery counts, verify aggregation matches direct count
    - **Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.4**

  - [ ]* 2.5 Write property test for schema validation
    - **Property 9: Schema validation constraints** — Generate random valid/invalid inputs, verify `driverListQuerySchema` accepts/rejects correctly (page bounds, pageSize bounds, search length, enum values, UUID format)
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11**

- [x] 3. Checkpoint - Verify backend compiles and passes tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement frontend hooks
  - [x] 4.1 Create `use-driver-params.ts` hook at `apps/admin/app/hooks/use-driver-params.ts`
    - Parse URL search params for `page`, `pageSize`, `search`, `vehicleType`, `verified`, `available`, `carrierId`, `affiliation`, `sortBy`, `sortDir`
    - Provide setter functions that update URL params (using same pattern as `use-customer-params`)
    - Filter setters and `setPageSize` must reset page to 1
    - `toggleSort` must toggle direction when clicking the same column
    - _Requirements: 3.7, 3.8, 4.4_

  - [x] 4.2 Create `use-driver-data.ts` hook at `apps/admin/app/hooks/use-driver-data.ts`
    - Fetch from `GET /api/v1/admin/drivers` with Bearer token from Clerk
    - Build query string from params, use AbortController for request cancellation
    - Return `{ data, meta, isLoading, error, refetch }`
    - Handle AbortError silently, set error state on network failure
    - _Requirements: 2.7, 2.5_

  - [ ]* 4.3 Write property tests for `useDriverParams` URL round-trip and page reset
    - **Property 6: URL params round-trip** — Generate random driver param objects, set via setters, read back, compare values match
    - **Property 7: Filter and page-size changes reset page** — Generate random current params + filter change, verify page=1 after
    - **Validates: Requirements 3.7, 3.8, 4.4**

- [x] 5. Implement frontend components
  - [x] 5.1 Create `driver-columns.tsx` at `apps/admin/app/components/drivers/driver-columns.tsx`
    - Define TanStack Table column definitions for: Name (with avatar), Phone, Vehicle Type, Verified (badge), Available (badge), Rating, Total Deliveries, Carrier, Joined (formatted date)
    - Enable sorting on `name`, `rating`, `totalDeliveries`, `createdAt` columns
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.2 Create `driver-toolbar.tsx` at `apps/admin/app/components/drivers/driver-toolbar.tsx`
    - Include debounced search input (300ms) for name/phone search
    - Include filter dropdowns: Vehicle Type (All/Motorcycle/Car/Van/Truck), Verified (All/Verified/Unverified), Available (All/Available/Unavailable), Affiliation (All/Independent/Carrier)
    - Include Export CSV button with loading state
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.5_

  - [x] 5.3 Create `driver-data-table.tsx` at `apps/admin/app/components/drivers/driver-data-table.tsx`
    - Render TanStack Table with server-side sorting
    - Show skeleton rows during loading state
    - Show empty state with descriptive message when no results
    - Show error state with Retry button on API failure
    - Handle row click to navigate to `/drivers/{driverId}`
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7_

  - [x] 5.4 Create `driver-pagination.tsx` at `apps/admin/app/components/drivers/driver-pagination.tsx`
    - Display current page, total pages, and total count
    - Provide Next/Previous page buttons (disabled on first/last page)
    - Provide page size selector (10, 20, 50, 100)
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

- [x] 6. Wire up the drivers route page
  - [x] 6.1 Replace the placeholder in `apps/admin/app/routes/drivers.tsx`
    - Compose `useDriverParams`, `useDriverData`, and all driver components
    - Add `RoleGate` with "Access Denied" fallback for non-admin users
    - Add `CustomersErrorBoundary`-style class error boundary
    - Implement `handleExport` CSV export function (fetch all matching drivers up to 10,000, generate CSV with required columns, download as `surewaka-drivers-{YYYY-MM-DD}.csv`)
    - Add page header, loading skeleton, and meta title
    - _Requirements: 5.2, 5.3, 5.4, 8.3, 2.1_

  - [ ]* 6.2 Write property test for CSV export function
    - **Property 8: CSV export contains all required columns** — Generate random DriverListItem arrays, verify CSV output has all required headers and correct row values
    - **Validates: Requirements 5.3**

- [x] 7. Verify admin menu and navigation
  - [x] 7.1 Confirm `/drivers` route is registered in `apps/admin/app/routes.ts`
    - Verify the `route('drivers', 'routes/drivers.tsx')` entry exists in the layout children
    - _Requirements: 2.4_

  - [x] 7.2 Confirm sidebar nav link exists in `apps/admin/app/components/app-sidebar.tsx`
    - Verify `{ title: 'Drivers', url: '/drivers' }` is present under the "Fleet" section
    - _Requirements: 2.4_

  - [x] 7.3 Confirm breadcrumb title is registered in `apps/admin/app/routes/layout.tsx`
    - Verify `'/drivers': { title: 'Drivers', parent: 'Fleet' }` exists in the `routeTitles` map
    - _Requirements: 2.4_

- [x] 8. Final checkpoint - Verify everything compiles and passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- The implementation follows the exact customer listing pattern — same file structure, same hook interfaces, same component composition
- TanStack Table and shadcn/ui components are already available in the project
- Clerk auth hooks (`useAuth`, `getToken`) provide the Bearer token for API calls
- The drivers route is already registered in `apps/admin/app/routes.ts` and the sidebar

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.5", "4.2", "4.3"] },
    { "id": 3, "tasks": ["2.3", "2.4", "5.1", "5.4"] },
    { "id": 4, "tasks": ["5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2"] }
  ]
}
```
