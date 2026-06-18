// Feature: admin-user-profile
// Admin name change request routes — list pending requests and approve/reject them.
// Requirements: 2.5, 2.6

import { Hono } from 'hono';
import { requireAuth, requireMfa } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { nameChangeReviewSchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import * as nameChangeService from '../../services/name-change-service';

type AdminNameChangeEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const adminNameChangeRequests = new Hono<AdminNameChangeEnv>();

// All routes require authentication + MFA + surewaka_admin role
adminNameChangeRequests.use('*', requireAuth);
adminNameChangeRequests.use('*', requireMfa);
adminNameChangeRequests.use('*', requireRole('surewaka_admin'));

/**
 * GET / — List all pending name change requests
 * Returns pending requests with user details for admin review.
 */
adminNameChangeRequests.get('/', async (c) => {
  try {
    const result = await nameChangeService.listPending();

    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, 500);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[AdminNameChangeRequests] GET / error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve name change requests' },
        meta: null,
      },
      500,
    );
  }
});

/**
 * PATCH /:id — Approve or reject a name change request
 * Body validated with nameChangeReviewSchema ({ status: 'approved' | 'rejected', reviewNote?: string })
 * Admin user ID extracted from JWT context for audit trail.
 */
adminNameChangeRequests.patch('/:id', async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json();

  const parsed = nameChangeReviewSchema.safeParse(body);

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
    const result = await nameChangeService.review(requestId, user.id, parsed.data);

    if (result.error) {
      const statusCode =
        result.error.code === 'NOT_FOUND' ? 404
        : result.error.code === 'CONFLICT' ? 409
        : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[AdminNameChangeRequests] PATCH /:id error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to review name change request' },
        meta: null,
      },
      500,
    );
  }
});

export default adminNameChangeRequests;
