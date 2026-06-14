# Storage Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct Supabase Storage calls with a provider abstraction — Cloudinary for public images (avatars) and Cloudflare R2 for private documents (KYC, delivery photos).

**Architecture:** Provider interface types live in `packages/shared/src/storage.ts`; Cloudinary and R2 implementations live in `apps/api/src/lib/storage/`; a singleton index exports `avatarStorage` and `documentStorage`. `profile-service.ts` is the only live storage caller today — `apps/api/src/lib/storage.ts` (the old stub) is deleted.

**Tech Stack:** Cloudinary Node SDK (`cloudinary` v2), AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), Vitest for tests.

---

## File Map

**Create:**
- `packages/shared/src/storage.ts` — `StorageFile`, `PublicUploadResult`, `PublicStorageProvider`, `PrivateStorageProvider` types + `StorageError` class
- `apps/api/src/lib/storage/cloudinary.ts` — `PublicStorageProvider` implementation
- `apps/api/src/lib/storage/r2.ts` — `PrivateStorageProvider` implementation
- `apps/api/src/lib/storage/index.ts` — singleton exports (`avatarStorage`, `documentStorage`)
- `apps/api/src/lib/storage/__tests__/cloudinary.test.ts`
- `apps/api/src/lib/storage/__tests__/r2.test.ts`

**Modify:**
- `packages/shared/src/index.ts` — add `export * from './storage'`
- `apps/api/src/services/profile-service.ts` — swap Supabase storage for `avatarStorage`
- `apps/api/package.json` — add three new deps
- `.env.example` — add Cloudinary + R2 env vars
- `CLAUDE.md` — mark storage as done, update packages table
- `.kiro/steering/project-context.md` — update `packages/supabase` description

**Delete:**
- `apps/api/src/lib/storage.ts` — superseded; functions were never wired to any route

---

### Task 1: Install dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add three packages to apps/api/package.json**

In `apps/api/package.json`, update the `"dependencies"` block to add:

```json
"dependencies": {
  "hono": "^4.6.0",
  "@hono/node-server": "^1.13.0",
  "@surewaka/shared": "workspace:*",
  "@surewaka/db": "workspace:*",
  "@surewaka/supabase": "workspace:*",
  "drizzle-orm": "^0.45.2",
  "zod": "^3.23.0",
  "cloudinary": "^2.5.1",
  "@aws-sdk/client-s3": "^3.700.0",
  "@aws-sdk/s3-request-presigner": "^3.700.0"
}
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updated, `cloudinary` and `@aws-sdk/*` packages appear under `apps/api/node_modules`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add cloudinary and aws-sdk deps for storage abstraction"
```

---

### Task 2: Storage interface types in packages/shared

**Files:**
- Create: `packages/shared/src/storage.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the storage types file**

Create `packages/shared/src/storage.ts`:

```typescript
export type StorageFile = {
  buffer: Buffer;
  mimeType: string;
  path: string;
};

export type PublicUploadResult = {
  url: string;
  path: string;
};

export type PublicStorageProvider = {
  upload(file: StorageFile): Promise<PublicUploadResult>;
  delete(path: string): Promise<void>;
};

export type PrivateStorageProvider = {
  upload(file: StorageFile): Promise<{ path: string }>;
  delete(path: string): Promise<void>;
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;
};

export class StorageError extends Error {
  constructor(
    public readonly code: 'UPLOAD_FAILED' | 'DELETE_FAILED' | 'SIGNED_URL_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
```

- [ ] **Step 2: Export from packages/shared index**

In `packages/shared/src/index.ts`, add one line at the end:

```typescript
export * from './storage';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/shared exec tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/storage.ts packages/shared/src/index.ts
git commit -m "feat(shared): add storage provider interface types and StorageError"
```

---

### Task 3: Cloudinary provider (TDD)

**Files:**
- Create (test first): `apps/api/src/lib/storage/__tests__/cloudinary.test.ts`
- Create: `apps/api/src/lib/storage/cloudinary.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/storage/__tests__/cloudinary.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicStorageProvider } from '@surewaka/shared';

const mockUpload = vi.fn();
const mockDestroy = vi.fn();

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: mockUpload,
      destroy: mockDestroy,
    },
  },
}));

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

describe('createCloudinaryProvider', () => {
  let provider: PublicStorageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createCloudinaryProvider } = await import('../cloudinary');
    provider = createCloudinaryProvider();
  });

  describe('upload', () => {
    it('encodes buffer as base64 data URI and calls cloudinary upload with correct options', async () => {
      mockUpload.mockResolvedValueOnce({
        secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/avatars/user-abc.webp',
        public_id: 'avatars/user-abc',
      });

      const result = await provider.upload({
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        path: 'avatars/user-abc',
      });

      expect(mockUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^data:image\/jpeg;base64,/),
        expect.objectContaining({
          public_id: 'avatars/user-abc',
          overwrite: true,
          format: 'webp',
          quality: 'auto',
          transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        }),
      );
      expect(result).toEqual({
        url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/avatars/user-abc.webp',
        path: 'avatars/user-abc',
      });
    });

    it('throws StorageError with UPLOAD_FAILED when cloudinary rejects', async () => {
      mockUpload.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.upload({
          buffer: Buffer.from('x'),
          mimeType: 'image/jpeg',
          path: 'avatars/user-abc',
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    });
  });

  describe('delete', () => {
    it('calls cloudinary destroy with path and image resource_type', async () => {
      mockDestroy.mockResolvedValueOnce({ result: 'ok' });

      await provider.delete('avatars/user-abc');

      expect(mockDestroy).toHaveBeenCalledWith('avatars/user-abc', { resource_type: 'image' });
    });

    it('throws StorageError with DELETE_FAILED when cloudinary rejects', async () => {
      mockDestroy.mockRejectedValueOnce(new Error('Not found'));

      await expect(provider.delete('avatars/user-abc')).rejects.toMatchObject({
        code: 'DELETE_FAILED',
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter @surewaka/api exec vitest run src/lib/storage/__tests__/cloudinary.test.ts
```

Expected: FAIL — `Cannot find module '../cloudinary'`

- [ ] **Step 3: Implement the Cloudinary provider**

Create `apps/api/src/lib/storage/cloudinary.ts`:

```typescript
import { v2 as cloudinary } from 'cloudinary';
import { StorageError } from '@surewaka/shared';
import type { PublicStorageProvider, StorageFile, PublicUploadResult } from '@surewaka/shared';

function validateEnv(): void {
  const missing = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing Cloudinary env vars: ${missing.join(', ')}`);
  }
}

export function createCloudinaryProvider(): PublicStorageProvider {
  validateEnv();

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  return {
    async upload(file: StorageFile): Promise<PublicUploadResult> {
      try {
        const dataUri = `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
        const result = await cloudinary.uploader.upload(dataUri, {
          public_id: file.path,
          overwrite: true,
          resource_type: 'image',
          format: 'webp',
          quality: 'auto',
          transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        });
        return { url: result.secure_url, path: result.public_id };
      } catch {
        throw new StorageError('UPLOAD_FAILED', 'Failed to upload image to Cloudinary');
      }
    },

    async delete(path: string): Promise<void> {
      try {
        await cloudinary.uploader.destroy(path, { resource_type: 'image' });
      } catch {
        throw new StorageError('DELETE_FAILED', 'Failed to delete image from Cloudinary');
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @surewaka/api exec vitest run src/lib/storage/__tests__/cloudinary.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/storage/__tests__/cloudinary.test.ts apps/api/src/lib/storage/cloudinary.ts
git commit -m "feat(api): add Cloudinary public storage provider"
```

---

### Task 4: R2 provider (TDD)

**Files:**
- Create (test first): `apps/api/src/lib/storage/__tests__/r2.test.ts`
- Create: `apps/api/src/lib/storage/r2.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/storage/__tests__/r2.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrivateStorageProvider } from '@surewaka/shared';

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn((input) => ({ _input: input })),
  DeleteObjectCommand: vi.fn((input) => ({ _input: input })),
  GetObjectCommand: vi.fn((input) => ({ _input: input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

process.env.R2_ENDPOINT = 'https://account123.r2.cloudflarestorage.com';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'surewaka-private';

describe('createR2Provider', () => {
  let provider: PrivateStorageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createR2Provider } = await import('../r2');
    provider = createR2Provider();
  });

  describe('upload', () => {
    it('puts object to R2 with correct bucket, key, and content type', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload({
        buffer: Buffer.from('pdf-content'),
        mimeType: 'application/pdf',
        path: 'kyc/driver-abc/license-1234567890',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _input: expect.objectContaining({
            Bucket: 'surewaka-private',
            Key: 'kyc/driver-abc/license-1234567890',
            ContentType: 'application/pdf',
          }),
        }),
      );
      expect(result).toEqual({ path: 'kyc/driver-abc/license-1234567890' });
    });

    it('throws StorageError with UPLOAD_FAILED when S3 send rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('NoSuchBucket'));

      await expect(
        provider.upload({
          buffer: Buffer.from('x'),
          mimeType: 'application/pdf',
          path: 'kyc/x',
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    });
  });

  describe('delete', () => {
    it('sends DeleteObjectCommand with correct bucket and key', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.delete('kyc/driver-abc/license-1234567890');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _input: expect.objectContaining({
            Bucket: 'surewaka-private',
            Key: 'kyc/driver-abc/license-1234567890',
          }),
        }),
      );
    });

    it('throws StorageError with DELETE_FAILED when S3 send rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

      await expect(provider.delete('kyc/x')).rejects.toMatchObject({ code: 'DELETE_FAILED' });
    });
  });

  describe('getSignedUrl', () => {
    it('returns signed URL using default 3600s expiry', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://account123.r2.cloudflarestorage.com/surewaka-private/kyc/x?X-Amz-Signature=abc',
      );

      const url = await provider.getSignedUrl('kyc/driver-abc/license-1234567890');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          _input: expect.objectContaining({ Key: 'kyc/driver-abc/license-1234567890' }),
        }),
        { expiresIn: 3600 },
      );
      expect(url).toBe(
        'https://account123.r2.cloudflarestorage.com/surewaka-private/kyc/x?X-Amz-Signature=abc',
      );
    });

    it('passes custom expiry to presigner', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.url/x');

      await provider.getSignedUrl('kyc/x', 7200);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 },
      );
    });

    it('throws StorageError with SIGNED_URL_FAILED when presigner rejects', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('CredentialsError'));

      await expect(provider.getSignedUrl('kyc/x')).rejects.toMatchObject({
        code: 'SIGNED_URL_FAILED',
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
pnpm --filter @surewaka/api exec vitest run src/lib/storage/__tests__/r2.test.ts
```

Expected: FAIL — `Cannot find module '../r2'`

- [ ] **Step 3: Implement the R2 provider**

Create `apps/api/src/lib/storage/r2.ts`:

```typescript
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError } from '@surewaka/shared';
import type { PrivateStorageProvider, StorageFile } from '@surewaka/shared';

function validateEnv(): void {
  const missing = [
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing R2 env vars: ${missing.join(', ')}`);
  }
}

export function createR2Provider(): PrivateStorageProvider {
  validateEnv();

  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const bucket = process.env.R2_BUCKET!;

  return {
    async upload(file: StorageFile): Promise<{ path: string }> {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: file.path,
            Body: file.buffer,
            ContentType: file.mimeType,
          }),
        );
        return { path: file.path };
      } catch {
        throw new StorageError('UPLOAD_FAILED', 'Failed to upload document to R2');
      }
    },

    async delete(path: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
      } catch {
        throw new StorageError('DELETE_FAILED', 'Failed to delete document from R2');
      }
    },

    async getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
      try {
        const command = new GetObjectCommand({ Bucket: bucket, Key: path });
        return await getSignedUrl(client, command, { expiresIn });
      } catch {
        throw new StorageError('SIGNED_URL_FAILED', 'Failed to generate signed URL');
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @surewaka/api exec vitest run src/lib/storage/__tests__/r2.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/storage/__tests__/r2.test.ts apps/api/src/lib/storage/r2.ts
git commit -m "feat(api): add Cloudflare R2 private storage provider"
```

---

### Task 5: Storage index (singleton exports)

**Files:**
- Create: `apps/api/src/lib/storage/index.ts`

- [ ] **Step 1: Create the singleton index**

Create `apps/api/src/lib/storage/index.ts`:

```typescript
import { createCloudinaryProvider } from './cloudinary';
import { createR2Provider } from './r2';
import type { PublicStorageProvider, PrivateStorageProvider } from '@surewaka/shared';

export const avatarStorage: PublicStorageProvider = createCloudinaryProvider();
export const documentStorage: PrivateStorageProvider = createR2Provider();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/api exec tsc --noEmit
```

Expected: exits 0. (Note: this will only pass when CLOUDINARY_* and R2_* env vars are available at build time, OR if `validateEnv` errors are deferred. If tsc complains about env vars — that's runtime behaviour, not a type error. The compile check is for types only.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/storage/index.ts
git commit -m "feat(api): export avatarStorage and documentStorage singletons"
```

---

### Task 6: Update profile-service.ts and remove old storage.ts

**Files:**
- Modify: `apps/api/src/services/profile-service.ts`
- Delete: `apps/api/src/lib/storage.ts`

- [ ] **Step 1: Delete the old storage file**

```bash
git rm apps/api/src/lib/storage.ts
```

- [ ] **Step 2: Replace imports at the top of profile-service.ts**

Find this block (lines 6–16 in `apps/api/src/services/profile-service.ts`):

```typescript
import { createServiceClient } from '@surewaka/supabase';
import {
  ALLOWED_AVATAR_EXTENSIONS,
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_SIZE_BYTES,
  type ProfilePreferencesUpdate,
  type NameChangeRequest,
} from '@surewaka/shared';
```

Replace with:

```typescript
import { createServiceClient } from '@surewaka/supabase';
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_SIZE_BYTES,
  type ProfilePreferencesUpdate,
  type NameChangeRequest,
} from '@surewaka/shared';
import { avatarStorage } from '../lib/storage';
```

(`ALLOWED_AVATAR_EXTENSIONS` is only used in `generateAvatarPath` which is removed in the next step.)

- [ ] **Step 3: Delete the generateAvatarPath function**

Remove this entire function from `profile-service.ts`:

```typescript
export function generateAvatarPath(userId: string, extension: string): string {
  const timestamp = Date.now();
  const normalizedExt = extension.toLowerCase().replace(/[^a-z]/g, '');
  const safeExt = (ALLOWED_AVATAR_EXTENSIONS as readonly string[]).includes(normalizedExt)
    ? normalizedExt
    : 'jpg';
  return `${userId}/${timestamp}.${safeExt}`;
}
```

- [ ] **Step 4: Replace the uploadAvatar function**

Replace the entire `uploadAvatar` function (lines 193–278) with:

```typescript
export async function uploadAvatar(
  userId: string,
  file: { buffer: Buffer; mimeType: string; filename: string; size: number },
): Promise<ServiceResult<ProfileResponse>> {
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.mimeType)) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Only JPEG, PNG, and WebP images are allowed' },
      meta: null,
    };
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'File must be 5 MB or smaller' },
      meta: null,
    };
  }

  if (
    file.filename.includes('..') ||
    file.filename.includes('/') ||
    file.filename.includes('\\')
  ) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid filename' },
      meta: null,
    };
  }

  let avatarUrl: string;
  try {
    const result = await avatarStorage.upload({
      buffer: file.buffer,
      mimeType: file.mimeType,
      path: `avatars/${userId}`,
    });
    avatarUrl = result.url;
  } catch {
    return {
      data: null,
      error: { code: 'STORAGE_ERROR', message: 'Failed to upload avatar' },
      meta: null,
    };
  }

  await db.update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, userId));
  await syncAvatarMetadata(userId, avatarUrl);

  return getProfile(userId);
}
```

- [ ] **Step 5: Replace the removeAvatar function**

Replace the entire `removeAvatar` function (lines 284–321) with:

```typescript
export async function removeAvatar(userId: string): Promise<ServiceResult<ProfileResponse>> {
  const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!currentUser) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Profile not found' },
      meta: null,
    };
  }

  if (currentUser.avatarUrl) {
    try {
      await avatarStorage.delete(`avatars/${userId}`);
    } catch (err) {
      console.error('[ProfileService] Failed to delete avatar from storage:', { userId, err });
    }
  }

  await db
    .update(users)
    .set({ avatarUrl: null, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await syncAvatarMetadata(userId, null);

  return getProfile(userId);
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/api exec tsc --noEmit
```

Expected: exits 0, no errors.

- [ ] **Step 7: Run full API test suite**

```bash
pnpm --filter @surewaka/api test
```

Expected: all tests pass including the new storage tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/profile-service.ts
git commit -m "feat(api): swap Supabase storage for Cloudinary avatarStorage in profile-service"
```

---

### Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add storage sections after the Supabase block**

After the existing `# Supabase` block in `.env.example`, add:

```
# =============================================================================
# Cloudinary (public image storage — avatars)
# Sign up at cloudinary.com → Dashboard → copy Cloud name, API Key, API Secret
# =============================================================================
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# =============================================================================
# Cloudflare R2 (private document storage — KYC docs, delivery photos)
# Cloudflare Dashboard → R2 → Create bucket "surewaka-private"
# R2 → Manage API Tokens → Create token with Object Read & Write
# Account ID is in the right sidebar of your Cloudflare dashboard
# =============================================================================
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=surewaka-private
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add Cloudinary and R2 env vars to .env.example"
```

---

### Task 8: Update reference materials

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.kiro/steering/project-context.md`

- [ ] **Step 1: Update CLAUDE.md — Current State checklist**

In `CLAUDE.md`, find the Current State block and add a new checked item after `[x] Landing page (waitlist, campaign pages)`:

```
[x] Storage decoupled from Supabase (avatars → Cloudinary, private docs → Cloudflare R2)
```

- [ ] **Step 2: Update CLAUDE.md — packages table**

Find this row in the monorepo table:

```
| `packages/supabase` | Supabase client (auth, storage, realtime) | — |
```

Replace with:

```
| `packages/supabase` | Supabase client (auth, realtime — storage is Cloudinary/R2 via `apps/api/src/lib/storage/`) | — |
```

- [ ] **Step 3: Update .kiro/steering/project-context.md**

Find the `packages/supabase` row in the monorepo structure table:

```
| `packages/supabase` | Supabase client (auth, storage, realtime) |
```

Replace with:

```
| `packages/supabase` | Supabase client (auth and realtime only — file storage handled by Cloudinary/R2 via `apps/api/src/lib/storage/`) |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .kiro/steering/project-context.md
git commit -m "docs: update reference materials to reflect Cloudinary/R2 storage"
```

---

## Self-Review

**Spec coverage:**
- ✅ Provider interface types in `packages/shared` (Task 2)
- ✅ `StorageFile`, `PublicUploadResult`, `PublicStorageProvider`, `PrivateStorageProvider` (Task 2)
- ✅ `StorageError` class with typed `code` field (Task 2)
- ✅ Cloudinary implementation — upload, delete (Task 3)
- ✅ Auto-WebP, quality auto, 400×400 face crop (Task 3)
- ✅ Deterministic path `avatars/{userId}`, `overwrite: true` (Task 3)
- ✅ Env var validation at init time, startup crash on missing vars (Tasks 3, 4)
- ✅ R2 implementation — upload, delete, getSignedUrl (Task 4)
- ✅ Single bucket `surewaka-private` with folder prefix convention (Task 4)
- ✅ Default 3600s signed URL expiry, caller-overridable (Task 4)
- ✅ Singleton exports `avatarStorage`, `documentStorage` (Task 5)
- ✅ `profile-service.ts` updated — `generateAvatarPath` removed, URL-parsing hack removed (Task 6)
- ✅ Old `storage.ts` deleted (Task 6)
- ✅ `.env.example` updated (Task 7)
- ✅ `CLAUDE.md` and `project-context.md` updated (Task 8)

**Placeholder scan:** All steps contain complete code or exact commands. No TBDs.

**Type consistency:**
- `StorageFile`, `PublicUploadResult`, `PublicStorageProvider`, `PrivateStorageProvider`, `StorageError` — defined in Task 2, referenced identically in Tasks 3, 4, 5, 6.
- `avatarStorage: PublicStorageProvider` — defined in Task 5, imported in Task 6.
- `documentStorage: PrivateStorageProvider` — defined in Task 5, available for future KYC/delivery routes.
- `createCloudinaryProvider` — defined in Task 3, imported in Task 5.
- `createR2Provider` — defined in Task 4, imported in Task 5.
- `StorageError` thrown in Tasks 3 and 4 matches the class defined in Task 2.
