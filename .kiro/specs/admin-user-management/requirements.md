# Requirements Document

## Introduction

The Admin User Management feature provides surewaka_admin users with a comprehensive interface to invite, manage, and control employee access on the SureWaka platform. It leverages the existing RBAC system for role assignment and permission enforcement, adding an invitation workflow (via Supabase Auth email invites), employee lifecycle management (view, edit, deactivate/reactivate), and role administration with full audit trail visibility. This feature lives in the `apps/admin` portal and communicates with the API at `apps/api`.

## Glossary

- **Admin_Portal**: The `apps/admin` React Router v7 SPA used by SureWaka internal operations staff
- **User_Management_Service**: The API service handling employee invitation, listing, editing, deactivation, and role operations
- **Employee**: Any user in the `users` table who holds a non-customer role (i.e., a team member managed by surewaka_admin)
- **Invitation_Service**: The component responsible for sending email invitations via Supabase Auth `inviteUserByEmail`
- **Employee_List**: The paginated, searchable UI view displaying all managed employees
- **Role_Assignment_Panel**: The UI component for assigning and revoking roles on a specific employee
- **Audit_History_View**: The UI component displaying role change history from the `role_audit_log` table
- **RBAC_System**: The existing role-based access control system (middleware, role service, database tables)

## Requirements

### Requirement 1: Employee Invitation via Email

**User Story:** As a surewaka_admin, I want to invite new team members via email, so that they can join the platform with a pre-assigned role without needing to self-register.

#### Acceptance Criteria

1. WHEN a surewaka_admin submits an invitation request with a valid email, full name, and target role, THEN THE Invitation_Service SHALL send an email invitation via Supabase Auth `inviteUserByEmail`
2. WHEN the invitation is sent successfully, THEN THE User_Management_Service SHALL create a record in the `users` table with the provided email, name, and `verified = false`
3. WHEN the invitation is sent successfully, THEN THE User_Management_Service SHALL assign the specified role to the new user via the RBAC_System
4. IF the provided email already exists in the `users` table, THEN THE User_Management_Service SHALL return HTTP 409 with error code `CONFLICT` and message indicating the user already exists
5. WHEN an org-scoped role (`carrier_admin` or `carrier_driver`) is specified, THEN THE Invitation_Service SHALL require a valid `scopeId` (carrier ID) in the request
6. THE User_Management_Service SHALL validate invitation requests using a Zod schema requiring: email (valid format), fullName (2-100 chars), role (valid user_role enum value), and optional scopeType/scopeId
7. WHEN the Supabase Auth invitation fails, THEN THE User_Management_Service SHALL return HTTP 502 with error code `INVITATION_FAILED` and not create any database records
8. THE User_Management_Service SHALL execute the user creation and role assignment within a single database transaction

### Requirement 2: Employee List with Search and Filtering

**User Story:** As a surewaka_admin, I want to view a paginated list of all employees with search and filter capabilities, so that I can quickly find and manage team members.

#### Acceptance Criteria

1. THE Employee_List SHALL display employees with columns: name, email, phone, active roles, account status (active/inactive), and creation date
2. WHEN a surewaka_admin provides a search query, THEN THE User_Management_Service SHALL filter employees by partial match on name, email, or phone
3. THE User_Management_Service SHALL support filtering employees by role, account status (active/inactive), and creation date range
4. THE User_Management_Service SHALL return paginated results with a default page size of 20 and a maximum of 100 per page
5. THE User_Management_Service SHALL support sorting by name, email, creation date, or last updated date in ascending or descending order
6. WHEN the Employee_List is loaded, THEN THE Admin_Portal SHALL display the total count of matching employees in the response metadata
7. THE User_Management_Service SHALL only return users who have at least one record in the `user_roles` table (excluding pure customers with no role assignments)

### Requirement 3: Edit Employee Details

**User Story:** As a surewaka_admin, I want to edit an employee's profile details, so that I can keep team member information accurate and up to date.

#### Acceptance Criteria

1. WHEN a surewaka_admin submits an update for an employee, THEN THE User_Management_Service SHALL update the specified fields in the `users` table
2. THE User_Management_Service SHALL allow editing of: full name, phone number, and email
3. THE User_Management_Service SHALL validate update requests using a Zod schema with: fullName (2-100 chars, optional), phone (valid format, optional), email (valid email format, optional)
4. IF the updated email already belongs to another user, THEN THE User_Management_Service SHALL return HTTP 409 with error code `CONFLICT`
5. IF the updated phone already belongs to another user, THEN THE User_Management_Service SHALL return HTTP 409 with error code `CONFLICT`
6. WHEN an update is successful, THEN THE User_Management_Service SHALL set the `updated_at` timestamp to the current time
7. IF the target user does not exist, THEN THE User_Management_Service SHALL return HTTP 404 with error code `NOT_FOUND`

### Requirement 4: Deactivate and Reactivate Employee Accounts

**User Story:** As a surewaka_admin, I want to deactivate and reactivate employee accounts, so that I can control platform access when employees leave or return.

