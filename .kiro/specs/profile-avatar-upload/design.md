# Design Document — Profile Avatar Upload

## Overview

This feature adds client-side avatar upload and display to the SureWaka mobile customer app. Users select or capture an image via `expo-image-picker`, which is resized to 256×256 and compressed to JPEG 80% quality on-device. The processed image is uploaded directly from the client to Supabase Storage (bypassing the API server), and the resulting public URL is persisted in the `users.avatar_url` column. Avatar display uses `expo-image` with disk/memory caching and cache-busting via a timestamp query parameter.

The feature integrates into the existing `useCustomerProfile` hook by adding `avatarUrl` to `CustomerProfile` and exposing `updateAvatar` / `removeAvatar` mutation methods. A new Supabase migration creates the `avatars` storage bucket with public read access and user-scoped write RLS policies.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Upload path | Client → Supabase Storage directly | Avoids API round-trip for large binary payloads; RLS enforces security |
| Image processing | Client-side resize + compress | Reduces upload size and ensures consistent dimensions |
| Storage path | `{user_id}/avatar.jpg` (overwrite) | Single file per user, upsert avoids orphan cleanup |
| Cache invalidation | Timestamp query param (`?t=...`) | Simple, no CDN purge needed; `expo-image` treats distinct URLs as distinct cache entries |
| Bucket visibility | Public reads, authenticated writes | Avatars are non-sensitive; simplifies rendering without auth tokens |

## Architecture

```mermaid
flowchart TD
    subgraph Mobile Client
        A[Edit Profile Screen] -->|tap avatar| B[Action Sheet]
        B -->|Choose Library| C[expo-image-picker: library]
        B -->|Take Photo| D[expo-image-picker: camera]
        B -->|Remove Photo| E[removeAvatar]
        C --> F[Resize & Compress]
        D --> F
        F --> G[Upload to Supabase Storage]
        G --> H[Update users.avatar_url]
        H --> I[Update local state]
        E --> J[Delete from Storage]
        J --> K[Set avatar_url = null]
        K --> I
    end

    subgraph Supabase
        L[(users table)]
        M[(avatars bucket)]
        G -->|PUT {uid}/avatar.jpg| M
        H -->|UPDATE avatar_url| L
        J -->|DELETE {uid}/avatar.jpg| M
        K -->|UPDATE avatar_url = null| L
    end

    subgraph Display
        N[Profile Tab] -->|read avatar_url| O[expo-image with caching]
        P[Edit Profile Screen] -->|read avatar_url| O
        O -->|cache miss| M
    end
```

### Data Flow

1. User taps avatar → Action Sheet presented
2. User selects source → `expo-image-picker` launches (library or camera)
3. Picker returns local URI → client resizes to 256×256, compresses to JPEG 80%
4. Client uploads blob to `supabase.storage.from('avatars').upload('{uid}/avatar.jpg', blob, { upsert: true })`
5. On success → build public URL with `?t={timestamp}` → update `users.avatar_url`
6. Local profile state updated optimistically → UI re-renders with new image

## Components and Interfaces

### 1. `useCustomerProfile` hook (extended)

```typescript
// Added to existing CustomerProfile type
export type CustomerProfile = {
  // ... existing fields
  avatarUrl: string | null;
};

// Added mutation methods
type UseCustomerProfile = {
  // ... existing methods
  updateAvatar: (localUri: string) => Promise<MutationResult>;
  removeAvatar: () => Promise<MutationResult>;
  isUploadingAvatar: boolean;
};
```

### 2. `AvatarPicker` component

A pressable avatar display that opens an action sheet for image selection.

```typescript
type AvatarPickerProps = {
  avatarUrl: string | null;
  isUploading: boolean;
  onPickImage: () => void;
  size?: number; // defaults to 96 (w-24)
};
```

Responsibilities:
- Display current avatar (via `expo-image`) or placeholder emoji
- Show loading overlay when `isUploading` is true
- Handle tap to trigger action sheet

### 3. `useAvatarPicker` hook

Encapsulates image selection logic (permissions, picker config, action sheet).

```typescript
type UseAvatarPickerReturn = {
  pickFromLibrary: () => Promise<string | null>; // returns local URI or null
  pickFromCamera: () => Promise<string | null>;
  showActionSheet: (hasExistingAvatar: boolean) => void;
};
```

### 4. Image processing utility

```typescript
// apps/mobile-customer/app/utils/image-processing.ts
export async function processAvatarImage(uri: string): Promise<{
  blob: Blob;
  mimeType: 'image/jpeg';
}>;
```

Handles:
- Read image from local URI
- Resize to 256×256 (maintain aspect ratio, crop center)
- Compress to JPEG 80% quality
- Return as Blob ready for upload

### 5. Supabase Storage migration

New migration file creating the `avatars` bucket with:
- Public bucket (readable without auth)
- RLS policies for user-scoped writes
- MIME type and file size constraints

## Data Models

### Updated `users` table (existing column)

The `avatar_url` TEXT column already exists on the `users` table. No schema migration needed for the column itself.

```
avatar_url TEXT | nullable | stores the public URL with cache-bust param
```

Example value: `https://royfgnaiiexvpxapmcdh.supabase.co/storage/v1/object/public/avatars/{uid}/avatar.jpg?t=1719500000`

