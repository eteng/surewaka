# Requirements Document

## Introduction

The User Profile Management feature enables SureWaka internal users (ops team, support agents, admins) to view their enrolled details and manage personal preferences through the admin portal (`apps/admin`). Users are added/invited by administrators and assigned roles — they cannot self-register. The feature allows users to upload an avatar, configure notification preferences, and view their profile details (name, email, phone, role) as read-only. Name changes (e.g., spelling corrections, marriage) are handled via a change request workflow that requires admin approval.

## Glossary

- **Profile_Service**: The API service layer handling profile retrieval, avatar management, notification preferences, and name change requests
- **Profile_Page**: The React Router v7 route in `apps/admin` where users view and manage their profile
- **Avatar_Storage**: The Supabase Storage bucket (`avatars`) used to store user profile images
- **Users_Table**: The existing `public.users` Postgres table, extended with profile columns (`avatar_url`, `notification_email`, `notification_sms`)
- **Profile_Validator**: The Zod schemas in `@surewaka/shared` that validate profile update requests
- **Auth_Metadata_Sync**: The process of updating Supabase Auth `user_metadata` (avatar_url) after profile changes
- **Name_Change_Request**: A request submitted by a user to change their display name, requiring admin approval before taking effect

## Requirements

### Requirement 1: Profile Data Storage

**User Story:** As an internal user, I want my profile information stored reliably, so that my avatar and notification preferences persist across sessions and devices.

#### Acceptance Criteria

1. THE Profile_Service SHALL extend the existing Users_Table with new columns: `avatar_url` (text, nullable), `notification_email` (boolean, default true), and `notification_sms` (boolean, default true)
2. THE Users_Table already contains `id`, `email`, `phone`, `name`, `role`, `verified`, `created_at`, and `updated_at` — these fields are managed by admins and are read-only to the user
3. WHEN a profile is updated (avatar or notification preferences), THEN THE Users_Table SHALL update the `updated_at` timestamp
4. THE Profile_Service SHALL use the existing user record (created when admin invites/adds the user) — no self-registration or profile auto-creation logic is needed

### Requirement 2: Name Change Request

**User Story:** As an internal user, I want to request a name change (e.g., spelling correction, marriage), so that my profile reflects my correct name after admin approval.

#### Acceptance Criteria

1. WHEN a user submits a name change request, THEN THE Profile_Validator SHALL validate that the requested name is between 2 and 100 characters
2. WHEN a user submits a name change request, THEN THE Profile_Validator SHALL reject names containing only whitespace
3. WHEN a valid name change request is submitted, THEN THE Profile_Service SHALL create a pending name change request record with the requested name and a reason field
4. THE Profile_Service SHALL NOT directly update the `name` column — name changes require admin approval
5. WHEN an admin approves a name change request, THEN THE Profile_Service SHALL update the `name` column in the Users_Table and sync to Auth_Metadata
6. WHEN an admin rejects a name change request, THEN THE Profile_Service SHALL mark the request as rejected with an optional reason
7. THE Profile_Page SHALL display the status of any pending name change request to the user

### Requirement 3: Avatar Upload and Management

**User Story:** As an internal user, I want to upload and manage my profile photo, so that my account feels personalized and colleagues can identify me.

#### Acceptance Criteria

1. WHEN a customer uploads an avatar, THEN THE Profile_Validator SHALL accept only JPEG, PNG, and WebP image formats
2. WHEN a customer uploads an avatar, THEN THE Profile_Validator SHALL reject files larger than 2 MB
3. WHEN a valid avatar file is uploaded, THEN THE Avatar_Storage SHALL store the file in the `avatars` bucket with the path `{user_id}/{timestamp}.{extension}`
4. WHEN a new avatar is stored, THEN THE Profile_Service SHALL update the `avatar_url` column in the Users_Table with the public URL of the uploaded file
5. WHEN a new avatar is stored, THEN THE Auth_Metadata_Sync SHALL update Supabase Auth `user_metadata.avatar_url` to match the new URL
6. WHEN a customer uploads a new avatar and a previous avatar exists, THEN THE Avatar_Storage SHALL delete the previous avatar file from the bucket
7. WHEN a customer removes their avatar without uploading a replacement, THEN THE Profile_Service SHALL set `avatar_url` to null in the Users_Table and clear `user_metadata.avatar_url`
8. IF the file upload to Avatar_Storage fails, THEN THE Profile_Service SHALL return HTTP 500 with a descriptive error message and not update the database

