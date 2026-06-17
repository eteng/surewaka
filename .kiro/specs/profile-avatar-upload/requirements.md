# Requirements Document

## Introduction

This feature adds avatar image functionality to the SureWaka mobile customer app. Users can pick an image from their device library or capture a photo using the camera, upload it to Supabase Storage, and have it displayed as their profile avatar across the app (edit profile screen and profile tab).

## Glossary

- **Avatar_Upload_Service**: The client-side logic responsible for selecting, compressing, uploading, and persisting avatar images
- **Image_Picker**: The expo-image-picker module that presents the device media library or camera interface
- **Storage_Bucket**: The Supabase Storage bucket (`avatars`) that stores uploaded avatar image files
- **Profile_Hook**: The `useCustomerProfile` hook that manages profile state and mutations
- **Edit_Profile_Screen**: The screen at `apps/mobile-customer/app/profile/edit.tsx` where users edit their profile
- **Profile_Tab**: The tab screen at `apps/mobile-customer/app/(tabs)/profile.tsx` showing the user's profile overview
- **Avatar_Image**: The optimized image component (expo-image) used to display the avatar with caching

## Requirements

### Requirement 1: Image Selection

**User Story:** As a customer, I want to choose an avatar image from my photo library or take a new photo, so that I can personalize my profile.

#### Acceptance Criteria

1. WHEN the user taps the avatar area on the Edit_Profile_Screen, THE Image_Picker SHALL present options to choose from the photo library or take a photo with the camera
2. WHEN the user selects an image from the photo library, THE Image_Picker SHALL request a maximum resolution of 256×256 pixels; IF the device does not honor the constraint, THEN THE Avatar_Upload_Service SHALL resize the image client-side to 256×256 before upload
3. WHEN the user captures a photo with the camera, THE Image_Picker SHALL request a maximum resolution of 256×256 pixels; IF the device does not honor the constraint, THEN THE Avatar_Upload_Service SHALL resize the image client-side to 256×256 before upload
4. WHEN the user cancels the image selection, THE Avatar_Upload_Service SHALL retain the current avatar and take no further action
5. IF the user denies camera or media library permissions, THEN THE Avatar_Upload_Service SHALL display an informative message explaining how to grant access in device settings

### Requirement 2: Image Upload

**User Story:** As a customer, I want my selected avatar image uploaded to cloud storage, so that it persists across devices and sessions.

#### Acceptance Criteria

1. WHEN an image is selected, THE Avatar_Upload_Service SHALL upload the image to the Storage_Bucket at the path `{user_id}/avatar.jpg` (always JPEG regardless of source format)
2. WHILE the upload is in progress, THE Edit_Profile_Screen SHALL display a loading indicator over the avatar area
3. WHEN the upload completes successfully, THE Avatar_Upload_Service SHALL update the `avatar_url` column in the `users` table with the public URL of the uploaded image, appending a cache-busting timestamp query parameter (e.g., `?t={unix_timestamp}`)
4. IF a previous avatar exists in the Storage_Bucket for the same user, THEN THE Avatar_Upload_Service SHALL overwrite the existing file using upsert
5. IF the upload fails due to a network error, THEN THE Avatar_Upload_Service SHALL display an error toast and retain the previous avatar; THE `avatar_url` column SHALL NOT be updated until the upload is confirmed successful
6. THE Avatar_Upload_Service SHALL compress images to JPEG format with 80% quality before uploading to reduce file size
7. IF the user taps Save while an avatar upload is still in progress, THE Edit_Profile_Screen SHALL wait for the upload to complete before submitting other profile changes

### Requirement 3: Avatar Display

**User Story:** As a customer, I want to see my avatar image on my profile screens, so that I can confirm it was uploaded correctly and see my personalized profile.

#### Acceptance Criteria

1. WHEN `avatar_url` is present in the user profile, THE Profile_Tab SHALL display the avatar image in a circular frame instead of the placeholder emoji
2. WHEN `avatar_url` is present in the user profile, THE Edit_Profile_Screen SHALL display the avatar image in a circular frame instead of the placeholder emoji
3. THE Avatar_Image SHALL use disk and memory caching to avoid re-downloading the image on every screen visit
4. WHEN a new avatar is uploaded, THE Avatar_Image SHALL invalidate the cached version and display the newly uploaded image immediately (using the cache-busting timestamp in the URL)
5. WHILE the avatar image is loading, THE Avatar_Image SHALL display the green placeholder background until the image is ready
6. IF the avatar image fails to load (broken URL or network error), THEN THE Avatar_Image SHALL fall back to displaying the 👤 placeholder emoji

### Requirement 4: Storage Bucket and Security

**User Story:** As a platform operator, I want avatar storage to be secure and scoped to individual users, so that users cannot access or modify other users' avatars.

#### Acceptance Criteria

1. THE Storage_Bucket SHALL be created via a Supabase migration with the name `avatars` and configured as a public bucket (publicly readable)
2. THE Storage_Bucket SHALL enforce Row Level Security policies that allow authenticated users to upload only to their own path (`{user_id}/*`)
3. THE Storage_Bucket SHALL allow unauthenticated public read access to all avatar files so that avatars can be rendered via public URLs without requiring authentication tokens (avatars are not sensitive data)
4. THE Storage_Bucket SHALL restrict file uploads to image MIME types (`image/jpeg`, `image/png`, `image/webp`)
5. THE Storage_Bucket SHALL enforce a maximum file size of 5 MB per upload

### Requirement 5: Avatar Removal

**User Story:** As a customer, I want to remove my avatar and revert to the default placeholder, so that I can control my profile appearance.

#### Acceptance Criteria

1. WHEN the user taps the avatar area on the Edit_Profile_Screen AND an avatar is currently set, THE action sheet SHALL include a "Remove Photo" option alongside "Choose from Library" and "Take Photo"
2. WHEN the user selects "Remove Photo", THE Avatar_Upload_Service SHALL delete the avatar file from the Storage_Bucket at the user's path
3. WHEN the file is deleted successfully, THE Avatar_Upload_Service SHALL set the `avatar_url` column in the `users` table to `null`
4. WHEN the avatar is removed, THE Profile_Tab and Edit_Profile_Screen SHALL immediately revert to displaying the 👤 placeholder emoji
5. IF the deletion fails due to a network error, THEN THE Avatar_Upload_Service SHALL display an error toast and retain the current avatar

### Requirement 6: Profile Data Integration

**User Story:** As a developer, I want the avatar URL integrated into the existing profile data flow, so that avatar state is consistent with other profile fields.

#### Acceptance Criteria

1. THE Profile_Hook SHALL include `avatarUrl` as a field in the `CustomerProfile` type
2. THE Profile_Hook SHALL expose an `updateAvatar` method that accepts a local image URI and performs the upload and database update
3. THE Profile_Hook SHALL expose a `removeAvatar` method that deletes the file from storage and sets `avatar_url` to null in the database
4. WHEN the avatar is updated or removed successfully, THE Profile_Hook SHALL update the local profile state immediately without requiring a full refetch
5. FOR ALL valid image URIs, uploading then fetching the profile SHALL return the same avatar URL (round-trip property)
