# Implementation Plan: RBAC System

## Overview

Implement a Role-Based Access Control system for SureWaka's multi-app logistics platform. The system manages six roles (`customer`, `driver`, `carrier_driver`, `carrier_admin`, `support_agent`, `surewaka_admin`) with dual storage (Postgres `user_roles` table + Supabase `app_metadata`), API middleware guards, org-scoped access control, and frontend role awareness.

Implementation follows an incremental approach: shared types/constants → database schema → API middleware → role service → API routes → frontend components → RLS policies → tests.

## Tasks

- [x] 1. Define role types, permissions, and validators in shared package
  - [x] 1.1 Add role constants and permission types to `packages/shared/src/constants.ts`
    - Add `USER_ROLES` array constant with all six roles
    - Add `UserRole` type derived from the array
    - Add `Permission` union type with all permission strings
    - Add `ROLE_PERMISSIONS` constant map (`Record<UserRole, Permission[]>`)
    - _Requirements: 1.1, 2.6_

  - [x] 1.2 Add role-related Zod validators to `packages/shared/src/validators.ts`
    - Add `userRoleSchema` (z.enum of USER_ROLES)
    - Add `assignRoleSchema` with refinement for org-scoped roles requiring scopeType + scopeId
    - Add `revokeRoleSchema` requiring reason string
    - Add `onboardCarrierDriverSchema` with Nigerian phone regex and fullName
    - Export inferred types: `AssignRoleInput`, `RevokeRoleInput`, `OnboardCarrierDriverInput`
    - _Requirements: 4.5, 4.6, 5.5_

  - [x] 1.3 Update domain types in `packages/shared/src/types.ts`
    - Replace existing `UserRole` type with the new six-role version
    - Add `UserRoleRecord` type matching the `user_roles` table shape
    - Add `AppMetadata` type (`{ roles, primary_role, carrier_id? }`)
    - Add `RoleAuditEntry` type matching the `role_audit_log` table shape
    - _Requirements: 1.1, 1.5_

- [x] 2. Create database schema for RBAC tables in `packages/db/src/schema.ts`
  - [x] 2.1 Update `userRoleEnum` and add `carrierMemberRoleEnum`
    - Replace existing 4-value `userRoleEnum` with the six RBAC roles
    - Add `carrierMemberRoleEnum` with `carrier_admin` and `carrier_driver`
    - _Requirements: 1.1_

  - [x] 2.2 Add `user_roles` table with constraints and indexes
    - Define columns: id, userId, role, scopeType, scopeId, assignedBy, assignedAt, revokedAt, isActive
    - Add partial unique constraint on `(userId, role, scopeId)` where `is_active = true`
    - Add composite index on `(userId, isActive)`
    - _Requirements: 1.2, 1.6, 1.7, 1.8_

  - [x] 2.3 Add `role_audit_log` table
    - Define columns: id, userId, role, action, scopeType, scopeId, performedBy, reason, createdAt
    - No update/delete operations — append-only by design
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 2.4 Update `carriers` table to match RBAC design
    - Add slug, logoUrl, isVerified, isActive, verifiedAt, verifiedBy columns
    - Ensure references to users table for verifiedBy
    - _Requirements: 3.6_

  - [x] 2.5 Add `carrier_members` table with constraints
    - Define columns: id, carrierId, userId, role, invitedBy, joinedAt, leftAt, isActive
    - Add partial unique constraint on `(carrierId, userId)` where `is_active = true`
    - _Requirements: 3.6, 5.3_

- [x] 3. Checkpoint - Ensure schema compiles and types are consistent
  - Ensure all tests pass, ask the user if questions arise.
  - Run `pnpm build` to verify shared package and db package compile without errors.

