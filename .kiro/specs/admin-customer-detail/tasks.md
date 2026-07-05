# Implementation Plan: Admin Customer Detail

## Overview

Implement the admin customer detail page at `/customers/:customerId` following the same architecture as `drivers.$driverId.tsx`. This involves adding shared types, a backend service + route handlers, frontend data-fetching hooks, and a detail page with profile header, stat cards, and tabbed content (Delivery History, Customer Info) using shadcn/ui components.

## Tasks

- [x] 1. Add shared types and validation schema
  - [x] 1.1 Add `CustomerDetail` and `CustomerDeliveryItem` types to `packages/shared/src/types.ts`
    - Add `CustomerDetail` type with fields: id, name, phone, email, avatarUrl, gender, verified, createdAt, notificationEmail, notificationSms, tier, totalDeliveries, totalSpent, lastDeliveryAt, primaryCity, healthScore
    - Add `CustomerDeliveryItem` type with fields: id, status, pickupAddress, pickupCity, dropoffAddress, dropoffCity, packageDescription, packageCategory, price, amountPaid, paymentStatus, recipientName, recipientPhone, createdAt
    - Export both types from the package barrel
    - _Requirements: 3.1, 3.2_
  - [x] 1.2 Add `customerDetailDeliveryQuerySchema` Zod schema to `packages/shared/src/validators.ts`
    - Validate page (optional coerced int >= 1, default 1) and pageSize (optional coerced int >= 1, <= 50, default 10)
    - Export from package barrel
    - _Requirements: 3.3_

- [x] 2. Implement backend API
  - [x] 2.1 Create the customer detail service at `apps/api/src/services/customer-detail-service.ts`
    - Implement `getCustomerDetail(id: string): Promise<CustomerDetail | null>` function
    - SELECT user LEFT JOIN customer_segments WHERE role='customer' and id matches
    - Return null when no customer found or user role is not 'customer'
    - Default segment fields to null/zero when no segment row exists
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.2 Add `getCustomerDeliveries(customerId, page, pageSize)` function to the service
    - Paginated query: SELECT deliveries WHERE customer_id = :id ORDER BY created_at DESC with LIMIT/OFFSET
    - Count query for total
    - Map rows to CustomerDeliveryItem with ISO date strings
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7_
  - [x] 2.3 Add `GET /:id` route handler in `apps/api/src/routes/admin/customers.ts`
    - Validate `:id` param as UUID using regex, return 400 with `VALIDATION_ERROR` if invalid
    - Call `getCustomerDetail(id)`, return 404 with `NOT_FOUND` if null
    - Return 200 with `{ data: CustomerDetail, error: null, meta: null }` on success
    - _Requirements: 1.5, 1.6, 1.7, 1.8_
  - [x] 2.4 Add `GET /:id/deliveries` route handler in `apps/api/src/routes/admin/customers.ts`
    - Validate `:id` param as UUID, parse query params with `customerDetailDeliveryQuerySchema`
    - Call `getCustomerDeliveries`, compute totalPages, return paginated response
    - _Requirements: 2.5, 2.6, 2.8, 2.9_

- [x] 3. Checkpoint — Verify backend compiles
  - Ensure API compiles without errors and shared package builds correctly.

- [x] 4. Implement frontend data hooks
  - [x] 4.1 Create `use-customer-detail.ts` hook at `apps/admin/app/hooks/use-customer-detail.ts`
    - Implement `useCustomerDetail(customerId: string): UseCustomerDetailResult`
    - Use `@clerk/react` `useAuth()` for token retrieval
    - Fetch from `GET /api/v1/admin/customers/:id` with Bearer token
    - Manage AbortController to cancel on unmount or ID change
    - Set error state for non-2xx responses, silently ignore AbortError
    - _Requirements: 10.1, 10.3, 10.4_
  - [x] 4.2 Create `use-customer-deliveries.ts` hook at `apps/admin/app/hooks/use-customer-deliveries.ts`
    - Implement `useCustomerDeliveries(customerId, page, pageSize): UseCustomerDeliveriesResult`
    - Re-fetch when page or pageSize changes
    - Same auth token and abort patterns as useCustomerDetail
    - _Requirements: 10.2, 10.3, 10.4_

- [x] 5. Implement frontend route and page layout
  - [x] 5.1 Register `customers/:customerId` route in `apps/admin/app/routes.ts`
    - Add `route('customers/:customerId', 'routes/customers.$customerId.tsx')` under layout
    - _Requirements: 4.1_
  - [x] 5.2 Create `apps/admin/app/routes/customers.$customerId.tsx`
    - Error boundary class component with fallback UI
    - RoleGate requiring `surewaka_admin` role
    - Loading skeleton, error state with retry, not-found state
    - Page layout: back link → profile header → stat cards → tabs
    - Set page meta title
    - _Requirements: 4.3, 4.4, 4.5, 9.1, 9.2, 9.3, 9.4_

- [x] 6. Implement Profile Header component
  - [x] 6.1 Create `apps/admin/app/components/customers/detail/profile-header.tsx`
    - Avatar image or initials placeholder (64px circle)
    - Customer name as heading with tier badge and verification badge
    - Contact info row (email + phone with icons)
    - "Member since [date] · [city]" subtext
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Implement Stat Cards component
  - [x] 7.1 Create `apps/admin/app/components/customers/detail/stat-cards.tsx`
    - 4 cards in responsive grid (lg:4, sm:2, default:1)
    - Total Deliveries: numeric value
    - Total Spent: kobo → Naira with ₦ formatting
    - Health Score: X/100 with color-coded label (green/yellow/red)
    - Last Active: relative time or dash
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 8. Implement Delivery History Table
  - [x] 8.1 Create `apps/admin/app/components/customers/detail/delivery-history-table.tsx`
    - Table with columns: Status (badge), Package, Route (city → city), Price (₦), Date
    - Delivery status badges with color coding per status
    - Pagination controls: Previous/Next buttons, "Showing X-Y of Z"
    - Empty state message for no deliveries
    - Loading skeleton matching table layout
    - Error state with Retry button
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 9. Implement Customer Info Tab
  - [x] 9.1 Create `apps/admin/app/components/customers/detail/customer-info-panel.tsx`
    - Notification preferences (email/SMS enabled/disabled)
    - Gender display with proper capitalization or "Not specified"
    - Account details: creation date, verification status
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 10. Implement navigation integration
  - [x] 10.1 Make customer listing table rows clickable with Link to `/customers/:customerId`
    - Update `CustomerDataTable` component to wrap rows with React Router Link
    - _Requirements: 4.2_
  - [x] 10.2 Create loading skeleton component at `apps/admin/app/components/customers/detail/customer-detail-skeleton.tsx`
    - Match full page layout: back link, profile header shape, stat card shapes, tab area
    - _Requirements: 9.1_

- [x] 11. Final verification
  - Verify all pages compile, navigation works between listing and detail, and all states (loading, error, empty, success) render correctly.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4.1", "4.2"] },
    { "id": 5, "tasks": ["5.1", "5.2"] },
    { "id": 6, "tasks": ["6.1", "7.1", "8.1", "9.1", "10.1", "10.2"] },
    { "id": 7, "tasks": ["11"] }
  ]
}
```

## Notes

- Follow the same architectural patterns as `drivers.$driverId.tsx` for consistency
- Reuse existing utilities: `TierBadge` from customer-columns, `formatCurrency` helper
- The delivery table uses its own hook with separate pagination state, independent from the profile data fetch
- Health score color thresholds: green >= 70, yellow >= 40, red < 40
- All currency values stored in kobo (divide by 100 for display)
