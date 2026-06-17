# Implementation Plan: Profile Avatar Upload

## Overview

Implement avatar upload and display for the SureWaka mobile customer app. Users can select or capture an image, which is resized to 256×256 JPEG 80% quality, uploaded to Supabase Storage, and displayed on the profile screens using `expo-image` with caching. The implementation follows the existing patterns in `useCustomerProfile` and integrates into the Edit Profile and Profile Tab screens.

## Tasks

- [x] 1. Create Supabase migration for avatars storage bucket
  - [x] 1.1 Create migration file with `supabase migration new create_avatars_bucket`
    - Create the `avatars` storage bucket (public, 5MB limit, allowed MIME types: image/jpeg, image/png, image/webp)
    - Add RLS policies: public SELECT, user-scoped INSERT/UPDATE/DELETE using `auth.uid()::text = (storage.foldername(name))[1]`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 2. Implement image processing utility
  - [x] 2.1 Create `apps/mobile-customer/app/utils/image-processing.ts`
    - Implement `processAvatarImage(uri: string)` function
    - Use `expo-image-manipulator` to resize to 256×256 (center crop) and compress to JPEG 80% quality
    - Return a Blob with `mimeType: 'image/jpeg'`
    - Handle images of any input dimensions and aspect ratios
    - _Requirements: 1.2, 1.3, 2.6_

  - [ ]* 2.2 Write property test: image processing produces valid output
    - **Property 1: Image processing produces valid output**
    - Use `fast-check` to generate arbitrary image dimensions and verify output is JPEG ≤256×256
    - **Validates: Requirements 1.2, 1.3, 2.6**

  - [ ]* 2.3 Write property test: storage path follows user-scoped convention
    - **Property 2: Storage path follows user-scoped convention**
    - Use `fast-check` to generate UUID user IDs and verify path is `{user_id}/avatar.jpg`
    - **Validates: Requirements 2.1**

- [x] 3. Implement `useAvatarPicker` hook
  - [x] 3.1 Create `apps/mobile-customer/app/hooks/use-avatar-picker.ts`
    - Implement `pickFromLibrary()` — request media library permissions, launch picker with 256×256 max, return local URI or null
    - Implement `pickFromCamera()` — request camera permissions, launch camera with 256×256 max, return local URI or null
    - Implement `showActionSheet(hasExistingAvatar: boolean)` — show options (Choose from Library, Take Photo, and Remove Photo if avatar exists)
    - Handle permission denial with informative toast message directing to device settings
    - Handle cancellation by returning null (no state change)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1_

- [x] 4. Extend `useCustomerProfile` hook with avatar methods
  - [x] 4.1 Add `avatarUrl` field to `CustomerProfile` type and fetch logic
    - Map `avatar_url` from the database row to `avatarUrl` in the profile state
    - _Requirements: 6.1_

  - [x] 4.2 Implement `updateAvatar(localUri: string)` method
    - Call `processAvatarImage` to resize/compress
    - Upload to Supabase Storage at `{user_id}/avatar.jpg` with `upsert: true`
    - On success, build public URL with `?t={Date.now()}` cache-bust param
    - Update `users.avatar_url` in the database
    - Update local profile state optimistically (no refetch needed)
    - Expose `isUploadingAvatar` boolean state
    - On failure, show error toast and retain previous avatar (no state change)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 6.2, 6.4_

  - [x] 4.3 Implement `removeAvatar()` method
    - Delete file from Storage at `{user_id}/avatar.jpg`
    - Set `avatar_url` to null in the database
    - Update local profile state to `avatarUrl: null`
    - On failure, show error toast and retain current avatar
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.3, 6.4_

  - [ ]* 4.4 Write property test: failed or cancelled operations preserve state
    - **Property 3: Failed or cancelled operations preserve state**
    - Use `fast-check` to generate profile states and simulate failures, verify state is unchanged
    - **Validates: Requirements 1.4, 2.5, 5.5**

  - [ ]* 4.5 Write property test: upload-then-fetch round-trip
    - **Property 4: Upload-then-fetch round-trip**
    - Use `fast-check` with mocked Supabase to verify `avatarUrl` contains `{user_id}/avatar.jpg` after upload
    - **Validates: Requirements 2.3, 6.5**

  - [ ]* 4.6 Write property test: cache-busting URL uniqueness
    - **Property 5: Cache-busting URL uniqueness**
    - Use `fast-check` to generate pairs of timestamps and verify resulting URLs are different strings
    - **Validates: Requirements 3.4**

  - [ ]* 4.7 Write property test: optimistic state update on successful mutation
    - **Property 6: Optimistic state update on successful mutation**
    - Use `fast-check` to verify local state reflects new avatar URL immediately after mutation resolves
    - **Validates: Requirements 6.4**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create `AvatarPicker` component
  - [x] 6.1 Create `apps/mobile-customer/app/components/avatar-picker.tsx`
    - Accept props: `avatarUrl`, `isUploading`, `onPickImage`, `size` (default 96)
    - Display avatar image using `expo-image` with `cachePolicy: 'disk'` when `avatarUrl` is set
    - Display 👤 placeholder emoji on green background when `avatarUrl` is null or image fails to load
    - Show `ActivityIndicator` overlay when `isUploading` is true
    - Wrap in `Pressable` that calls `onPickImage` on tap
    - Render in circular frame (rounded-full)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 2.2_

  - [ ]* 6.2 Write unit tests for `AvatarPicker`
    - Test placeholder renders when `avatarUrl` is null
    - Test image renders when `avatarUrl` is provided
    - Test loading overlay shows when `isUploading` is true
    - Test `onPickImage` called on press
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

- [x] 7. Update Edit Profile screen
  - [x] 7.1 Integrate `AvatarPicker` and `useAvatarPicker` into `apps/mobile-customer/app/profile/edit.tsx`
    - Replace the static avatar placeholder with the `AvatarPicker` component
    - Wire `onPickImage` to `showActionSheet` from `useAvatarPicker`
    - On image selection (library or camera), call `updateAvatar` from the profile hook
    - On "Remove Photo" selection, call `removeAvatar` from the profile hook
    - Pass `isUploadingAvatar` to `AvatarPicker` for loading state
    - Ensure Save button waits for avatar upload to complete before submitting other profile changes
    - _Requirements: 1.1, 2.2, 2.7, 5.1_

- [x] 8. Update Profile Tab to display avatar
  - [x] 8.1 Update `apps/mobile-customer/app/(tabs)/profile.tsx` to show real avatar
    - Replace the static 👤 placeholder with `expo-image` when `avatarUrl` is available
    - Use circular frame matching existing 80px (w-20 h-20) size
    - Use `cachePolicy: 'disk'` for caching
    - Fall back to 👤 placeholder when `avatarUrl` is null or image fails to load
    - _Requirements: 3.1, 3.3, 3.5, 3.6_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` and validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- The Supabase migration must be applied manually (or via CI) — the task creates the SQL file only
- `expo-image-manipulator` is needed for image processing — verify it's installed or add it
