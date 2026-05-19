/**
 * Notification Cleanup Job
 *
 * Deletes notifications older than 90 days from the database.
 * Scheduled to run daily at 02:00 UTC.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { db, notifications } from '@surewaka/db';
import { lt } from 'drizzle-orm';

const RETENTION_DAYS = 90;

export async function cleanupOldNotifications(): Promise<void> {
  const startTime = Date.now();

  console.log('⏰ Running notification cleanup (retention: 90 days)...');

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const result = await db
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoffDate))
      .returning({ id: notifications.id });

    const deleted = result.length;
    const duration = Date.now() - startTime;

    console.log(
      `[NotificationCleanup] Deleted ${deleted} notifications older than ${RETENTION_DAYS} days (${duration}ms)`,
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[NotificationCleanup] Error during cleanup (${duration}ms):`,
      error,
    );
  }
}
