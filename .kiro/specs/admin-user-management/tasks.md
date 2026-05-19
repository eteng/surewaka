# Implementation Plan: Admin User Management

## Overview

This plan implements the admin user management feature for the SureWaka admin portal. It adds employee invitation (via Supabase Auth), listing with search/filter/pagination, profile editing, account deactivation/reactivation, role assignment/revocation (delegating to existing RoleService), and audit history viewing.

The implementation follows existing patterns: Hono routes with `requireAuth` + `requireRole('surewaka_admin')` middleware, Drizzle ORM queries, Zod validators in `@surewaka/shared`, and React Router v7 SPA pages in `apps/admin`.

## Tasks

- [x] 1. Add Zod validators to `@surewaka/shared`
  - [x] 1.1 Add user management validators to `packages/shared/src/validators.ts`
    - Add `inviteEmployeeSchema` with fields: email (valid format), fullName (2-100 chars), role (userRoleSchema), scopeType (enum carrier, nullable optional), scopeId (uuid, nullable optional)
    - Add refinement: org-scoped roles (carrier_admin, carrier_driver) require scopeType='carrier' and scopeId
    - Add `updateEmployeeSchema` with optional fields: fullName (2-100 chars), phone (10-15 chars), email (valid format)
    - Add `employeeListQuerySchema` with: page (coerce int, min 1, default 1), pageSize (coerce int, min 1, max 100, default 20), search (max 200, default ''), role (userRoleSchema optional), status (enum active/inactive optional), sortBy (enum name/email/createdAt/updatedAt, default createdAt), sortDir (enum asc/desc, default desc)
    - Add `auditLogQuerySchema` with: page (coerce int, min 1, default 1), pageSize (coerce int, min 1, max 100, default 20)
    - Export types: `InviteEmployeeInput`, `UpdateEmployeeInput`, `EmployeeListQuery`, `AuditLogQuery`
    - _Requirements: 1.5, 1.6, 2.4, 3.3, 6.4_

  - [x] 1.2 Write property tests for invitation validator
    - **Property 3: Invitation validation rejects invalid inputs**
    - For any invitation request where email is invalid, fullName is outside 2-100 chars, role is not a valid enum value, or an org-scoped role is missing scopeType/scopeId, the schema SHALL reject
    - **Validates: Requirements 1.5, 1.6**

  - [x] 1.3 Write property tests for pagination validator
    - **Property 6: Pagination respects page size bounds**
    - For any page and pageSize parameters (1 ≤ pageSize ≤ 100), the schema SHALL accept; values outside bounds SHALL be rejected; default pageSize SHALL be 20
    - **Validates: Requirements 2.4, 6.4**

