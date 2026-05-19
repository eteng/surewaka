// Feature: admin-user-profile
// User self-service profile routes — view profile, update preferences, manage avatar,
// and submit name change requests.
// Requirements: 5.4, 6.1, 6.2, 6.3, 6.4

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import {
  profilePreferencesUpdateSchema,
  avatarFileSchema,
  nameChangeRequestSchema,
} from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import * as profileService from '../services/profile-service';

type ProfileRoutesEnv = {
  Variables: {
    user: SupabaseUser;
    accessToken: string;
  };
};

const profileRoutes = new Hono<ProfileRoutesEnv>();

// All profile routes require authentication
profileRoutes.use('*', requireAuth);

/**
 * GET /profile — Retrieve the authenticated user's profile
 * Scoped to JWT user ID (Requirement 6.2, 6.3)
 */
profileRoutes.get('/', async (c) => {
  const user = c.get('user');

  try {
    const result = await profileService.getProfile(user.id);

    if (result.error) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[ProfileRoutes] GET /profile error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve profile' }, meta: null },
      500,
    );
  }
});

/**
 * PATCH /profile — Update notification preferences
 * Body validated with profilePreferencesUpdateSchema
 * Scoped to JWT user ID (Requirement 6.2, 6.3)
 */
profileRoutes.patch('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();

  const parsed = profilePreferencesUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        },
        meta: null,
      },
      400,
    );
  }

  try {
    const result = await profileService.updatePreferences(user.id, parsed.data);

    if (result.error) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[ProfileRoutes] PATCH /profile error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update profile' }, meta: null },
      500,
    );
  }
});

/**
 * POST /profile/avatar — Upload a new avatar image
 * Parses multipart form data, validates with avatarFileSchema
 * Scoped to JWT user ID (Requirement 6.2, 6.3)
 */
profileRoutes.post('/avatar', async (c) => {
  const user = c.get('user');

  try {
    const formData = await c.req.parseBody();
    const file = formData['avatar'];

    if (!file || !(file instanceof File)) {
      return c.json(
        {
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'No file provided' },
          meta: null,
        },
        400,
      );
    }

    // Validate file metadata with avatarFileSchema
    const fileMetadata = {
      filename: file.name,
      mimeType: file.type,
      size: file.size,
    };

    const parsed = avatarFileSchema.safeParse(fileMetadata);

    if (!parsed.success) {
      return c.json(
        {
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map((e) => e.message).join(', '),
          },
          meta: null,
        },
        400,
      );
    }

    // Convert File to Buffer for the service
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await profileService.uploadAvatar(user.id, {
      buffer,
      mimeType: file.type,
      filename: file.name,
      size: file.size,
    });

    if (result.error) {
      const statusCode = result.error.code === 'STORAGE_ERROR' ? 500
        : result.error.code === 'VALIDATION_ERROR' ? 400
        : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[ProfileRoutes] POST /profile/avatar error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to upload avatar' }, meta: null },
      500,
    );
  }
});

/**
 * DELETE /profile/avatar — Remove the current avatar
 * Scoped to JWT user ID (Requirement 6.2, 6.3)
 */
profileRoutes.delete('/avatar', async (c) => {
  const user = c.get('user');

  try {
    const result = await profileService.removeAvatar(user.id);

    if (result.error) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[ProfileRoutes] DELETE /profile/avatar error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to remove avatar' }, meta: null },
      500,
    );
  }
});

/**
 * POST /profile/name-change-request — Submit a name change request
 * Body validated with nameChangeRequestSchema
 * Scoped to JWT user ID (Requirement 6.2, 6.3)
 */
profileRoutes.post('/name-change-request', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();

  const parsed = nameChangeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        },
        meta: null,
      },
      400,
    );
  }

  try {
    const result = await profileService.submitNameChangeRequest(user.id, parsed.data);

    if (result.error) {
      const statusCode = result.error.code === 'CONFLICT' ? 409
        : result.error.code === 'NOT_FOUND' ? 404
        : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[ProfileRoutes] POST /profile/name-change-request error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to submit name change request' },
        meta: null,
      },
      500,
    );
  }
});

export default profileRoutes;
