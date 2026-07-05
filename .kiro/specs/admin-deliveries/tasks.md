# Implementation Plan: Admin Deliveries

## Overview

Implement the admin deliveries feature replacing the placeholder page at `/deliveries` with a full delivery management interface. The implementation follows the existing monorepo architecture: Hono API routes with Drizzle ORM queries, React Router v7 SPA frontend with shadcn/ui components, Mapbox GL JS for map visualization, and Ably for realtime updates. Tasks are ordered for incremental development — API first, then seed data, then frontend components, map, and realtime integration.

## Tasks

- [x] 1. Add shared types and validation schemas
  - [x] 1.1 Add delivery list and detail types to `packages/shared/src/types.ts`
    - Add `DeliveryListItem` type with fields: id, status, pickupAddress, pickupCity, dropoffAddress, dropoffCity, packageCategory, price, createdAt, updatedAt, customerName, customerPhone, driverName, carrierName, recipientName, recipientPhone
    - Add `DeliveryDetail` type with full delivery data including nested customer, driver, carrier objects
    - Add `TabCounts` type with fields: all, requests, active, completed
    - Add `StatusUpdatePayload` and `LocationUpdatePayload` types for realtime events
    - Export all types from the package barrel
    - _Requirements: 6.1, 6.3, 6.4, 8.1, 8.2, 8.3_

  - [x] 1.2 Add `adminDeliveryListQuerySchema` Zod schema to `packages/shared/src/validators.ts`
    - Validate page (coerced int, min 1, default 1), pageSize (coerced int, min 1, max 100, default 20)
    - Validate search (string, max 200 chars, optional), status (enum of 12 delivery statuses, optional)
    - Validate tab (enum: all, requests, active, completed; default "all")
    - Validate sortBy (enum: createdAt, status, customerName, price; default "createdAt"), sortDir (enum: asc, desc; default "desc")
    - Export from package barrel
    - _Requirements: 6.2, 6.8_

- [x] 2. Implement admin deliveries API endpoints
  - [x] 2.1 Create `GET /api/v1/admin/deliveries` list endpoint in `apps/api/src/routes/admin/deliveries.ts`
    - Apply `requireAuth` and `requireRole('surewaka_admin')` middleware
    - Parse and validate query params with `adminDeliveryListQuerySchema`, return 400 on failure
    - Implement Drizzle query joining deliveries with users (customer), drivers, and carriers
    - Apply tab-based lifecycle filtering: requests → [draft, pending, accepted], active → [en_route_pickup, arrived_pickup, picked_up, en_route_dropoff, arrived_dropoff], completed → [delivered, cancelled, failed, returned]
    - Apply tab-specific default sort: requests → createdAt ASC, active → updatedAt DESC, completed → createdAt DESC
    - Implement search across customerName, customerPhone, recipientName, recipientPhone, pickupAddress, dropoffAddress using ILIKE
    - Apply status filter when provided
    - Apply sortBy/sortDir when explicit (overrides tab default)
    - Compute tabCounts with a parallel count query grouped by status
    - Return paginated response with `{ data, error: null, meta: { total, page, pageSize, totalPages, tabCounts } }`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 9.2, 9.3, 9.4, 9.5_

  - [x] 2.2 Create `GET /api/v1/admin/deliveries/:id` detail endpoint in the same route file
    - Validate `:id` param as UUID format, return 400 with `VALIDATION_ERROR` if invalid
    - Query delivery with LEFT JOINs to users, drivers, carriers
    - Return 404 with `NOT_FOUND` if no record exists
    - Shape response with nested customer, driver (null if unassigned), carrier (null if unassigned) objects
    - Return `{ data: DeliveryDetail, error: null, meta: null }`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 6.4, 6.5_

  - [x] 2.3 Register the deliveries admin route in `apps/api/src/index.ts` (or the admin route group file)
    - Import and mount the deliveries route under the admin prefix
    - _Requirements: 6.1_

