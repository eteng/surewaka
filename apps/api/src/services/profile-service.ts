// Feature: admin-user-profile
// Profile Service — business logic for profile retrieval, preferences, avatar management,
// and name change request submission.
// Requirements: 1.3, 2.3, 2.4, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3

import { db, users, nameChangeRequests } from '@surewaka/db';
import { eq, and } from 'drizzle-orm';
import { createServiceClient } from '@surewaka/supabase';
import {
  ALLOWED_AVATAR_EXTENSIONS,
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_SIZE_BYTES,
  type ProfilePreferencesUpdate,
  type NameChangeRequest,
} from '@surewaka/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProfileResponse = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: string;
  avatarUrl: string | null;
  notificationEmail: boolean;
  notificationSms: boolean;
  verified: boolean;
  updatedAt: string;
  pendingNameChange: {
    id: string;
    requestedName: string;
    reason: string;
    status: 'pending';
    createdAt: string;
  } | null;
};

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: Record<string, unknown> | null;
};

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Mask a phone number: preserve last 4 characters, replace other digits with '*',
 * keep non-digit characters (like '+') in their original positions.
 *
 * Example: "+2348012345678" → "+***********5678"
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';

  const preserved = phone.slice(-4);
  const masked = phone.slice(0, phone.length - 4).replace(/\d/g, '*');
  return masked + preserved;
}

/**
 * Generate a storage path for an avatar file.
 * Format: `{userId}/{timestamp}.{extension}`
 * Extension is sanitized to only allow jpg/jpeg/png/webp, defaults to 'jpg'.
 */
export function generateAvatarPath(userId: string, extension: string): string {
  const timestamp = Date.now();
  const normalizedExt = extension.toLowerCase().replace(/[^a-z]/g, '');
  const safeExt = (ALLOWED_AVATAR_EXTENSIONS as readonly string[]).includes(normalizedExt)
    ? normalizedExt
    : 'jpg';
  return `${userId}/${timestamp}.${safeExt}`;
}

/**
 * Sync avatar_url to Supabase Auth user_metadata.
 * Fire-and-forget: logs errors but does not throw.
 */
export async function syncAvatarMetadata(
  userId: string,
  avatarUrl: string | null,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { avatar_url: avatarUrl },
    });

    if (error) {
      console.error('[ProfileService] Auth metadata sync failed:', { userId, error: error.message });
    }
  } catch (err) {
    console.error('[ProfileService] Unexpected error syncing avatar metadata:', { userId, err });
  }
}

// ─── Profile Service ─────────────────────────────────────────────────────────

/**
 * Get the authenticated user's profile, including any pending name change request.
 * Phone number is masked in the response.
 */
export async function getProfile(userId: string): Promise<ServiceResult<ProfileResponse>> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Profile not found' },
      meta: null,
    };
  }

  // Query pending name change request
  const [pendingRequest] = await db
    .select()
    .from(nameChangeRequests)
    .where(
      and(eq(nameChangeRequests.userId, userId), eq(nameChangeRequests.status, 'pending')),
    )
    .limit(1);

  const profile: ProfileResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: maskPhone(user.phone),
    role: user.role,
    avatarUrl: user.avatarUrl,
    notificationEmail: user.notificationEmail,
    notificationSms: user.notificationSms,
    verified: user.verified,
    updatedAt: user.updatedAt.toISOString(),
    pendingNameChange: pendingRequest
      ? {
          id: pendingRequest.id,
          requestedName: pendingRequest.requestedName,
          reason: pendingRequest.reason,
          status: 'pending',
          createdAt: pendingRequest.createdAt.toISOString(),
        }
      : null,
  };

  return { data: profile, error: null, meta: null };
}

/**
 * Update notification preferences (partial update).
 * Only updates fields that are provided; unspecified fields remain unchanged.
 * Returns the updated profile.
 */
export async function updatePreferences(
  userId: string,
  data: ProfilePreferencesUpdate,
): Promise<ServiceResult<ProfileResponse>> {
  const updateFields: Partial<{
    notificationEmail: boolean;
    notificationSms: boolean;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (data.notificationEmail !== undefined) {
    updateFields.notificationEmail = data.notificationEmail;
  }
  if (data.notificationSms !== undefined) {
    updateFields.notificationSms = data.notificationSms;
  }

  const [updated] = await db
    .update(users)
    .set(updateFields)
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Profile not found' },
      meta: null,
    };
  }

  // Return full profile with pending name change
  return getProfile(userId);
}

