# Implementation Plan: User Profile Management

## Overview

This plan implements the user profile management feature for the SureWaka admin portal. It extends the existing `public.users` table with profile columns, introduces a `name_change_requests` table, adds API endpoints for self-service profile management and admin name-change approval, and creates the frontend profile page at `/settings/profile`.

The implementation follows existing patterns: Hono routes with `requireAuth` middleware, Drizzle ORM, Zod validators in `@surewaka/shared`, and Supabase Storage for avatar uploads.

## Tasks

- [x] 1. Database schema and validators
  - [x] 1.1 Apply Supabase migration to add profile columns and name_change_requests table
    - Add `avatar_url` (text, nullable), `notification_email` (boolean, default true), `notification_sms` (boolean, default true) to `public.users`
    - Create `name_change_status` enum (`pending`, `approved`, `rejected`)
    - Create `name_change_requests` table with columns: `id`, `user_id`, `current_name`, `requested_name`, `reason`, `status`, `reviewed_by`, `reviewed_at`, `created_at`
    - Add indexes on `status` and `user_id`
    - _Requirements: 1.1, 1.2, 2.3_

  - [x] 1.2 Update Drizzle schema in `packages/db/src/schema.ts` through migration procedure
    - Add `nameChangeStatusEnum` pgEnum
    - Add `avatarUrl`, `notificationEmail`, `notificationSms` columns to `users` table
    - Add `nameChangeRequests` table definition with all columns and foreign keys
    - _Requirements: 1.1, 2.3_

  - [x] 1.3 Add profile validators to `packages/shared/src/validators.ts`
    - Add `ALLOWED_AVATAR_TYPES`, `ALLOWED_AVATAR_EXTENSIONS`, `MAX_AVATAR_SIZE_BYTES` constants
    - Add `profilePreferencesUpdateSchema` (optional booleans for notificationEmail, notificationSms)
    - Add `avatarFileSchema` (filename path-traversal check, mimeType enum, size max)
    - Add `nameChangeRequestSchema` (requestedName 2-100 chars, no whitespace-only; reason 3-500 chars)
    - Add `nameChangeReviewSchema` (status enum, optional reviewNote)
    - Export all types
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 4.1, 8.2_

  - [ ]* 1.4 Write property tests for validators
    - **Property 1: Name Change Request Validation** — for any string, validator accepts iff trimmed length is 2–100 and not all whitespace
    - **Validates: Requirements 2.1, 2.2**
    - **Property 4: Avatar File Validation** — for any (mimeType, size), validator accepts iff mimeType ∈ {image/jpeg, image/png, image/webp} AND size ≤ 2,097,152
    - **Validates: Requirements 3.1, 3.2**
    - **Property 6: Avatar Filename Path Traversal Rejection** — for any filename containing `..`, `/`, or `\`, validator rejects
    - **Validates: Requirements 8.2**

- [x] 2. Profile service and utility functions
  - [x] 2.1 Create `apps/api/src/services/profile-service.ts`
    - Implement `maskPhone` utility (preserve last 4 digits, replace other digits with `*`, keep non-digit chars)
    - Implement `generateAvatarPath(userId, extension)` returning `{userId}/{timestamp}.{extension}` with sanitized extension
    - Implement `syncAvatarMetadata(userId, avatarUrl)` using Supabase Auth admin API (non-throwing)
    - Implement `getProfile(userId)` — query user + pending name change request, mask phone, return `ProfileResponse`
    - Implement `updatePreferences(userId, data)` — partial update of notification columns, return updated profile
    - Implement `uploadAvatar(userId, file)` — validate file, upload to Supabase Storage `avatars` bucket, delete old avatar if exists, update DB, sync auth metadata
    - Implement `removeAvatar(userId)` — delete from storage, set `avatar_url` to null, sync auth metadata
    - Implement `submitNameChangeRequest(userId, data)` — check no pending request exists (409 if so), insert record
    - _Requirements: 1.3, 2.3, 2.4, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_

  - [ ]* 2.2 Write property tests for utility functions
    - **Property 5: Avatar Storage Path Format and Sanitization** — for any UUID and extension string, path matches `{userId}/{timestamp}.{ext}` where ext ∈ {jpg, jpeg, png, webp}
    - **Validates: Requirements 3.3, 8.3**
    - **Property 7: Phone Number Masking** — for any phone string length > 4, last 4 chars preserved, other digits replaced with `*`, non-digits preserved
    - **Validates: Requirements 5.3**

  - [x] 2.3 Create `apps/api/src/services/name-change-service.ts`
    - Implement `listPending()` — query all pending name change requests with user name
    - Implement `review(requestId, adminId, decision)` — update status, set reviewedBy/reviewedAt; if approved, update user name + sync auth metadata
    - _Requirements: 2.5, 2.6_

  - [ ]* 2.4 Write property test for name change approval
    - **Property 10: Name Change Approval Updates Name** — after approval, user's name column equals the requestedName from the approved request
    - **Validates: Requirements 2.5**

- [x] 3. API routes
  - [x] 3.1 Create `apps/api/src/routes/profile.ts` with user self-service endpoints
    - `GET /api/v1/profile` — call `profileService.getProfile(user.id)` from context
    - `PATCH /api/v1/profile` — validate body with `profilePreferencesUpdateSchema`, call `updatePreferences`
    - `POST /api/v1/profile/avatar` — parse multipart form, validate with `avatarFileSchema`, call `uploadAvatar`
    - `DELETE /api/v1/profile/avatar` — call `removeAvatar`
    - `POST /api/v1/profile/name-change-request` — validate body with `nameChangeRequestSchema`, call `submitNameChangeRequest`
    - All routes use `requireAuth` middleware, extract `user.id` from context (never from request body)
    - _Requirements: 5.4, 6.1, 6.2, 6.3, 6.4_

  - [x] 3.2 Create `apps/api/src/routes/admin/name-change-requests.ts` with admin endpoints
    - `GET /api/v1/admin/name-change-requests` — call `nameChangeService.listPending()`
    - `PATCH /api/v1/admin/name-change-requests/:id` — validate body with `nameChangeReviewSchema`, call `review`
    - Routes use `requireAuth` + `requireMfa` middleware + admin role check
    - _Requirements: 2.5, 2.6_

  - [x] 3.3 Register new routes in `apps/api/src/index.ts`
    - Import and mount profile routes at `/api/v1/profile`
    - Import and mount admin name-change-requests routes at `/api/v1/admin/name-change-requests`
    - _Requirements: 6.1_

  - [ ]* 3.4 Write property test for JWT user scoping
    - **Property 8: Profile Operations Scoped to JWT User** — for any request, all DB operations use exclusively the user ID from the JWT, ignoring any userId in body/query
    - **Validates: Requirements 6.2, 6.3**

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend profile page
  - [x] 5.1 Create `apps/admin/app/hooks/use-profile.ts`
    - Fetch profile data from `GET /api/v1/profile`
    - Provide mutation functions for preference updates, avatar upload/remove, name change request submission
    - Handle loading, error, and success states
    - _Requirements: 5.1, 7.6, 7.7, 7.8_

  - [x] 5.2 Create `apps/admin/app/components/profile/avatar-upload.tsx`
    - Display current avatar or default placeholder
    - File input restricted to JPEG, PNG, WebP (max 2 MB)
    - Preview selected image before submission
    - Upload and remove actions with loading states
    - _Requirements: 3.1, 3.2, 7.2_

  - [x] 5.3 Create `apps/admin/app/components/profile/notification-settings.tsx`
    - Toggle switches for email and SMS notification preferences
    - Auto-save on toggle change (or explicit save button)
    - Show success/error feedback
    - _Requirements: 4.1, 4.2, 7.3_

  - [x] 5.4 Create `apps/admin/app/components/profile/name-change-form.tsx`
    - Form with "Requested Name" and "Reason" fields
    - Client-side validation matching `nameChangeRequestSchema`
    - Display pending request status if one exists
    - Disable form when a pending request is active
    - _Requirements: 2.1, 2.2, 2.7, 7.4, 7.5_

  - [x] 5.5 Create `apps/admin/app/routes/settings/profile.tsx` page
    - Display read-only fields: name, email, phone (masked), role
    - Compose avatar-upload, notification-settings, and name-change-form components
    - Loading skeleton while profile data fetches
    - Error boundary for failed loads
    - _Requirements: 7.1, 7.6, 7.7, 7.8_

  - [x] 5.6 Add route entry for `/settings/profile` in `apps/admin/app/routes.ts`
    - Register the new settings/profile route
    - _Requirements: 7.1_

- [x] 6. Admin name change management page
  - [x] 6.1 Create `apps/admin/app/routes/settings/name-changes.tsx`
    - List pending name change requests (current name, requested name, reason, date)
    - Approve/reject actions with optional review note
    - Admin-only access (role check in component)
    - _Requirements: 2.5, 2.6, 2.7_

- [x] 7. Integration wiring and edge cases
  - [x] 7.1 Handle storage failure atomicity in profile service
    - Ensure avatar upload failure does not modify `avatar_url` in DB
    - Wrap storage upload + DB update in correct order (upload first, then DB write)
    - _Requirements: 3.8_

  - [x] 7.2 Handle conflict detection for duplicate name change requests
    - Check for existing pending request before insert
    - Return 409 with "A name change request is already pending" message
    - _Requirements: 2.3_

  - [ ]* 7.3 Write property tests for service-level properties
    - **Property 2: Read-Only Fields Invariant** — for any sequence of profile operations, name/email/phone/role remain unchanged
    - **Validates: Requirements 1.2, 2.4**
    - **Property 3: Preference Update Round-Trip with Partial Preservation** — partial updates preserve unspecified fields
    - **Validates: Requirements 4.2, 4.3**
    - **Property 11: Storage Failure Atomicity** — if storage upload fails, avatar_url remains unchanged
    - **Validates: Requirements 3.8**

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (11 total)
- The project uses Supabase migrations for DDL — task 1.1 applies the migration, task 1.2 keeps Drizzle schema in sync
- Avatar storage uses Supabase Storage with public bucket access
- Auth metadata sync is fire-and-forget (non-throwing) per design