- [x] 4. Implement API middleware for role and scope checks
  - [x] 4.1 Create `requireRole` middleware in `apps/api/src/middleware/role.ts`
    - Extract roles from `user.app_metadata.roles`, default to `['customer']` if missing
    - Implement `surewaka_admin` hierarchy bypass (always grants access)
    - Return 403 with `{ code: 'FORBIDDEN' }` when user lacks required roles
    - Set `userRoles` on Hono context for downstream use
    - Must execute after `requireAuth` in the middleware chain
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 4.2 Create `requireCarrierScope` middleware in `apps/api/src/middleware/carrier-scope.ts`
    - Extract `carrierId` from route params, return 400 if missing
    - Bypass scope check for `surewaka_admin`
    - Query `carrier_members` table for active membership (userId + carrierId + isActive)
    - Return 403 if user is not an active member of the carrier
    - Set `carrierMembership` on Hono context
    - Must execute after `requireRole` in the middleware chain
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.3 Write property tests for role middleware
    - **Property 1: Role Hierarchy Bypass** — surewaka_admin always passes any role check
    - **Property 12: Access Denial Without Required Roles** — users without required roles get 403
    - **Validates: Requirements 2.3, 2.4, 8.4, 8.5**

  - [x] 4.4 Write property tests for carrier scope middleware
    - **Property 3: Scope Isolation** — org-scoped users denied access to other carriers
    - **Validates: Requirements 3.1, 3.4, 5.4**

- [x] 5. Implement Role Service business logic
  - [x] 5.1 Create `apps/api/src/services/role-service.ts` with core operations
    - Implement `assignRole`: insert into user_roles, validate org-scoped roles require scope fields
    - Implement `revokeRole`: set is_active=false and revoked_at on matching record
    - Implement `upgradeRole`: assign new role + log as 'upgraded'
    - Implement `getUserRoles`: query active roles for a user
    - Implement `getUsersByRole`: query users by role (with optional scopeId filter)
    - Implement `hasRole`: check if user has specific active role
    - Enforce: only surewaka_admin can assign surewaka_admin or support_agent
    - Return 409 Conflict on duplicate active role assignment
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_

  - [x] 5.2 Implement role sync to Supabase Auth in the role service
    - After every role mutation, query all active roles from user_roles
    - Update user's `app_metadata` via `supabaseAdmin.auth.admin.updateUserById`
    - Set `roles` array, `primary_role` (first in list), and `carrier_id` for org-scoped roles
    - Default to `['customer']` when no active roles exist
    - On sync failure: return success, log error for retry
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.3 Implement audit logging within role service operations
    - Insert audit log entry on every assign, revoke, and upgrade
    - Record: userId, role, action, scopeType, scopeId, performedBy, reason
    - Ensure exactly one audit entry per mutation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.4 Write property tests for role service
    - **Property 2: No Self-Elevation** — non-admins cannot assign surewaka_admin/support_agent
    - **Property 5: Unique Active Roles** — duplicate active role → 409 Conflict
    - **Property 6: Audit Completeness** — every mutation produces exactly one audit entry
    - **Property 7: Org-Scoped Role Validation** — org roles rejected without scope fields
    - **Validates: Requirements 4.3, 4.4, 4.7, 7.6, 1.7, 1.8**

  - [x] 5.5 Write property test for role sync consistency
    - **Property 4: Sync Consistency** — after sync, app_metadata.roles matches active DB roles
    - **Validates: Requirements 1.3, 6.1, 6.3, 6.4, 9.5**