### Storage bucket: `avatars`

| Property | Value |
|----------|-------|
| Name | `avatars` |
| Public | `true` |
| File size limit | 5 MB |
| Allowed MIME types | `image/jpeg`, `image/png`, `image/webp` |

### Storage path convention

```
avatars/
  └── {user_id}/
       └── avatar.jpg
```

Single file per user. Overwritten on each upload via `upsert: true`.

### RLS Policies (storage.objects)

| Policy | Operation | Rule |
|--------|-----------|------|
| `avatars_public_read` | SELECT | `bucket_id = 'avatars'` (allow all) |
| `avatars_user_insert` | INSERT | `bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]` |
| `avatars_user_update` | UPDATE | `bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]` |
| `avatars_user_delete` | DELETE | `bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]` |

### CustomerProfile type change

```typescript
export type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: Gender | null;
  notificationEmail: boolean;
  notificationSms: boolean;
  pendingEmail: string | null;
  avatarUrl: string | null; // NEW
};
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Image processing produces valid output

*For any* input image (of any dimensions, aspect ratio, and format), processing it through the avatar pipeline SHALL produce a JPEG blob whose decoded dimensions are at most 256×256 pixels.

**Validates: Requirements 1.2, 1.3, 2.6**

### Property 2: Storage path follows user-scoped convention

*For any* valid user ID (UUID format), the constructed storage path SHALL be exactly `{user_id}/avatar.jpg` — containing the user ID as the folder name and `avatar.jpg` as the filename.

**Validates: Requirements 2.1**

### Property 3: Failed or cancelled operations preserve state

*For any* profile state and any avatar operation (upload or removal) that fails or is cancelled, the resulting profile state SHALL be identical to the state before the operation was initiated — no fields are modified.

**Validates: Requirements 1.4, 2.5, 5.5**

### Property 4: Upload-then-fetch round-trip

*For any* valid image URI, after calling `updateAvatar(uri)` and then reading the profile, the returned `avatarUrl` SHALL be a non-null string whose path component contains `{user_id}/avatar.jpg`.

**Validates: Requirements 2.3, 6.5**

### Property 5: Cache-busting URL uniqueness

*For any* two successful avatar uploads performed at different timestamps, the resulting `avatarUrl` values SHALL be different strings (ensuring the image cache is invalidated between uploads).

**Validates: Requirements 3.4**

### Property 6: Optimistic state update on successful mutation

*For any* successful avatar update or removal, the local profile state SHALL reflect the new avatar URL (or null) immediately after the mutation resolves, without requiring a refetch from the database.

**Validates: Requirements 6.4**

## Error Handling

| Scenario | Handling | User Feedback |
|----------|----------|---------------|
| Permission denied (camera/library) | Catch permission status, do not proceed | Toast with message directing to device Settings |
| Image picker cancelled | Return early, no state change | None (silent) |
| Image processing fails | Catch error, do not upload | Toast: "Failed to process image. Please try again." |
| Upload network error | Catch Supabase storage error, do not update DB | Toast: "Upload failed. Check your connection and try again." |
| DB update fails (after upload) | Catch Supabase DB error; file is in storage but URL not persisted | Toast: "Failed to save avatar. Please try again." (next upload will overwrite the orphaned file) |
| Avatar deletion fails | Catch error, retain current state | Toast: "Failed to remove photo. Please try again." |
| Image load fails (display) | expo-image `onError` callback | Show 👤 placeholder emoji fallback |
| File too large (>5MB) | Supabase rejects upload, caught as storage error | Toast: "Image is too large. Please choose a smaller image." |
| Invalid MIME type | Supabase rejects upload | Toast: "Unsupported image format." |

### Error State Recovery

- All errors are non-destructive: the profile state reverts or remains unchanged.
- No partial state: either the full operation (upload + DB update) succeeds, or the state is unchanged.
- Orphaned files (upload succeeded but DB update failed) are harmless — the next upload overwrites them via upsert.

## Testing Strategy

### Property-Based Tests (fast-check)

Property-based testing is appropriate for this feature because the image processing pipeline and state management logic are pure functions with clear input/output behavior. The input space (image dimensions, user IDs, timestamps) is large and benefits from randomized testing.

**Library**: `fast-check` (TypeScript PBT library)
**Configuration**: Minimum 100 iterations per property
**Tag format**: `Feature: profile-avatar-upload, Property {N}: {description}`

Properties to implement:
1. Image processing dimension/format constraint
2. Storage path construction
3. State preservation on failure/cancel
4. Upload-fetch round-trip (with mocked Supabase)
5. Cache-busting URL uniqueness
6. Optimistic state update

### Unit Tests (Jest/React Native Testing Library)

- Action sheet shows correct options based on avatar state
- Loading indicator shows during upload
- Placeholder renders when `avatarUrl` is null
- Image component renders when `avatarUrl` is non-null
- `updateAvatar` calls storage upload with correct params (upsert: true)
- `removeAvatar` calls storage remove then nullifies DB field
- Save button waits for pending upload before submitting

### Integration Tests

- RLS policies: user cannot write to another user's path
- Public read access works without auth token
- Full upload → display cycle on device/simulator

### Migration Validation

- Verify migration SQL creates bucket with correct name, public flag, MIME restrictions, and size limit
- Verify RLS policies are created with correct conditions
