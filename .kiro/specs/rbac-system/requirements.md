# Requirements Document

## Introduction

The RBAC (Role-Based Access Control) system provides fine-grained authorization for SureWaka's multi-app logistics platform. It manages six distinct roles across web, admin, carrier, and mobile applications using a dual-storage strategy (Postgres `user_roles` table + Supabase `app_metadata`) to enable fast JWT-based middleware checks while maintaining queryable, auditable role data.

## Glossary

- **RBAC_System**: The role-based access control system comprising middleware, role service, database tables, and frontend components
- **Role_Middleware**: The `requireRole` Hono middleware that guards API routes by checking user roles from JWT claims
- **Scope_Middleware**: The `requireCarrierScope` Hono middleware that verifies org membership for carrier-scoped routes
- **Role_Service**: The server-side service handling role assignment, revocation, upgrade, querying, and sync operations
- **Role_Sync**: The process of updating Supabase `app_metadata` to match the canonical `user_roles` table
- **Frontend_Role_Context**: The `useRoles` hook and `RoleGate` component providing client-side role awareness
- **Audit_Logger**: The append-only `role_audit_log` table recording all role mutations
- **Carrier_Scope**: The organizational boundary limiting `carrier_admin` and `carrier_driver` permissions to their carrier
- **User_Roles_Table**: The canonical Postgres table storing all active and historical role assignments
- **App_Metadata**: The Supabase Auth `app_metadata` field containing derived role claims embedded in JWTs

## Requirements

### Requirement 1: Role Definition and Storage

**User Story:** As a platform architect, I want roles defined as a fixed set with dual storage, so that authorization checks are fast (JWT) while role data remains queryable and auditable (Postgres).

#### Acceptance Criteria

1. THE RBAC_System SHALL define exactly six roles: `customer`, `driver`, `carrier_driver`, `carrier_admin`, `support_agent`, and `surewaka_admin`
2. THE RBAC_System SHALL store role assignments in the `user_roles` Postgres table as the single source of truth
3. THE RBAC_System SHALL mirror active roles to Supabase `app_metadata` as a derived cache
4. WHEN a user has no active role records in the User_Roles_Table, THEN THE RBAC_System SHALL default to `['customer']` in App_Metadata
5. THE RBAC_System SHALL support multiple simultaneous roles per user
6. THE User_Roles_Table SHALL enforce a unique constraint on `(user_id, role, scope_id)` for active records
7. THE RBAC_System SHALL classify `carrier_admin` and `carrier_driver` as org-scoped roles requiring a `scope_type` of `'carrier'` and a valid `scope_id`
8. THE RBAC_System SHALL classify `customer`, `driver`, `support_agent`, and `surewaka_admin` as global roles with null `scope_type`

### Requirement 2: Role-Based API Access Control

**User Story:** As a platform developer, I want API routes guarded by role middleware, so that only users with appropriate roles can access protected endpoints.

#### Acceptance Criteria

1. THE Role_Middleware SHALL extract user roles from `user.app_metadata.roles` in the JWT claims
2. WHEN the JWT contains no roles or an empty roles array, THEN THE Role_Middleware SHALL default to `['customer']`
3. WHEN a user holds the `surewaka_admin` role, THEN THE Role_Middleware SHALL grant access to any route regardless of required roles
4. WHEN a user does not hold any of the required roles and is not `surewaka_admin`, THEN THE Role_Middleware SHALL return HTTP 403 with error code `FORBIDDEN`
5. THE Role_Middleware SHALL always execute after `requireAuth` in the middleware chain
6. THE RBAC_System SHALL define permissions as a TypeScript constant map (`ROLE_PERMISSIONS`) rather than storing them in the database

### Requirement 3: Org-Scoped Access Control

**User Story:** As a carrier fleet manager, I want my access restricted to my own carrier's resources, so that I cannot view or modify another carrier's data.

#### Acceptance Criteria

1. THE Scope_Middleware SHALL verify that the authenticated user is an active member of the carrier specified in the route parameter
2. WHEN a user with `surewaka_admin` role accesses a carrier-scoped route, THEN THE Scope_Middleware SHALL bypass the membership check
3. WHEN the route parameter `carrierId` is missing, THEN THE Scope_Middleware SHALL return HTTP 400 with error code `BAD_REQUEST`
4. WHEN the user is not an active member of the specified carrier, THEN THE Scope_Middleware SHALL return HTTP 403 with error code `FORBIDDEN`
5. THE Scope_Middleware SHALL always execute after the Role_Middleware in the middleware chain
6. THE Scope_Middleware SHALL query the `carrier_members` table to verify active membership using `user_id`, `carrier_id`, and `is_active = true`

### Requirement 4: Role Assignment and Revocation

**User Story:** As a surewaka_admin, I want to assign and revoke roles for users, so that I can manage platform access as the business requires.

#### Acceptance Criteria

1. WHEN a `surewaka_admin` assigns a role, THEN THE Role_Service SHALL insert a record into the User_Roles_Table with `is_active = true`
2. WHEN a `surewaka_admin` revokes a role, THEN THE Role_Service SHALL set `is_active = false` and `revoked_at` to the current timestamp on the matching record
3. WHEN assigning an org-scoped role (`carrier_admin` or `carrier_driver`), THEN THE Role_Service SHALL require both `scope_type = 'carrier'` and a valid `scope_id`
4. WHEN a non-`surewaka_admin` user attempts to assign `surewaka_admin` or `support_agent`, THEN THE Role_Service SHALL reject the request with HTTP 403
5. THE Role_Service SHALL validate role assignment requests against the `assignRoleSchema` Zod validator
6. THE Role_Service SHALL validate role revocation requests against the `revokeRoleSchema` Zod validator
7. WHEN a duplicate active role assignment is attempted for the same `(user_id, role, scope_id)`, THEN THE RBAC_System SHALL return HTTP 409 Conflict