### Requirement 4: Account Settings Management

**User Story:** As an internal user, I want to manage my notification preferences, so that I receive communications in my preferred format.

#### Acceptance Criteria

1. WHEN a user updates notification preferences, THEN THE Profile_Validator SHALL accept boolean values for `notification_email` and `notification_sms`
2. WHEN valid account settings are submitted, THEN THE Profile_Service SHALL update the corresponding columns in the Users_Table
3. THE Profile_Service SHALL allow partial updates to account settings without requiring all fields to be present
4. WHEN account settings are updated, THEN THE Profile_Service SHALL return the complete updated profile object

### Requirement 5: Profile Retrieval

**User Story:** As an internal user, I want to view my enrolled details, so that I can see my current information and verify it's correct.

#### Acceptance Criteria

1. WHEN an authenticated user requests their profile, THEN THE Profile_Service SHALL return the complete profile object including `name` (read-only), `avatar_url`, `notification_email`, `notification_sms`, `role` (read-only), and `updated_at`
2. WHEN an authenticated user requests their profile, THEN THE Profile_Service SHALL return the user record from the Users_Table
3. THE Profile_Service SHALL include the user's email and phone (masked) from the Users_Table in the profile response for display purposes
4. THE Profile_Service SHALL require a valid authentication token for all profile operations

### Requirement 6: Profile API Authorization

**User Story:** As a platform developer, I want profile endpoints secured so that users can only access and modify their own profile data.

#### Acceptance Criteria

1. THE Profile_Service SHALL expose endpoints under `/api/v1/profile` requiring authentication via the `requireAuth` middleware
2. WHEN an authenticated user accesses profile endpoints, THEN THE Profile_Service SHALL scope all operations to the authenticated user's ID extracted from the JWT
3. THE Profile_Service SHALL not accept a `user_id` parameter in requests to prevent users from modifying other users' profiles
4. WHEN an unauthenticated request reaches a profile endpoint, THEN THE Profile_Service SHALL return HTTP 401 with error code `UNAUTHORIZED`

### Requirement 7: Profile Page UI

**User Story:** As an internal user, I want a clear and accessible profile page, so that I can easily view my details and manage my preferences.

#### Acceptance Criteria

1. THE Profile_Page SHALL display the current avatar (or a default placeholder), name (read-only), email (read-only), phone (read-only, masked), and role (read-only)
2. THE Profile_Page SHALL provide an avatar upload control that previews the selected image before submission
3. THE Profile_Page SHALL display notification preference toggles for email and SMS
4. THE Profile_Page SHALL provide a "Request Name Change" action that opens a form with the new name and reason fields
5. THE Profile_Page SHALL display the status of any pending name change request (pending/approved/rejected)
6. WHEN a profile update is in progress, THEN THE Profile_Page SHALL display a loading indicator and disable the submit control
7. WHEN a profile update fails, THEN THE Profile_Page SHALL display an error message describing the failure
8. WHEN a profile update succeeds, THEN THE Profile_Page SHALL display a success confirmation and reflect the updated data immediately

### Requirement 8: Avatar Image Validation (Round-Trip)

**User Story:** As a platform developer, I want avatar URLs stored in the database to always resolve to valid images, so that the UI never displays broken image links.

#### Acceptance Criteria

1. FOR ALL valid avatar uploads, storing the file and then retrieving the stored URL SHALL return the original image content (round-trip property)
2. THE Profile_Validator SHALL reject avatar file names containing path traversal characters (`..`, `/`, `\`)
3. WHEN generating the avatar storage path, THEN THE Profile_Service SHALL sanitize the file extension by allowing only `jpg`, `jpeg`, `png`, and `webp`
