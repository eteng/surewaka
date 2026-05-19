# Implementation Plan: Waitlist Admin

## Overview

This plan implements the waitlist admin feature in incremental steps: database indexes first, then the shared validator, API service layer, API routes, and finally the frontend components (stats cards, data table, toolbar, pagination, export). Each step builds on the previous one, ending with full integration and wiring.

## Tasks

- [x] 1. Add shared Zod validator for waitlist query parameters
  - Add `waitlistQuerySchema` to `packages/shared/src/validators.ts` with fields: `page` (coerce number, min 1, default 1), `pageSize` (coerce number, min 1, max 100, default 20), `search` (string, max 200, default ''), `userType` (enum sender/business/driver, optional), `source` (string, max 100, optional), `sortBy` (enum fullName/email/userType/createdAt, default 'createdAt'), `sortDir` (enum asc/desc, default 'desc')
  - Export `WaitlistQuery` type inferred from the schema
  - _Requirements: 1.3, 2.1, 3.1, 3.3, 4.1, 8.1_

- [x] 2. Create database migration for waitlist indexes
  - Create a Supabase migration adding indexes: `idx_waitlist_signups_created_at` (created_at DESC), `idx_waitlist_signups_user_type_created_at` (user_type, created_at DESC), `idx_waitlist_signups_source` (source), `idx_waitlist_signups_email` (email)
  - Enable `pg_trgm` extension and create trigram GIN indexes on `full_name` and `email` for ILIKE search performance
  - _Requirements: 10.1, 10.7_

- [ ] 3. Implement waitlist service layer
  - [x] 3.1 Create `apps/api/src/services/waitlist-service.ts` with `listWaitlistSignups(params: WaitlistQuery)` function
    - Use Drizzle ORM to build a dynamic query with conditional WHERE clauses for search (ILIKE on full_name OR email), userType filter, and source filter
    - Apply sorting via the validated `sortBy`/`sortDir` params mapped to Drizzle column references
    - Apply LIMIT/OFFSET pagination at the database level
    - Execute a separate COUNT query for total records with the same filters
    - Return `{ data: WaitlistSignup[], total: number }`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 8.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 3.2 Add `getWaitlistStats()` function to the waitlist service
    - Use SQL COUNT with GROUP BY on `user_type` for per-type breakdown
    - Use COUNT with WHERE `created_at >= now() - interval '7 days'` for recent signups
    - Return `{ total, bySender, byBusiness, byDriver, last7Days }`
    - _Requirements: 6.1, 6.2, 6.3, 10.6_

  - [x] 3.3 Write property tests for waitlist service logic
    - **Property 1: Sort correctness** — generate random signup arrays and sort params, verify returned records are ordered correctly
    - **Validates: Requirements 1.1, 8.1**

  - [x] 3.4 Write property test for pagination metadata
    - **Property 2: Pagination metadata consistency** — generate random (total, page, pageSize) tuples, verify `totalPages = ceil(total / pageSize)` and record count = `min(pageSize, total - (page-1) * pageSize)`
    - **Validates: Requirements 1.2, 9.6, 9.10**

  - [x] 3.5 Write property test for page size bounds
    - **Property 3: Page size bounds enforcement** — generate arbitrary numbers, verify clamping to 100 max and default to 20
    - **Validates: Requirements 1.3**

  - [x] 3.6 Write property test for search filter correctness
    - **Property 4: Search filter correctness** — generate random signups + search terms, verify every returned record contains the term in fullName or email (case-insensitive) and no non-matching records appear
    - **Validates: Requirements 2.1, 2.2**

  - [x] 3.7 Write property test for filter correctness
    - **Property 5: Filter correctness** — generate random signups + filter combos (userType, source), verify all results match all applied filters
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2**

  - [x] 3.8 Write property test for stats aggregation
    - **Property 7: Stats aggregation correctness** — generate random signup arrays, verify `total = bySender + byBusiness + byDriver` and last7Days count matches records within 7-day window
    - **Validates: Requirements 6.1, 6.3**

- [x] 4. Checkpoint - Ensure service layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Create waitlist admin API routes
  - [x] 5.1 Create `apps/api/src/routes/admin/waitlist.ts` with `GET /` (list) endpoint
    - Apply `requireAuth` and `requireRole('surewaka_admin')` middleware
    - Parse and validate query params with `waitlistQuerySchema`
    - Call `listWaitlistSignups` and return response in `{ data, error, meta }` shape with pagination metadata (total, page, pageSize, totalPages)
    - Return 400 with `VALIDATION_ERROR` code for invalid params
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3_

  - [x] 5.2 Add `GET /stats` endpoint to the waitlist admin route
    - Apply same auth middleware
    - Call `getWaitlistStats` and return in `{ data, error, meta: null }` shape
    - _Requirements: 6.3_

  - [x] 5.3 Register the waitlist admin route in the API app
    - Import and mount the waitlist route at `/api/v1/admin/waitlist` in `apps/api/src/index.ts`
    - _Requirements: 1.1_

  - [x] 5.4 Write property test for invalid filter rejection
    - **Property 6: Invalid filter rejection** — generate random non-enum strings for userType, verify 400 response with validation error
    - **Validates: Requirements 3.3**

  - [x] 5.5 Write unit tests for API route auth and validation
    - Test 401 for missing/invalid token
    - Test 403 for non-admin role
    - Test 400 for invalid query params (bad userType, pageSize > 100, search > 200 chars)
    - Test default values applied correctly when params omitted
    - _Requirements: 1.4, 1.5, 3.3_

