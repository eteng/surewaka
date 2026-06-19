// Feature: waitlist-admin
// Admin waitlist management routes — list waitlist signups with search, filtering, sorting, and pagination.
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { waitlistQuerySchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { listWaitlistSignups, getWaitlistStats } from '../../services/waitlist-service';

type WaitlistEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const waitlistRoutes = new Hono<WaitlistEnv>();

// All routes require authentication + MFA + surewaka_admin role
waitlistRoutes.use('*', requireAuth);
waitlistRoutes.use('*');
waitlistRoutes.use('*', requireRole('surewaka_admin'));

/**
 * GET / — List waitlist signups with search, filtering, sorting, and pagination
 * Query params validated against waitlistQuerySchema
 */
waitlistRoutes.get('/', async (c) => {
  const rawQuery = c.req.query();

  // Validate query parameters
  const parsed = waitlistQuerySchema.safeParse(rawQuery);

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

  const params = parsed.data;

  const { data, total } = await listWaitlistSignups(params);

  const totalPages = total === 0 ? 0 : Math.ceil(total / params.pageSize);

  return c.json(
    {
      data,
      error: null,
      meta: {
        total,
        page: params.page,
        pageSize: params.pageSize,
        totalPages,
      },
    },
    200,
  );
});

/**
 * GET /stats — Aggregate waitlist statistics
 * Returns total signups, per-type breakdown, and last 7 days count.
 * Requirements: 6.3
 */
waitlistRoutes.get('/stats', async (c) => {
  try {
    const stats = await getWaitlistStats();

    return c.json(
      {
        data: stats,
        error: null,
        meta: null,
      },
      200,
    );
  } catch {
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR' },
        meta: null,
      },
      500,
    );
  }
});

export default waitlistRoutes;
