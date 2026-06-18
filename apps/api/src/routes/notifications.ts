// Feature: admin-notifications
// Notification routes — list, create, mark-as-read, and manage admin notifications.
// Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { createNotificationSchema, notificationQuerySchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import * as notificationService from '../services/notification-service';
import { z } from 'zod';

type NotificationRoutesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const notificationRoutes = new Hono<NotificationRoutesEnv>();

// All notification routes require authentication
notificationRoutes.use('*', requireAuth);

/**
 * GET / — List paginated notifications for the authenticated user
 * Query params validated with notificationQuerySchema
 * (Requirement 4.2)
 */
notificationRoutes.get('/', async (c) => {
  const user = c.get('user');

  const parsed = notificationQuerySchema.safeParse(c.req.query());

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
    const result = await notificationService.getNotifications(user.id, parsed.data);

    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, 500);
    }

    return c.json({ data: result.data, error: null, meta: result.meta }, 200);
  } catch (error) {
    console.error('[NotificationRoutes] GET / error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve notifications' }, meta: null },
      500,
    );
  }
});

/**
 * GET /unread-count — Get the unread notification count for the authenticated user
 * (Requirement 4.3)
 */
notificationRoutes.get('/unread-count', async (c) => {
  const user = c.get('user');

  try {
    const result = await notificationService.getUnreadCount(user.id);

    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, 500);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[NotificationRoutes] GET /unread-count error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve unread count' }, meta: null },
      500,
    );
  }
});

/**
 * POST / — Create a notification (internal/admin callers)
 * Body validated with createNotificationSchema
 * (Requirement 4.6, 5.2, 5.3)
 */
notificationRoutes.post('/', async (c) => {
  const body = await c.req.json();

  const parsed = createNotificationSchema.safeParse(body);

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
    const result = await notificationService.createNotification(parsed.data);

    if (result.error) {
      const statusCode = result.error.code === 'VALIDATION_ERROR' ? 400 : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 201);
  } catch (error) {
    console.error('[NotificationRoutes] POST / error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create notification' }, meta: null },
      500,
    );
  }
});

/**
 * PATCH /:id/read — Mark a single notification as read
 * Validates UUID param, returns 404 if not found or not owned by user
 * (Requirement 4.4)
 */
notificationRoutes.patch('/:id/read', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  // Validate UUID format
  const uuidResult = z.string().uuid().safeParse(id);
  if (!uuidResult.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid notification ID format' },
        meta: null,
      },
      400,
    );
  }

  try {
    const result = await notificationService.markAsRead(user.id, id);

    if (result.error) {
      const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
      return c.json({ data: null, error: result.error, meta: null }, statusCode);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[NotificationRoutes] PATCH /:id/read error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to mark notification as read' }, meta: null },
      500,
    );
  }
});

/**
 * POST /mark-all-read — Mark all unread notifications as read for the authenticated user
 * (Requirement 4.5)
 */
notificationRoutes.post('/mark-all-read', async (c) => {
  const user = c.get('user');

  try {
    const result = await notificationService.markAllAsRead(user.id);

    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, 500);
    }

    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch (error) {
    console.error('[NotificationRoutes] POST /mark-all-read error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to mark all as read' }, meta: null },
      500,
    );
  }
});

export default notificationRoutes;