- [x] 3. Checkpoint — Verify API compiles and endpoints are reachable
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement seed data script
  - [x] 4.1 Create `packages/db/src/seeds/seed-deliveries.ts`
    - Define Nigerian address data arrays for Lagos (Victoria Island, Lekki, Ikeja, Surulere, Yaba, Lagos Island), Abuja (Garki, Wuse, Maitama, Asokoro, Gwarinpa), and Port Harcourt (GRA, Trans Amadi, Rumuokwurushi, Eliozu)
    - Implement idempotent cleanup: delete existing records where `delivery_notes` contains `[SEED]` marker
    - Create 5 test customer users and 3 test drivers with `[SEED]` marker in name if they don't exist
    - Generate 60 deliveries distributed across all 12 statuses (minimum 2 per status, weighted toward active)
    - Assign valid Nigerian coordinates (lat 4.0–14.0, lng 2.5–14.5) for all locations
    - Distribute all 5 package categories (document, parcel, fragile, heavy, food)
    - Populate recipientPhone in +234XXXXXXXXXX format, packageDescription (1–200 chars), packageWeight (0.1–500 kg), price (100–50000 Naira)
    - Assign driverId for all deliveries with status beyond "accepted"
    - Distribute createdAt timestamps across past 30 days
    - Add script entry to package.json for execution
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ]* 4.2 Write property tests for seed script at `packages/db/src/seeds/__tests__/seed-deliveries.test.ts`
    - **Property 9: Seed script idempotence** — run seed twice, verify record count is identical
    - **Property 10: Seed data field validity** — verify all generated records pass field constraints (phone format, coordinate bounds, weight/price ranges, driverId assignment for active+ statuses)
    - **Validates: Requirements 5.6, 5.7, 5.8**

- [x] 5. Checkpoint — Verify seed script runs successfully
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement frontend deliveries page shell and data hooks
  - [x] 6.1 Create data-fetching hook at `apps/admin/app/hooks/use-deliveries.ts`
    - Implement `useDeliveries(params): UseDeliveriesResult` with page, pageSize, search, status, tab, sortBy, sortDir parameters
    - Use `@clerk/react` `useAuth()` for Bearer token
    - Fetch from `GET /api/v1/admin/deliveries` with query params
    - Manage AbortController for cancellation on param changes
    - Re-fetch when any parameter changes
    - Return data, meta (including tabCounts), loading, error states
    - _Requirements: 1.1, 1.6, 7.1_

  - [x] 6.2 Create data-fetching hook at `apps/admin/app/hooks/use-delivery-detail.ts`
    - Implement `useDeliveryDetail(deliveryId): UseDeliveryDetailResult`
    - Fetch from `GET /api/v1/admin/deliveries/:id`
    - Same auth token and abort patterns
    - Return data, loading, error, refetch function
    - _Requirements: 2.1, 2.6_

  - [x] 6.3 Create `apps/admin/app/routes/deliveries.tsx` route component
    - Export route meta with title "SureWaka Admin - Deliveries"
    - Add error boundary with fallback UI
    - Wrap with RoleGate requiring `surewaka_admin`
    - Render `DeliveriesPage` component
    - _Requirements: 4.5, 1.7_

  - [x] 6.4 Create `apps/admin/app/components/deliveries/deliveries-page.tsx` layout orchestrator
    - Manage state for: activeTab, page, pageSize, search, status, sortBy, sortDir, selectedDeliveryId
    - Wire state to `useDeliveries` hook
    - Layout: PageHeader → LifecycleTabBar → DeliveryToolbar → ContentArea (table or map) → DeliveryDetailView (when selected)
    - Handle tab switching: preserve search, reset status filter
    - _Requirements: 4.1, 4.2, 4.3, 9.1, 9.10, 9.11_

- [x] 7. Implement lifecycle tabs and toolbar
  - [x] 7.1 Create `apps/admin/app/components/deliveries/lifecycle-tab-bar.tsx`
    - Render four tabs: All, Requests, Active, Completed with "All" selected by default
    - Display `TabCountBadge` on each tab showing count from API meta.tabCounts
    - Call onTabChange callback when tab is clicked
    - Style active tab with brand color indicator
    - _Requirements: 9.1, 9.6, 9.12_

  - [x] 7.2 Create `apps/admin/app/components/deliveries/delivery-toolbar.tsx`
    - Search input with 300ms debounce, minimum 2 characters to trigger filtering
    - Status filter dropdown with all 12 delivery status options
    - Sort controls (sortBy + sortDir)
    - "Clear filters" button when any filter is active
    - _Requirements: 1.4, 1.5, 7.3_

