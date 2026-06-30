# Implementation Plan: Admin Driver Detail

## Overview

Implement the admin driver detail page at `/drivers/:driverId` following the same architecture as `users.$userId.tsx`. This involves adding shared types, a backend service + route handler, a frontend data-fetching hook, and a tabbed detail page with Overview, Deliveries, and Carrier tabs using shadcn/ui components.

## Tasks

- [x] 1. Add shared types
  - [x] 1.1 Add `DriverDetail` and `DriverDetailDelivery` types to `packages/shared/src/types.ts`
    - Add the `DriverDetailDelivery` type with fields: `id`, `status`, `pickupAddress`, `dropoffAddress`, `date`, `price`
    - Add the `DriverDetail` type with all fields: `id`, `name`, `phone`, `email`, `avatarUrl`, `vehicleType`, `vehicleModel`, `licensePlate`, `verified`, `available`, `rating`, `totalDeliveries`, `createdAt`, `carrierName`, `carrierId`, `carrierRole`, `carrierJoinedAt`, `recentDeliveries`
    - Export both types from the package barrel
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 2. Implement backend API
  - [x] 2.1 Create the driver detail service at `apps/api/src/services/driver-detail-service.ts`
    - Implement `getDriverDetail(id: string): Promise<DriverDetail | null>` function
    - Query 1: SELECT driver joined with users (INNER JOIN), LEFT JOIN carrier_members (where isActive = true), LEFT JOIN carriers, with correlated subquery for totalDeliveries count
    - Query 2: SELECT 10 most recent deliveries ordered by createdAt DESC
    - Return null when no driver found
    - Map database rows to `DriverDetail` shape with ISO date strings and null coalescing
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 2.2 Add the `GET /:id` route handler in `apps/api/src/routes/admin/drivers.ts`
    - Add route to existing Hono router (already has `requireAuth` and `requireRole('surewaka_admin')` middleware)
    - Validate `:id` param as UUID using regex, return 400 with `VALIDATION_ERROR` if invalid
    - Call `getDriverDetail(id)`, return 404 with `NOT_FOUND` if null
    - Return 200 with `{ data: DriverDetail, error: null, meta: null }` on success
    - _Requirements: 1.7, 1.8, 1.9, 1.10_

  - [ ]* 2.3 Write property test for UUID validation (Property 5)
    - **Property 5: Invalid UUID rejection**
    - Generate random non-UUID strings via fast-check, verify API returns 400 with `VALIDATION_ERROR`
    - **Validates: Requirements 1.9**

  - [ ]* 2.4 Write property tests for driver detail service
    - **Property 2: Carrier affiliation consistency** — Generate drivers with/without carrier memberships, verify null-consistency of all carrier fields
    - **Property 3: Total deliveries aggregation accuracy** — Generate drivers with varying delivery counts where status='delivered', verify aggregation matches direct count
    - **Property 4: Recent deliveries bounded and ordered** — Generate drivers with varying delivery counts (0, 5, 15, 50), verify array length ≤ 10 and descending date order
    - **Validates: Requirements 1.3, 1.4, 1.6**

- [x] 3. Checkpoint - Verify backend compiles and passes tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement frontend hook
  - [x] 4.1 Create `use-driver-detail.ts` hook at `apps/admin/app/hooks/use-driver-detail.ts`
    - Implement `useDriverDetail(driverId: string): UseDriverDetailResult`
    - Use `@clerk/react-router` `useAuth()` for token retrieval
    - Fetch from `GET /api/v1/admin/drivers/:id` with Bearer token
    - Manage AbortController to cancel in-flight requests on unmount or driverId change
    - Silently ignore AbortError, set error state for non-2xx responses
    - Return `{ driver, isLoading, error, refetch }`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 5. Implement frontend components
  - [x] 5.1 Create `overview-tab.tsx` at `apps/admin/app/components/drivers/detail/overview-tab.tsx`
    - Display driver avatar (or placeholder), name, phone, email
    - Display vehicle type, vehicle model, license plate in a sectional card
    - Display verification badge (verified/unverified) and availability badge (available/unavailable)
    - Display rating value and total completed deliveries count
    - Display join date using `formatDate` utility (en-NG locale, short month format)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 5.2 Create `deliveries-tab.tsx` at `apps/admin/app/components/drivers/detail/deliveries-tab.tsx`
    - Render a table with columns: Status, Pickup Address, Dropoff Address, Date, Price
    - Display status with badge/colored indicator appropriate to the status value
    - Display dates in human-readable format using `formatDate`
    - Display prices in Nigerian Naira using `formatNaira` utility
    - Show empty state message when `recentDeliveries` array is empty
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 5.3 Create `carrier-tab.tsx` at `apps/admin/app/components/drivers/detail/carrier-tab.tsx`
    - When carrier fields are non-null: display carrier name, driver's role, and join date
    - When carrier fields are null: display "Independent" label
    - Carrier name displayed as text (not a link)
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 5.4 Write property tests for formatting utilities
    - **Property 6: Date formatting produces human-readable output** — Generate random valid ISO date strings, verify output contains month abbreviation, numeric day, and four-digit year, and never throws
    - **Property 7: Price formatting produces Naira currency string** — Generate random non-negative numbers, verify output contains ₦ symbol and thousand separators, and never throws
    - **Validates: Requirements 4.7, 5.5, 5.6**

- [x] 6. Wire up the driver detail route page
  - [x] 6.1 Create route file at `apps/admin/app/routes/drivers.$driverId.tsx`
    - Extract `driverId` from route params
    - Use `useDriverDetail` hook for data fetching
    - Add back button linking to `/drivers`
    - Display driver name as page title
    - Implement tabbed layout with shadcn/ui `Tabs` (Overview, Deliveries, Carrier) with Overview as default
    - Add `RoleGate` with "Access Denied" fallback for non-admin users
    - Add class-based error boundary with user-friendly fallback
    - Show skeleton loader during loading state
    - Show "Driver not found" message with back link on 404
    - Show error message with Retry button on network/server error
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.1, 7.2, 7.3, 7.4, 8.3_

  - [x] 6.2 Register the route in `apps/admin/app/routes.ts`
    - Add `route('drivers/:driverId', 'routes/drivers.$driverId.tsx')` within the authenticated layout children
    - _Requirements: 9.1, 9.2_

- [x] 7. Final checkpoint - Verify everything compiles and passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- The implementation follows the exact user detail page pattern (`users.$userId.tsx`) — same layout, same hook interface, same error handling
- shadcn/ui Tabs, Card, Badge components are already available in the project
- Clerk auth hooks (`useAuth`, `getToken`) provide the Bearer token for API calls
- The `GET /:id` route is added to the existing `apps/api/src/routes/admin/drivers.ts` router (created by admin-driver-listing)
- `formatDate` and `formatNaira` utilities may already exist — reuse if available, otherwise create in a shared util file

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "5.1", "5.2", "5.3"] },
    { "id": 4, "tasks": ["5.4", "6.1"] },
    { "id": 5, "tasks": ["6.2"] }
  ]
}
```