- [x] 6. Checkpoint - Ensure middleware and service compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement API routes for role management and carrier onboarding
  - [x] 7.1 Create admin role management routes in `apps/api/src/routes/admin/roles.ts`
    - `POST /api/v1/admin/users/:userId/roles` — assign role (surewaka_admin only)
    - `DELETE /api/v1/admin/users/:userId/roles` — revoke role (surewaka_admin only)
    - `GET /api/v1/admin/users/:userId/roles` — list user's roles
    - Validate request bodies with Zod schemas from shared package
    - Wire middleware chain: requireAuth → requireRole('surewaka_admin')
    - _Requirements: 4.1, 4.2, 4.5, 4.6_

  - [x] 7.2 Create carrier driver onboarding route in `apps/api/src/routes/carriers.ts`
    - `POST /api/v1/carriers/:carrierId/drivers/invite` — onboard carrier_driver
    - Middleware chain: requireAuth → requireRole('carrier_admin') → requireCarrierScope
    - Validate with `onboardCarrierDriverSchema`
    - Execute all writes in a single transaction (user creation, role assignment, carrier_members, audit log, sync)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 7.3 Create carrier driver upgrade route
    - `POST /api/v1/admin/users/:userId/upgrade-driver` — upgrade carrier_driver to driver
    - Middleware: requireAuth → requireRole('surewaka_admin')
    - Assign `driver` role (global scope), log as 'upgraded' with reason
    - Sync updated roles to app_metadata
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 7.4 Write property test for onboarding postconditions
    - **Property 10: Onboarding Postconditions** — valid onboarding atomically produces role record + carrier_members + audit log
    - **Validates: Requirements 5.2, 5.3, 7.1**

- [x] 8. Implement frontend role awareness components
  - [x] 8.1 Create `useRoles` hook in `packages/ui/src/hooks/use-roles.ts`
    - Accept user's app_metadata as input
    - Return: roles array, hasRole function, hasAnyRole function
    - Return convenience booleans: isAdmin, isSupport, isDriver, isCarrierAdmin, isCarrierDriver, isCustomer
    - Return carrierId when user has org-scoped role
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 8.2 Create `RoleGate` component in `packages/ui/src/components/role-gate.tsx`
    - Accept props: roles (required roles), userRoles (current user roles), children, fallback
    - Render children if user has any required role OR is surewaka_admin
    - Render fallback (default null) if user lacks access
    - _Requirements: 8.4, 8.5_

  - [x] 8.3 Write property tests for frontend role utilities
    - **Property 8: Multi-Role Support** — users can hold any valid subset of roles simultaneously
    - **Property 11: Role Query Correctness** — hasRole/hasAnyRole return correct boolean values
    - **Validates: Requirements 1.5, 8.2, 8.3**

- [x] 9. Implement Supabase RLS policies for role-based row access
  - [x] 9.1 Create RLS policy SQL migration file
    - `customers_own_deliveries`: customers see only their own deliveries (+ surewaka_admin + support_agent)
    - `drivers_assigned_deliveries`: drivers see deliveries assigned to them
    - `carrier_org_deliveries`: carrier members see deliveries for their carrier
    - `carrier_admin_drivers`: carrier admins manage only their org's carrier_members
    - `support_read_users`: support agents can read all user profiles
    - All policies grant surewaka_admin full access
    - _Requirements: 3.1, 3.4, 8.6_

- [x] 10. Checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify middleware chain works end-to-end: requireAuth → requireRole → requireCarrierScope → handler.

- [x] 11. Write remaining property-based and unit tests
  - [x] 11.1 Write property test for schema validation
    - **Property 13: Schema Validation Rejects Invalid Input** — invalid inputs rejected before DB writes
    - **Validates: Requirements 4.5, 4.6, 5.5**

  - [x] 11.2 Write property test for carrier driver limitation
    - **Property 9: Carrier Driver Limitation** — carrier_driver cannot accept jobs outside their carrier
    - **Validates: Requirements 3.1, 3.4**

  - [x] 11.3 Write unit tests for role middleware edge cases
    - Test: missing roles in JWT defaults to ['customer']
    - Test: empty roles array defaults to ['customer']
    - Test: multiple required roles (OR logic)
    - Test: middleware ordering enforcement
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 11.4 Write unit tests for role service operations
    - Test: assign org-scoped role without scopeId fails
    - Test: revoke sets is_active=false and revoked_at
    - Test: concurrent duplicate assignment returns 409
    - Test: upgrade creates new role + audit log
    - _Requirements: 4.1, 4.2, 4.3, 4.7_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all requirements are covered by implementation tasks.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` library and validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementations follow existing monorepo conventions
- Frontend role checks are UX-only; all security enforcement is server-side (Requirement 8.6)
- RLS policies provide defense-in-depth at the database layer