- [x] 8. Implement data table and row components
  - [x] 8.1 Create `apps/admin/app/components/deliveries/delivery-data-table.tsx`
    - Render table with columns: tracking reference (truncated ID), customer name, pickup city, dropoff city, status badge, package category, price (₦), creation date
    - Sortable column headers for: customer name, status, price, creation date
    - Click column header to toggle sort direction
    - Pagination controls: page numbers, records-per-page selector (10, 20, 50, 100)
    - Show skeleton loader (5-10 rows) while loading
    - Show empty state when no results (with/without filters messaging)
    - Show error state with retry button on API failure
    - Row click navigates to detail view
    - For "Requests" tab: show elapsed time column formatted as "Xh Ym" or "Xd Yh"
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 1.8, 7.1, 7.2, 7.3, 9.13, 9.14_

  - [x] 8.2 Create `apps/admin/app/components/deliveries/delivery-row.tsx`
    - Render individual delivery row with status badge color coding
    - Distinct badge colors for each status in Requests phase (draft, pending, accepted)
    - Hover state triggers map marker highlight (via callback)
    - Clickable row navigates to detail view
    - _Requirements: 2.1, 3.5, 9.12_

  - [ ]* 8.3 Write property test for elapsed time formatting at `apps/admin/app/components/deliveries/__tests__/elapsed-time.test.ts`
    - **Property 12: Elapsed time formatting**
    - Generate random timestamps, verify "Xh Ym" for < 24h and "Xd Yh" for >= 24h
    - **Validates: Requirements 9.13**