#### Acceptance Criteria

1. WHEN a surewaka_admin deactivates an employee, THEN THE User_Management_Service SHALL set `verified = false` on the user record and revoke all active roles in the `user_roles` table
2. WHEN a surewaka_admin deactivates an employee, THEN THE User_Management_Service SHALL update the user's Supabase Auth metadata to remove all roles (setting `app_metadata.roles` to empty)
3. WHEN a surewaka_admin deactivates an employee, THEN THE User_Management_Service SHALL log each role revocation in the `role_audit_log` with reason `'Account deactivated by admin'`
4. WHEN a surewaka_admin reactivates an employee, THEN THE User_Management_Service SHALL set `verified = true` on the user record
5. WHEN a surewaka_admin reactivates an employee, THEN THE Admin_Portal SHALL prompt the admin to re-assign roles before completing reactivation
6. IF a surewaka_admin attempts to deactivate their own account, THEN THE User_Management_Service SHALL return HTTP 400 with error code `SELF_DEACTIVATION_NOT_ALLOWED`
7. THE User_Management_Service SHALL execute deactivation (user update + all role revocations + audit logs) within a single database transaction

### Requirement 5: Role Assignment and Revocation

**User Story:** As a surewaka_admin, I want to assign and revoke roles for employees using the existing RBAC system, so that I can control what each team member can access on the platform.

#### Acceptance Criteria

1. WHEN a surewaka_admin assigns a role to an employee, THEN THE User_Management_Service SHALL delegate to the existing RBAC_System Role_Service `assignRole` operation
2. WHEN a surewaka_admin revokes a role from an employee, THEN THE User_Management_Service SHALL delegate to the existing RBAC_System Role_Service `revokeRole` operation
3. THE Role_Assignment_Panel SHALL display all available roles with descriptions and indicate which roles are currently active for the employee
4. WHEN assigning an org-scoped role, THEN THE Role_Assignment_Panel SHALL present a carrier selection dropdown populated from the `carriers` table
5. THE User_Management_Service SHALL validate role assignment requests against the existing `assignRoleSchema` from `@surewaka/shared`
6. THE User_Management_Service SHALL validate role revocation requests against the existing `revokeRoleSchema` from `@surewaka/shared`
7. WHEN a role is assigned or revoked, THEN THE RBAC_System SHALL sync the updated roles to Supabase Auth `app_metadata` as defined in the existing Role_Sync process
8. WHEN a duplicate active role assignment is attempted, THEN THE User_Management_Service SHALL return HTTP 409 with error code `CONFLICT`

### Requirement 6: Role Assignment Audit History

**User Story:** As a surewaka_admin, I want to view the role assignment history for any employee, so that I can audit who granted or revoked access and when.

#### Acceptance Criteria

1. THE Audit_History_View SHALL display role change records from the `role_audit_log` table for a specific employee
2. THE Audit_History_View SHALL show: action (assigned/revoked/upgraded), role, performed by (admin name), reason, scope information, and timestamp
3. THE User_Management_Service SHALL return audit records sorted by creation date in descending order (most recent first)
4. THE User_Management_Service SHALL support pagination of audit records with a default page size of 20
5. THE Audit_History_View SHALL resolve the `performed_by` user ID to a display name for readability
6. WHEN no audit records exist for an employee, THEN THE Audit_History_View SHALL display an empty state message indicating no role changes have been recorded

### Requirement 7: Access Control for User Management

**User Story:** As a platform architect, I want user management endpoints restricted to surewaka_admin only, so that unauthorized users cannot manage employee accounts.

#### Acceptance Criteria

1. THE User_Management_Service SHALL require the `surewaka_admin` role for all user management API endpoints
2. THE User_Management_Service SHALL use the existing `requireAuth` and `requireRole('surewaka_admin')` middleware chain on all routes
3. WHEN a non-surewaka_admin user attempts to access any user management endpoint, THEN THE User_Management_Service SHALL return HTTP 403 with error code `FORBIDDEN`
4. THE Admin_Portal SHALL hide user management navigation and UI elements for users who do not hold the `surewaka_admin` role
5. THE Admin_Portal SHALL use the existing `RoleGate` component to conditionally render user management features

### Requirement 8: Employee Detail View

**User Story:** As a surewaka_admin, I want to view a comprehensive detail page for each employee, so that I can see their profile, active roles, and audit history in one place.

#### Acceptance Criteria

1. THE Admin_Portal SHALL display an employee detail page showing: profile information (name, email, phone), account status, creation date, and last updated date
2. THE Admin_Portal SHALL display all active roles for the employee with scope information (carrier name for org-scoped roles)
3. THE Admin_Portal SHALL provide inline actions for: editing details, assigning/revoking roles, and deactivating/reactivating the account
4. WHEN an employee has org-scoped roles, THEN THE Admin_Portal SHALL display the associated carrier name resolved from the `carriers` table
5. THE Admin_Portal SHALL display the role audit history for the employee on the same detail page