- [x] 6. Checkpoint - Ensure API tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Create frontend hooks and utilities
  - [x] 7.1 Create `apps/admin/app/hooks/use-waitlist-data.ts`
    - Implement `useWaitlistData(params)` hook that fetches from `GET /api/v1/admin/waitlist` with query params
    - Return `{ data, meta, isLoading, error, refetch }`
    - Include Authorization header with Supabase access token
    - _Requirements: 5.8_

  - [x] 7.2 Create `apps/admin/app/hooks/use-waitlist-stats.ts`
    - Implement `useWaitlistStats()` hook that fetches from `GET /api/v1/admin/waitlist/stats`
    - Return `{ stats, isLoading, error }`
    - _Requirements: 6.1, 6.2_

  - [x] 7.3 Create `apps/admin/app/hooks/use-waitlist-params.ts`
    - Implement `useWaitlistParams()` hook that reads/writes URL search params via `useSearchParams`
    - Provide typed getters/setters for page, pageSize, search, userType, source, sortBy, sortDir
    - Reset page to 1 when search or filter params change
    - _Requirements: 5.8, 9.9_

- [ ] 8. Build waitlist table UI components
  - [x] 8.1 Create `apps/admin/app/components/waitlist/columns.tsx`
    - Define TanStack Table column definitions for: full name, email, user type (with badge), source, signup date (formatted)
    - Enable sorting on all columns via `enableSorting: true`
    - _Requirements: 5.2, 8.1_

  - [x] 8.2 Create `apps/admin/app/components/waitlist/stats-cards.tsx`
    - Display summary cards: total signups, sender count, business count, driver count, last 7 days
    - Show skeleton loading state while fetching
    - _Requirements: 6.1, 6.2, 5.5_

  - [x] 8.3 Create `apps/admin/app/components/waitlist/toolbar.tsx`
    - Search input with 300ms debounce
    - User type filter dropdown (All, Sender, Business, Driver)
    - Source filter dropdown (populated from distinct values or hardcoded known sources)
    - Column visibility toggle dropdown
    - Export button
    - _Requirements: 2.3, 3.4, 4.3, 5.9, 7.1_

  - [x] 8.4 Create `apps/admin/app/components/waitlist/data-table.tsx`
    - TanStack Table in `manualPagination`, `manualSorting`, `manualFiltering` mode
    - Wire column sorting to URL params (click header toggles asc/desc)
    - Display sort direction arrow icons on active column
    - Show skeleton rows during loading
    - Show error state with retry button on API failure
    - Show empty state when no results match
    - _Requirements: 5.1, 5.5, 5.6, 5.7, 5.8, 8.1, 8.2, 8.3_

  - [x] 8.5 Create `apps/admin/app/components/waitlist/pagination.tsx`
    - Previous/next page buttons with disabled states at boundaries
    - Current page and total pages display (e.g., "Page 2 of 8")
    - Record range display (e.g., "Showing 21–40 of 156")
    - Page size selector with options: 10, 20, 50, 100
    - Page size change resets to page 1
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10_

- [ ] 9. Implement CSV export functionality
  - [x] 9.1 Create `apps/admin/app/lib/export-csv.ts`
    - Implement `exportWaitlistCsv(data, filename)` utility
    - Generate CSV with columns: Full Name, Email, User Type, Source, Signup Date
    - Sanitize cell values to prevent CSV formula injection (prefix cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` with a single quote)
    - Trigger browser download with filename format `waitlist-export-YYYY-MM-DD.csv`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 9.2 Write property test for CSV export completeness
    - **Property 8: CSV export completeness** — generate random signups, export to CSV string, parse back and verify one row per record with correct field values
    - **Validates: Requirements 7.2**

- [ ] 10. Create the waitlist route page and wire everything together
  - [x] 10.1 Create `apps/admin/app/routes/waitlist.tsx` route component
    - Compose `WaitlistStatsCards`, `WaitlistToolbar`, `WaitlistDataTable`, and `WaitlistPagination`
    - Wire `useWaitlistParams` to all child components for state management
    - Wire `useWaitlistData` with current params for table data
    - Wire `useWaitlistStats` for stats cards
    - Wire export button to fetch all filtered records (no pagination) and call `exportWaitlistCsv`
    - Wrap in React error boundary with fallback UI
    - _Requirements: 5.3, 5.6, 5.8, 7.1_

  - [x] 10.2 Register the `/waitlist` route in `apps/admin/app/routes.ts`
    - Add `route('waitlist', 'routes/waitlist.tsx')` inside the layout group
    - _Requirements: 5.3_

  - [x] 10.3 Add "Waitlist" navigation link to the admin sidebar
    - Add a "Waitlist" item to the sidebar navigation in `apps/admin/app/components/app-sidebar.tsx` under an appropriate section (e.g., Operations or a new "Growth" section)
    - Use an appropriate lucide-react icon (e.g., `ClipboardList` or `UserPlus`)
    - _Requirements: 5.4_

- [x] 11. Final checkpoint - Ensure all tests pass and integration works
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementations use TypeScript with Zod, Drizzle, Hono, and React
- Database migration should be applied via Supabase MCP or CLI (not Drizzle push)