- [x] 9. Implement delivery detail view
  - [x] 9.1 Create `apps/admin/app/components/deliveries/delivery-detail-view.tsx`
    - Display full delivery information organized by sections: customer, recipient, driver, carrier, pickup, dropoff, package, pricing, status
    - Show "Unassigned" for null driver or carrier
    - Show loading skeleton while fetching
    - Show 404 error state with link back to list if delivery not found
    - Include DetailMap component with route visualization
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 10. Implement map visualization
  - [x] 10.1 Create `apps/admin/app/components/deliveries/delivery-map.tsx`
    - Use `react-map-gl` v7 with Mapbox GL JS
    - Render pickup markers (green #16a34a) and dropoff markers (red #dc2626) for visible deliveries
    - Display color legend overlay
    - Implement marker click → popup with delivery summary (customer name, status, address)
    - Dismiss previous popup when new marker clicked
    - Auto-fit viewport bounds to contain all visible markers within 500ms
    - Show count of deliveries with unavailable coordinates
    - Show default viewport with message when no valid coordinates available
    - Highlight markers on row hover (increased size or border ring)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 10.2 Create `apps/admin/app/components/deliveries/detail-map.tsx`
    - Render single delivery route: pickup marker, dropoff marker, GeoJSON LineString route line
    - Driver marker (blue #2563eb) with distinct icon when driver is assigned
    - Fit bounds to show full route
    - Accept driver location updates for marker animation (300ms ease-in-out CSS transition)
    - _Requirements: 2.3, 8.3, 8.4_

- [x] 11. Checkpoint — Verify frontend compiles and renders correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement realtime integration
  - [x] 12.1 Create `apps/admin/app/components/deliveries/realtime-status-badge.tsx`
    - Subscribe to `delivery:{id}` channel for status-update events
    - Update displayed status within 1 second of receiving event
    - On terminal status (delivered, cancelled, failed): unsubscribe all channels, remove driver marker
    - _Requirements: 8.2, 8.10_

  - [x] 12.2 Create `apps/admin/app/components/deliveries/driver-location-marker.tsx`
    - Subscribe to `driver-location:{driverId}` channel for location-update events
    - Animate marker position with 300ms ease-in-out transition
    - Only render when delivery has assigned driver
    - _Requirements: 8.3, 8.4, 8.8_

  - [x] 12.3 Implement realtime subscription lifecycle in the detail view
    - Subscribe to delivery channel on mount; subscribe to driver location channel if driver assigned
    - Store unsubscribe functions in React ref
    - Cleanup all subscriptions on unmount or navigation away
    - Handle disconnection: show non-dismissible banner, auto-reconnect every 5s (max 30 attempts)
    - On reconnection: re-fetch delivery state from API, re-subscribe channels
    - On reconnection exhausted: change banner to "Reconnection failed" with manual retry button
    - On re-fetch failure after reconnect: retain last known data, show error, offer manual retry
    - _Requirements: 8.1, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

- [x] 13. Implement naming consistency and navigation
  - [x] 13.1 Update sidebar and page header labels
    - Ensure sidebar shows "Deliveries" under "Operations" group
    - Page header: "Deliveries" heading with subtitle "Monitor and manage all delivery orders across the platform"
    - Breadcrumb: "Operations > Deliveries"
    - Verify no usage of "order", "shipment", or "parcel" in any user-visible label
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

- [ ] 14. Write API property-based and integration tests
  - [ ]* 14.1 Write property tests for list endpoint at `apps/api/src/routes/admin/__tests__/deliveries.test.ts`
    - **Property 1: API pagination response correctness** — generate random page/pageSize, verify response invariants (data.length <= pageSize, meta.page == requested page, meta.totalPages == ceil(total/pageSize), default sort is createdAt desc)
    - **Validates: Requirements 1.1, 6.1**

  - [ ]* 14.2 Write property test for filtering and sorting
    - **Property 2: API filtering and sorting correctness** — generate random filter combos, verify all items match status filter, belong to tab phase, contain search string, and are ordered correctly
    - **Validates: Requirements 1.3, 1.4, 1.5, 6.2**

  - [ ]* 14.3 Write property test for detail endpoint
    - **Property 3: API detail response completeness** — generate deliveries with/without driver/carrier, verify response structure
    - **Property 4: Invalid or non-existent delivery ID returns 404** — generate random non-UUID strings and non-existent UUIDs, verify 404
    - **Validates: Requirements 6.3, 6.4, 6.5**

  - [ ]* 14.4 Write property test for invalid query parameters
    - **Property 5: Invalid query parameters return 400** — generate invalid page/pageSize/status/sortBy/search values, verify 400 response
    - **Validates: Requirements 6.8**

  - [ ]* 14.5 Write property tests for tab lifecycle filtering
    - **Property 6: Tab lifecycle filter correctness** — generate delivery arrays, apply tab filter, verify status constraints and ordering
    - **Property 7: Tab count badge accuracy** — generate delivery arrays, verify `requests + active + completed == all`
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6**

  - [ ]* 14.6 Write property test for coordinate validation
    - **Property 8: Coordinate validation for map markers** — generate random lat/lng including out-of-bounds, verify marker inclusion logic
    - **Validates: Requirements 3.6, 5.3**

  - [ ]* 14.7 Write property test for realtime channel lifecycle
    - **Property 11: Realtime channel subscription lifecycle** — generate delivery with/without driver, verify subscribe/unsubscribe behavior on mount, terminal status, and navigation
    - **Validates: Requirements 8.1, 8.8, 8.10**

- [x] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The design uses TypeScript throughout — all implementation follows existing monorepo conventions
- Map integration uses `react-map-gl` v7 wrapping Mapbox GL JS for declarative React components
- Realtime uses `@surewaka/realtime` package with `CHANNELS.deliveryTracking(id)` and `CHANNELS.driverLocation(driverId)`
- Seed script uses `[SEED]` marker in `delivery_notes` for idempotent cleanup
- Tab-specific default sorts: Requests → createdAt ASC, Active → updatedAt DESC, Completed → createdAt DESC
- Follow patterns from `apps/api/src/routes/admin/customers.ts` for the API route structure
- Follow patterns from `apps/admin/app/routes/customers.$customerId.tsx` for the detail view

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "6.4"] },
    { "id": 5, "tasks": ["7.1", "7.2", "8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3", "9.1", "10.1", "10.2"] },
    { "id": 7, "tasks": ["12.1", "12.2", "12.3", "13.1"] },
    { "id": 8, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7"] }
  ]
}
```