### Requirement 5: Carrier Driver Onboarding

**User Story:** As a carrier_admin, I want to onboard drivers to my carrier organization, so that they can accept jobs dispatched through my fleet.

#### Acceptance Criteria

1. WHEN a `carrier_admin` invites a driver, THEN THE Role_Service SHALL create the user if they do not exist (using phone number lookup)
2. WHEN a `carrier_admin` invites a driver, THEN THE Role_Service SHALL assign the `carrier_driver` role with `scope_id` set to the carrier's ID
3. WHEN a `carrier_admin` invites a driver, THEN THE Role_Service SHALL insert a record into the `carrier_members` table with `role = 'carrier_driver'`
4. THE Scope_Middleware SHALL verify the `carrier_admin` belongs to the carrier before allowing the onboarding operation
5. THE Role_Service SHALL validate onboarding requests against the `onboardCarrierDriverSchema` Zod validator requiring a valid Nigerian phone number and full name
6. WHEN the onboarding operation completes, THEN THE Role_Service SHALL execute all database writes within a single transaction

### Requirement 6: Role Sync to Supabase Auth

**User Story:** As a platform architect, I want roles synced to Supabase app_metadata after every mutation, so that JWT claims reflect current permissions without requiring a database lookup on every request.

#### Acceptance Criteria

1. WHEN a role is assigned or revoked, THEN THE Role_Sync SHALL update the user's `app_metadata.roles` to match all active roles in the User_Roles_Table
2. WHEN syncing roles, THEN THE Role_Sync SHALL set `app_metadata.primary_role` to the first role in the active roles list
3. WHEN the user has an org-scoped role, THEN THE Role_Sync SHALL set `app_metadata.carrier_id` to the corresponding `scope_id`
4. WHEN no active roles exist for a user, THEN THE Role_Sync SHALL set `app_metadata.roles` to `['customer']`
5. IF the Supabase Auth update fails after a successful database write, THEN THE Role_Service SHALL return success and queue a retry for reconciliation
6. THE RBAC_System SHALL use a background cron job to reconcile any drift between the User_Roles_Table and App_Metadata

### Requirement 7: Audit Logging

**User Story:** As a compliance officer, I want every role change logged immutably, so that I can trace who granted or revoked access and why.

#### Acceptance Criteria

1. WHEN a role is assigned, THEN THE Audit_Logger SHALL insert a record with `action = 'assigned'`, the performer's user ID, and the target user's ID
2. WHEN a role is revoked, THEN THE Audit_Logger SHALL insert a record with `action = 'revoked'`, the performer's user ID, and a reason
3. WHEN a role is upgraded, THEN THE Audit_Logger SHALL insert a record with `action = 'upgraded'`, the performer's user ID, and a reason
4. THE Audit_Logger SHALL record `scope_type` and `scope_id` for org-scoped role changes
5. THE Audit_Logger SHALL be append-only with no update or delete operations permitted
6. WHEN a role mutation occurs, THEN THE Audit_Logger SHALL produce exactly one audit log entry per mutation

### Requirement 8: Frontend Role Awareness

**User Story:** As a frontend developer, I want role-aware hooks and components, so that the UI can conditionally render features based on the user's roles without trusting client-side checks for security.

#### Acceptance Criteria

1. THE Frontend_Role_Context SHALL expose a `useRoles` hook returning the user's roles, convenience booleans (`isAdmin`, `isDriver`, `isCarrierAdmin`, etc.), and a `carrierId` when applicable
2. THE Frontend_Role_Context SHALL provide a `hasRole` function that checks if the user holds a specific role
3. THE Frontend_Role_Context SHALL provide a `hasAnyRole` function that checks if the user holds at least one of the specified roles
4. WHEN a user holds `surewaka_admin`, THEN THE `RoleGate` component SHALL render children regardless of the `roles` prop
5. WHEN a user does not hold any of the roles specified in the `RoleGate` `roles` prop and is not `surewaka_admin`, THEN THE `RoleGate` component SHALL render the fallback content
6. THE RBAC_System SHALL enforce that frontend role checks are UX-only and all security enforcement occurs server-side

### Requirement 9: Carrier Driver to Independent Driver Upgrade

**User Story:** As a carrier_driver, I want to upgrade to an independent driver after completing full platform KYC, so that I can accept jobs from any customer on the platform.

#### Acceptance Criteria

1. WHEN a `carrier_driver` requests an upgrade to `driver`, THEN THE Role_Service SHALL require full platform KYC verification as a precondition
2. WHEN a `carrier_driver` upgrade is approved, THEN THE Role_Service SHALL require `surewaka_admin` authorization to perform the upgrade
3. WHEN the upgrade is performed, THEN THE Role_Service SHALL assign the `driver` role (global scope) to the user
4. WHEN the upgrade is performed, THEN THE Role_Service SHALL log the action as `'upgraded'` in the Audit_Logger with the reason
5. WHEN the upgrade is performed, THEN THE Role_Sync SHALL update App_Metadata to include the new `driver` role