- [x] 2. Implement User Management Service
  - [x] 2.1 Create `apps/api/src/services/user-management-service.ts` with types and `inviteEmployee` function
    - Define types: `InviteEmployeeParams`, `ListEmployeesParams`, `UpdateEmployeeParams`, `DeactivateEmployeeParams`, `ReactivateEmployeeParams`, `EmployeeListItem`, `EmployeeDetail`, `AuditLogEntry`, `ServiceResult<T>`
    - Implement `inviteEmployee(params)`:
      - Check email uniqueness in users table (return CONFLICT 409 if exists)
      - Call Supabase Auth `inviteUserByEmail` (return INVITATION_FAILED 502 on failure, no DB records created)
      - Begin DB transaction: insert user record (email, name, verified=false), call RoleService `assignRole` with role/scope
      - Commit transaction and return created employee detail
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8_

  - [x] 2.2 Write property tests for invitation logic
    - **Property 1: Invitation creates correct user and role records**
    - For any valid invitation input, the created user SHALL have the provided email, name, verified=false, and exactly one active role matching the requested role with correct scope
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - **Property 2: Duplicate email invitation is rejected**
    - For any email that already exists, inviting with that email SHALL return CONFLICT and SHALL NOT create any new records
    - **Validates: Requirements 1.4**
    - **Property 4: Failed Supabase invitation creates no records**
    - For any valid input, if Supabase Auth fails, no user record or role assignment SHALL be created
    - **Validates: Requirements 1.7**

  - [x] 2.3 Implement `listEmployees` function in user-management-service
    - Query users table joined with user_roles (only users with at least one role record)
    - Apply search filter: ILIKE on name, email, phone
    - Apply role filter: EXISTS in user_roles where role matches and isActive=true
    - Apply status filter: verified=true for active, verified=false for inactive
    - Apply sorting by specified field and direction
    - Apply pagination with LIMIT/OFFSET
    - Return total count for metadata
    - Aggregate active roles per user in response
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.4 Write property tests for employee list
    - **Property 5: Employee list search returns only matching results**
    - For any search query, all returned employees SHALL have the search string as a case-insensitive substring of name, email, or phone; role/status filters SHALL also be respected
    - **Validates: Requirements 2.2, 2.3**
    - **Property 7: Employee list only returns users with role assignments**
    - For any query, every returned user SHALL have at least one record in user_roles; users with zero role records SHALL never appear
    - **Validates: Requirements 2.7**
    - **Property 8: Employee list sorting is correct**
    - For any sortBy field and sortDir, the returned list SHALL be ordered according to the specified field and direction
    - **Validates: Requirements 2.5**

  - [x] 2.5 Implement `getEmployee` function in user-management-service
    - Query user by ID with active roles and carrier names for org-scoped roles
    - Return 404 NOT_FOUND if user does not exist
    - Return EmployeeDetail with avatarUrl, carriers array resolved from carriers table
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 2.6 Implement `updateEmployee` function in user-management-service
    - Validate target user exists (404 if not)
    - Check email uniqueness against other users (409 CONFLICT if duplicate)
    - Check phone uniqueness against other users (409 CONFLICT if duplicate)
    - Update only specified fields, preserve unmodified fields
    - Set `updated_at` to current timestamp
    - Return updated employee detail
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7_

  - [x] 2.7 Write property tests for update logic
    - **Property 9: Update preserves unmodified fields and sets updated_at**
    - For any valid partial update, only specified fields SHALL change; unspecified fields SHALL remain unchanged; updated_at SHALL be ≥ time before update
    - **Validates: Requirements 3.1, 3.2, 3.6**
    - **Property 10: Update validation rejects invalid inputs**
    - For any update where fullName is outside 2-100 chars, phone is outside 10-15 chars, or email is invalid, the service SHALL reject with VALIDATION_ERROR
    - **Validates: Requirements 3.3**
    - **Property 11: Update rejects duplicate email or phone**
    - For any update setting an email or phone already belonging to a different user, the service SHALL return CONFLICT (409)
    - **Validates: Requirements 3.4, 3.5**

  - [x] 2.8 Implement `deactivateEmployee` and `reactivateEmployee` functions
    - `deactivateEmployee`:
      - Check performedBy !== userId (return SELF_DEACTIVATION_NOT_ALLOWED 400 if same)
      - Begin transaction: set verified=false on user, set isActive=false on all active user_roles, create audit log entry for each revoked role with reason 'Account deactivated by admin'
      - Update Supabase Auth app_metadata to remove all roles (set roles to empty)
      - Commit transaction
    - `reactivateEmployee`:
      - Set verified=true on user record
      - Roles remain empty (must be re-assigned separately)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7_

  - [x] 2.9 Write property tests for deactivation/reactivation
    - **Property 12: Deactivation revokes all roles and creates audit entries**
    - For any active employee with N active roles, deactivation SHALL set verified=false, set isActive=false on all N roles, and create exactly N audit entries with action='revoked'
    - **Validates: Requirements 4.1, 4.3**
    - **Property 13: Self-deactivation is rejected**
    - For any admin where performedBy === userId, deactivation SHALL return SELF_DEACTIVATION_NOT_ALLOWED and SHALL NOT modify any records
    - **Validates: Requirements 4.6**
    - **Property 14: Reactivation sets verified to true**
    - For any deactivated employee, reactivation SHALL set verified=true; role set SHALL remain empty
    - **Validates: Requirements 4.4**

  - [x] 2.10 Implement `getEmployeeAuditLog` function in user-management-service
    - Query role_audit_log joined with users (for performedBy name resolution)
    - Filter by target userId
    - Sort by createdAt descending (most recent first)
    - Paginate with LIMIT/OFFSET
    - Return total count for metadata
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 2.11 Write property test for audit log
    - **Property 15: Audit records filtered by user and sorted descending**
    - For any user ID, the audit log SHALL return only records where userId matches, sorted by createdAt descending
    - **Validates: Requirements 6.1, 6.3**