/**
 * Upload a new avatar image.
 * Flow: validate → upload to storage → delete old avatar (if exists) → update DB → sync auth metadata
 * Storage failure does NOT modify the DB (atomicity guarantee).
 */
export async function uploadAvatar(
  userId: string,
  file: { buffer: Buffer; mimeType: string; filename: string; size: number },
): Promise<ServiceResult<ProfileResponse>> {
  // Validate file metadata
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
      error: { code: 'VALIDATION_ERROR', message: 'File must be 2 MB or smaller' },
      meta: null,
    };
  }

  if (file.filename.includes('..') || file.filename.includes('/') || file.filename.includes('\\')) {
    return {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid filename' },
      meta: null,
    };
  }

  // Determine extension from mime type
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const extension = extMap[file.mimeType] || 'jpg';
  const storagePath = generateAvatarPath(userId, extension);

  const supabase = createServiceClient();

  // Upload to storage FIRST (atomicity: if this fails, DB is not modified)
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(storagePath, file.buffer, {
      contentType: file.mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error('[ProfileService] Storage upload failed:', { userId, error: uploadError.message });
    return {
      data: null,
      error: { code: 'STORAGE_ERROR', message: 'Failed to upload avatar' },
      meta: null,
    };
  }

  // Get the public URL for the uploaded file
  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(storagePath);
  const avatarUrl = publicUrlData.publicUrl;

  // Delete old avatar from storage (if exists) — non-critical, log errors
  const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (currentUser?.avatarUrl) {
    try {
      // Extract the path from the full URL
      const oldUrl = new URL(currentUser.avatarUrl);
      const pathParts = oldUrl.pathname.split('/storage/v1/object/public/avatars/');
      if (pathParts.length > 1) {
        const oldPath = decodeURIComponent(pathParts[1]);
        await supabase.storage.from('avatars').remove([oldPath]);
      }
    } catch (err) {
      console.error('[ProfileService] Failed to delete old avatar:', { userId, err });
      // Non-critical: continue with the update
    }
  }

  // Update DB with new avatar URL
  await db.update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, userId));

  // Sync auth metadata (fire-and-forget)
  await syncAvatarMetadata(userId, avatarUrl);

  return getProfile(userId);
}

/**
 * Remove the user's avatar.
 * Deletes from storage, sets avatar_url to null in DB, syncs auth metadata.
 */
export async function removeAvatar(userId: string): Promise<ServiceResult<ProfileResponse>> {
  const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!currentUser) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Profile not found' },
      meta: null,
    };
  }

  // Delete from storage if avatar exists
  if (currentUser.avatarUrl) {
    try {
      const supabase = createServiceClient();
      const oldUrl = new URL(currentUser.avatarUrl);
      const pathParts = oldUrl.pathname.split('/storage/v1/object/public/avatars/');
      if (pathParts.length > 1) {
        const oldPath = decodeURIComponent(pathParts[1]);
        await supabase.storage.from('avatars').remove([oldPath]);
      }
    } catch (err) {
      console.error('[ProfileService] Failed to delete avatar from storage:', { userId, err });
      // Continue with DB update even if storage delete fails
    }
  }

  // Set avatar_url to null in DB
  await db
    .update(users)
    .set({ avatarUrl: null, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Sync auth metadata (fire-and-forget)
  await syncAvatarMetadata(userId, null);

  return getProfile(userId);
}

/**
 * Submit a name change request.
 * Checks that no pending request already exists (409 if so).
 * Inserts a new record with current_name from the user's record.
 */
export async function submitNameChangeRequest(
  userId: string,
  data: NameChangeRequest,
): Promise<ServiceResult<{ id: string }>> {
  // Check for existing pending request
  const [existingPending] = await db
    .select()
    .from(nameChangeRequests)
    .where(
      and(eq(nameChangeRequests.userId, userId), eq(nameChangeRequests.status, 'pending')),
    )
    .limit(1);

  if (existingPending) {
    return {
      data: null,
      error: { code: 'CONFLICT', message: 'A name change request is already pending' },
      meta: null,
    };
  }

  // Get current user name
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Profile not found' },
      meta: null,
    };
  }

  // Insert name change request
  const [request] = await db
    .insert(nameChangeRequests)
    .values({
      userId,
      currentName: user.name,
      requestedName: data.requestedName,
      reason: data.reason,
      status: 'pending',
    })
    .returning();

  return { data: { id: request.id }, error: null, meta: null };
}
