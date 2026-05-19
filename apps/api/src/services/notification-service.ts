// Feature: admin-notifications
// Notification Service — business logic for creating, listing, reading,
// and cleaning up admin notifications.
// Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.4, 5.6, 8.1, 8.2

import { db, notifications, userRoles } from '@surewaka/db';
import { eq, and, desc, count, lt, sql } from 'drizzle-orm';
import {
  createNotificationSchema,
  type CreateNotificationInput,
  type NotificationData,
  type PaginationMeta,
} from '@surewaka/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ServiceResult<T, M = null> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: M | null;
};

type GetNotificationsOptions = {
  page: number;
  pageSize: number;
  type?: string;
  isRead?: boolean;
};

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Get paginated notifications for a user with optional filters.
 * Sorted by created_at DESC (most recent first).
 *
 * Requirements: 4.2
 */
export async function getNotifications(
  userId: string,
  options: GetNotificationsOptions
): Promise<ServiceResult<NotificationData[], PaginationMeta>> {
  const { page, pageSize, type, isRead } = options;
  const offset = (page - 1) * pageSize;

  // Build WHERE conditions
  const conditions = [eq(notifications.userId, userId)];

  if (type !== undefined) {
    conditions.push(sql`${notifications.type} = ${type}`);
  }

  if (isRead !== undefined) {
    conditions.push(eq(notifications.isRead, isRead));
  }

  const whereClause = and(...conditions);

  // Execute data query
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      resourceLink: notifications.resourceLink,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Execute count query
  const [countResult] = await db
    .select({ total: count() })
    .from(notifications)
    .where(whereClause);

  const total = countResult?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Map rows to NotificationData
  const data: NotificationData[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    resourceLink: row.resourceLink,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    data,
    error: null,
    meta: { page, pageSize, total, totalPages },
  };
}

/**
 * Get the count of unread notifications for a user.
 *
 * Requirements: 4.3
 */
export async function getUnreadCount(
  userId: string
): Promise<ServiceResult<{ count: number }>> {
  const [result] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return {
    data: { count: result?.total ?? 0 },
    error: null,
    meta: null,
  };
}

/**
 * Create a notification. Validates input with Zod schema.
 * When userId is "all_admins", creates individual records for each user
 * with the surewaka_admin role.
 *
 * Requirements: 5.2, 5.4, 5.6
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<ServiceResult<{ created: number }>> {
  // Validate input with Zod schema
  const parsed = createNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors.map((e) => e.message).join(', '),
      },
      meta: null,
    };
  }

  const { userId, type, title, message, resourceLink } = parsed.data;

  if (userId === 'all_admins') {
    // Query all users with surewaka_admin role (active)
    const adminUsers = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.role, 'surewaka_admin'), eq(userRoles.isActive, true)));

    if (adminUsers.length === 0) {
      return {
        data: { created: 0 },
        error: null,
        meta: null,
      };
    }

    // Insert individual notification records for each admin
    const values = adminUsers.map((admin) => ({
      userId: admin.userId,
      type,
      title,
      message,
      resourceLink: resourceLink ?? null,
    }));

    await db.insert(notifications).values(values);

    return {
      data: { created: adminUsers.length },
      error: null,
      meta: null,
    };
  }

  // Single user notification
  await db.insert(notifications).values({
    userId,
    type,
    title,
    message,
    resourceLink: resourceLink ?? null,
  });

  return {
    data: { created: 1 },
    error: null,
    meta: null,
  };
}

/**
 * Mark a single notification as read.
 * Returns 404 if the notification doesn't exist or doesn't belong to the user.
 *
 * Requirements: 4.4
 */
export async function markAsRead(
  userId: string,
  notificationId: string
): Promise<ServiceResult<{ id: string; isRead: boolean }>> {
  // Check notification exists and belongs to user
  const [existing] = await db
    .select({ id: notifications.id, userId: notifications.userId })
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .limit(1);

  if (!existing) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Notification not found' },
      meta: null,
    };
  }

  // Set is_read = true
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, notificationId));

  return {
    data: { id: notificationId, isRead: true },
    error: null,
    meta: null,
  };
}

/**
 * Mark all unread notifications as read for a user.
 * Returns the count of notifications updated.
 *
 * Requirements: 4.5
 */
export async function markAllAsRead(
  userId: string
): Promise<ServiceResult<{ updated: number }>> {
  const result = await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });

  return {
    data: { updated: result.length },
    error: null,
    meta: null,
  };
}

/**
 * Delete notifications older than 90 days.
 * Called by the cleanup cron job.
 *
 * Requirements: 8.1, 8.2
 */
export async function cleanupOldNotifications(): Promise<{ deleted: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  const result = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoffDate))
    .returning({ id: notifications.id });

  const deleted = result.length;
  console.log(
    `[NotificationCleanup] Deleted ${deleted} notifications older than 90 days`
  );

  return { deleted };
}