- [x] 3. Implement API routes
  - [x] 3.1 Create `apps/api/src/routes/admin/users.ts` with all 7 endpoints
    - Apply `requireAuth` + `requireRole('surewaka_admin')` middleware to all routes
    - `POST /invite` — validate body with inviteEmployeeSchema, call inviteEmployee, return 201
    - `GET /` — validate query with employeeListQuerySchema, call listEmployees, return 200 with meta
    - `GET /:userId` — call getEmployee, return 200
    - `PATCH /:userId` — validate body with updateEmployeeSchema, call updateEmployee, return 200
    - `POST /:userId/deactivate` — call deactivateEmployee with user.id as performedBy, return 200
    - `POST /:userId/reactivate` — call reactivateEmployee with user.id as performedBy, return 200
    - `GET /:userId/audit-log` — validate query with auditLogQuerySchema, call getEmployeeAuditLog, return 200 with meta
    - Handle all error codes with correct HTTP status mapping
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 4.4, 5.1, 5.2, 6.1, 7.1, 7.2_

  - [x] 3.2 Register user management routes in `apps/api/src/index.ts`
    - Import userManagement routes from `./routes/admin/users`
    - Mount at `/api/v1/admin/users`
    - _Requirements: 7.1, 7.2_

  - [x] 3.3 Write property test for access control
    - **Property 16: Access control rejects non-admin users**
    - For any authenticated user without surewaka_admin role, ALL user management endpoints SHALL return HTTP 403 with FORBIDDEN
    - **Validates: Requirements 7.1, 7.3**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend hooks and data fetching
  - [x] 5.1 Create `apps/admin/app/hooks/use-employee-params.ts`
    - Parse URL search params for employee list: page, pageSize, search, role, status, sortBy, sortDir
    - Provide setter functions that update URL search params
    - Default values matching employeeListQuerySchema defaults
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 5.2 Create `apps/admin/app/hooks/use-employee-data.ts`
    - Fetch `GET /api/v1/admin/users` with query params from useEmployeeParams
    - Return { data, meta, isLoading, error, refetch }
    - Handle error states and provide retry capability
    - _Requirements: 2.1, 2.6_

  - [x] 5.3 Create `apps/admin/app/hooks/use-employee-detail.ts`
    - Fetch `GET /api/v1/admin/users/:userId` for employee detail
    - Fetch `GET /api/v1/admin/users/:userId/audit-log` for audit history
    - Provide mutation functions: updateEmployee, deactivate, reactivate, assignRole, revokeRole
    - Return { employee, auditLog, isLoading, error, refetch, mutations }
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 6. Frontend components
  - [x] 6.1 Create `apps/admin/app/components/users/employee-toolbar.tsx`
    - Search input with debounced text filtering
    - Role filter dropdown (all roles from USER_ROLES constant)
    - Status filter dropdown (active/inactive/all)
    - Invite Employee button that opens invite dialog
    - _Requirements: 2.2, 2.3_

  - [x] 6.2 Create `apps/admin/app/components/users/employee-data-table.tsx`
    - Sortable columns: name, email, phone, roles (badges), status (active/inactive badge), created date
    - Click row to navigate to employee detail page
    - Sort indicators on column headers
    - Empty state when no employees match filters
    - _Requirements: 2.1, 2.5_

  - [x] 6.3 Create `apps/admin/app/components/users/employee-pagination.tsx`
    - Page navigation (previous/next, page numbers)
    - Display total count and current page range
    - Page size selector
    - _Requirements: 2.4, 2.6_

  - [x] 6.4 Create `apps/admin/app/components/users/invite-dialog.tsx`
    - Modal dialog form with fields: email, full name, role dropdown, conditional carrier dropdown (for org-scoped roles)
    - Client-side validation matching inviteEmployeeSchema
    - Submit calls POST /api/v1/admin/users/invite
    - Success/error feedback and dialog close on success
    - Carrier dropdown populated from carriers table (fetch carriers list)
    - _Requirements: 1.1, 1.5, 1.6, 5.4_

  - [x] 6.5 Create `apps/admin/app/components/users/role-assignment-panel.tsx`
    - Display all available roles with descriptions
    - Indicate currently active roles for the employee
    - Assign role button with carrier dropdown for org-scoped roles
    - Revoke role button with reason input
    - Delegates to existing assignRole/revokeRole API calls
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 6.6 Create `apps/admin/app/components/users/audit-history.tsx`
    - Display audit log entries: action badge (assigned/revoked/upgraded), role, performed by name, reason, scope info, timestamp
    - Paginated with load more or pagination controls
    - Empty state message when no audit records exist
    - _Requirements: 6.1, 6.2, 6.5, 6.6_

  - [x] 6.7 Create `apps/admin/app/components/users/employee-actions.tsx`
    - Deactivate button with confirmation dialog (warns about role revocation)
    - Reactivate button with prompt to re-assign roles
    - Self-deactivation prevention (disable button if viewing own account)
    - _Requirements: 4.1, 4.4, 4.5, 4.6_

