// Feature: push-notifications
// Admin broadcast routes — send push notifications to user segments.
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { broadcastSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';
import { enqueueBroadcast, getBroadcastEstimate } from '../../services/push-service';

type BroadcastEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const broadcastRoutes = new Hono<BroadcastEnv>();

// All routes require authentication + surewaka_admin role
broadcastRoutes.use('*', requireAuth);
broadcastRoutes.use('*', requireRole('surewaka_admin'));

/**
 * GET /estimate — Get estimated recipient count for a broadcast segment.
 * Query param: segment (all | customers | drivers)
 * Requirements: 7.5
 */
broadcastRoutes.get('/estimate', async (c) => {
  const segment = c.req.query('segment');

  if (!segment || !['all', 'customers', 'drivers'].includes(segment)) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query param "segment" must be one of: all, customers, drivers',
        },
        meta: null,
      },
      400,
    );
  }

  try {
    const estimate = await getBroadcastEstimate(segment as 'all' | 'customers' | 'drivers');

    return c.json(
      {
        data: { estimate },
        error: null,
        meta: null,
      },
      200,
    );
  } catch (err) {
    console.error('[Broadcast] Failed to get estimate:', err);
    return c.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get broadcast estimate',
        },
        meta: null,
      },
      500,
    );
  }
});

/**
 * POST / — Dispatch a broadcast push notification to a user segment.
 * Body validated against broadcastSchema.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.7
 */
broadcastRoutes.post('/', async (c) => {
  const body = await c.req.json();

  // Validate request body
  const parsed = broadcastSchema.safeParse(body);

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

  const { title, body: notificationBody, segment, city, deepLink } = parsed.data;

  // Build the push notification payload
  const payload = {
    title,
    body: notificationBody,
    data: {
      type: 'broadcast' as const,
      resourceId: 'broadcast',
      deepLink: deepLink || '/',
      metadata: { segment, city },
    },
  };

  try {
    const result = await enqueueBroadcast(segment, payload, city);

    return c.json(
      {
        data: {
          enqueued: result.enqueued,
          failed: result.failed,
        },
        error: null,
        meta: null,
      },
      200,
    );
  } catch (err) {
    console.error('[Broadcast] Failed to dispatch broadcast:', err);
    return c.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to dispatch broadcast. Please try again.',
        },
        meta: null,
      },
      500,
    );
  }
});

export default broadcastRoutes;
