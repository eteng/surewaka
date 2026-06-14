# Storage Provider Abstraction

**Date:** 2026-06-14
**Status:** Approved
**Author:** Eteng + Claude

## Context

SureWaka currently calls Supabase Storage directly in two places — `apps/api/src/lib/storage.ts` (stub, never wired) and `apps/api/src/services/profile-service.ts` (live avatar upload). The goal is to reduce Supabase lock-in by moving storage to purpose-fit providers while keeping the codebase decoupled from any specific vendor.

## Decision

Split storage by access pattern:

- **Public images (avatars)** → Cloudinary — CDN, auto-WebP conversion, face-aware crop, free tier covers Lagos launch
- **Private documents (KYC, delivery photos)** → Cloudflare R2 — S3-compatible, zero egress fees, signed URLs

Both sit behind a thin provider interface so swapping either is a one-file change.

## Architecture

### Interface (packages/shared)

`packages/shared/src/storage.ts` — types only, no SDK imports:

```typescript
export type StorageFile = {
  buffer: Buffer
  mimeType: string
  path: string        // storage path or Cloudinary public_id
}

export type PublicUploadResult = {
  url: string         // CDN URL stored in DB
  path: string        // path used for deletion
}

export type PublicStorageProvider = {
  upload(file: StorageFile): Promise<PublicUploadResult>
  delete(path: string): Promise<void>
}

export type PrivateStorageProvider = {
  upload(file: StorageFile): Promise<{ path: string }>
  delete(path: string): Promise<void>
  getSignedUrl(path: string, expiresIn?: number): Promise<string>
}
```

The type split (`PublicStorageProvider` vs `PrivateStorageProvider`) makes it impossible to accidentally call `getSignedUrl` on a public provider or get a public URL from a private one.

### File Structure (apps/api)

```
apps/api/src/lib/storage/
  index.ts          ← singleton exports: avatarStorage, documentStorage
  cloudinary.ts     ← PublicStorageProvider (Cloudinary)
  r2.ts             ← PrivateStorageProvider (Cloudflare R2)
```

Replaces `apps/api/src/lib/storage.ts` (deleted — functions were never wired to routes).

### Implementations

**Cloudinary** (`cloudinary.ts`):
- Avatar path is always `avatars/{userId}` — deterministic, `overwrite: true` on upload
- Upload applies: format `webp`, quality `auto`, crop `fill` 400×400 with `face` gravity
- Delete calls `cloudinary.uploader.destroy('avatars/{userId}')`
- Env var validation at provider initialisation — API fails fast at startup if misconfigured

**R2** (`r2.ts`):
- S3Client pointed at `R2_ENDPOINT` with R2 credentials
- Single bucket `surewaka-private`, folder prefixes per use case: `kyc/`, `delivery/`
- `getSignedUrl` uses `@aws-sdk/s3-request-presigner`, default 1h expiry
- Env var validation at provider initialisation

**Singletons** (`index.ts`):
```typescript
export const avatarStorage: PublicStorageProvider = createCloudinaryProvider()
export const documentStorage: PrivateStorageProvider = createR2Provider()
```

Callers import the singleton — never import Cloudinary or AWS SDK directly.

### profile-service.ts changes

`generateAvatarPath()` is removed. The Supabase URL-parsing block (`split('/storage/v1/object/public/avatars/')`) is removed.

Upload flow becomes:
```typescript
const { url } = await avatarStorage.upload({
  buffer: file.buffer,
  mimeType: file.mimeType,
  path: `avatars/${userId}`,
})
```

Delete flow becomes:
```typescript
await avatarStorage.delete(`avatars/${userId}`)
```

`createServiceClient()` import is retained — still needed for `syncAvatarMetadata` (Supabase Auth, not storage).

## Error Handling

- Both providers throw a `StorageError` (`{ code, message }`) on failure. `profile-service.ts` catches and maps to its existing `ServiceResult` error shape.
- Delete on old avatar remains non-critical (log only). Deterministic paths mean a failed delete doesn't orphan an unknown file — Cloudinary overwrites on next upload anyway.
- Missing env vars cause a startup crash with a clear message, not a silent runtime failure.
- R2 signed URL expiry is caller-controlled. No retry logic — client re-requests if expired.

## Dependencies

Added to `apps/api/package.json`:
```
cloudinary
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
```

## Env Vars

Added to `.env.example`:
```
# Cloudinary (public images — avatars)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Cloudflare R2 (private documents — KYC, delivery photos)
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=surewaka-private
```

## What Is Not In Scope

- KYC document upload routes (not yet built — R2 provider is ready, routes come later)
- Delivery photo upload routes (same)
- Migrating existing Supabase-stored avatars (users re-upload naturally; old URLs stay valid until Supabase bucket is decommissioned)
- Moving auth off Supabase (separate decision)