- [x] 7. Frontend pages
  - [x] 7.1 Create `apps/admin/app/routes/users.tsx` (Employee List page)
    - Compose: EmployeeToolbar, EmployeeDataTable, EmployeePagination, InviteDialog
    - Use useEmployeeParams and useEmployeeData hooks
    - Loading skeleton while data fetches
    - Wrap in RoleGate for surewaka_admin access
    - _Requirements: 2.1, 7.4, 7.5_

  - [x] 7.2 Create `apps/admin/app/routes/users.$userId.tsx` (Employee Detail page)
    - Profile section: name, email, phone, account status, avatar, creation/update dates
    - Role Assignment Panel component
    - Audit History section
    - Employee Actions (edit, deactivate/reactivate)
    - Use useEmployeeDetail hook
    - Wrap in RoleGate for surewaka_admin access
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.3 Add navigation entry for User Management in admin sidebar
    - Add "Users" link to nav-main.tsx (visible only for surewaka_admin via RoleGate)
    - Route to `/users`
    - _Requirements: 7.4, 7.5_

  - [x] 7.4 Register routes in `apps/admin/app/routes.ts`
    - Add route entry for `users.tsx` at `/users`
    - Add route entry for `users.$userId.tsx` at `/users/:userId`
    - _Requirements: 7.4_

- [x] 8. Integration wiring
  - [x] 8.1 Wire role assignment/revocation through User Management routes
    - Ensure POST /:userId/deactivate calls RoleService.revokeRole for each active role
    - Ensure role assignment panel calls existing assignRole/revokeRole endpoints (or delegates through user management service)
    - Verify syncRolesToAuth is called after role changes (existing RoleService behavior)
    - _Requirements: 5.1, 5.2, 5.7_

  - [x] 8.2 Handle carrier name resolution for org-scoped roles
    - In getEmployee, join with carriers table to resolve carrier names for display
    - In role assignment panel, fetch carriers list for dropdown
    - _Requirements: 5.4, 8.4_

  - [x] 8.3 Write integration tests for transaction atomicity
    - Test invitation: force failure mid-transaction, verify no partial records created
    - Test deactivation: force failure mid-transaction, verify all-or-nothing behavior
    - Test middleware chain: verify requireAuth + requireRole applied to all routes
    - _Requirements: 1.7, 1.8, 4.7, 7.1, 7.2_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 16 universal correctness properties from the design document
- No new database tables or migrations needed — uses existing users, user_roles, role_audit_log, carriers tables
- Role assignment/revocation delegates to existing RoleService (no reimplementation)
- Supabase Auth `inviteUserByEmail` is called before the DB transaction (fail-fast pattern)
- Auth metadata sync is fire-and-forget (non-throwing) per existing RoleService behavior
