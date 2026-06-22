// Feature: push-notifications
// Push Service — enqueue push notification jobs with preference checks and app routing.
// Requirements: 3.1, 3.9, 4.2, 4.3, 7.2, 7.3, 7.5, 9.1, 9.3, 9.5, 10.2-10.7

import { Queue } from 'bullmq';
import { db, users } from '@surewaka/db';
import { eq, and, count, gt } from 'drizzle-orm';
import {
  pushNotificationPayloadSchema,
  type PushNotificationPayload,
  type PushNotificationType,
  type PushTargetApp,
  type PushJobData,
  type BroadcastChunkJobData,
  PUSH_APP_ROUTING,
  HIGH_PRIORITY_PUSH_TYPES,
  PUSH_QUEUE_NAME,
  PUSH_BROADCAST_QUEUE_NAME,
  PUSH_BROADCAST_BATCH_SIZE,
  PUSH_MAX_RETRIES,
  PUSH_RETRY_BASE_MS,
} from '@surewaka/shared';

// ─── BullMQ Queue Initialization ─────────────────────────────────────────────

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
};

/**
 * Transactional push queue — individual user notifications.
 * Separate from broadcasts to prevent broadcast floods from delaying
 * time-sensitive delivery notifications.
 */
export const pushQueue = new Queue<PushJobData>(PUSH_QUEUE_NAME, {
  connection: redisConnection,
});

/**
 * Broadcast chunk queue — batched broadcast jobs (500 users per chunk).
 * Separate queue gives independent observability and prevents blocking.
 */
export const broadcastQueue = new Queue<BroadcastChunkJobData>(PUSH_BROADCAST_QUEUE_NAME, {
  connection: redisConnection,
});

// ─── Job Options ─────────────────────────────────────────────────────────────

function getJobOptions(priority: 'high' | 'normal') {
  return {
    priority: priority === 'high' ? 1 : 5,
    attempts: PUSH_MAX_RETRIES,
    backoff: { type: 'exponential' as const, delay: PUSH_RETRY_BASE_MS },
    removeOnComplete: 1000,
    removeOnFail: false, // DLQ — preserve failed jobs for inspection
  };
}

// ─── enqueuePush ─────────────────────────────────────────────────────────────

/**
 * Enqueue a push notification for a single user.
 * 1. Validates payload with Zod schema
 * 2. Checks user's notification_push preference — skips if false
 * 3. Determines target app from PUSH_APP_ROUTING (or override)
 * 4. Determines priority (high for delivery_status_change, delivery_cancelled, driver_arrived)
 * 5. Adds job to BullMQ transactional queue
 *
 * Returns true if job was enqueued, false if skipped (preference off or validation failure).
 *
 * Requirements: 3.1, 3.9, 4.2, 4.3, 9.1, 9.3, 9.5, 10.2-10.7
 */
export async function enqueuePush(
  userId: string,
  type: PushNotificationType,
  payload: PushNotificationPayload,
  targetAppOverride?: PushTargetApp,
): Promise<boolean> {
  // 1. Validate payload
  const parsed = pushNotificationPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error(
      '[PushService] Payload validation failed:',
      parsed.error.errors.map((e) => e.message).join(', '),
    );
    return false;
  }

  // 2. Check user's notification_push preference
  const [user] = await db
    .select({ notificationPush: users.notificationPush })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    console.warn(`[PushService] User ${userId} not found, skipping push`);
    return false;
  }

  if (!user.notificationPush) {
    return false;
  }

  // 3. Determine target app
  const targetApp: PushTargetApp | 'all' = targetAppOverride ?? PUSH_APP_ROUTING[type];

  // 4. Determine priority
  const priority: 'high' | 'normal' = HIGH_PRIORITY_PUSH_TYPES.includes(type)
    ? 'high'
    : 'normal';

  // 5. Enqueue job
  const jobData: PushJobData = {
    userId,
    targetApp,
    payload: parsed.data,
    priority,
  };

  await pushQueue.add('push', jobData, getJobOptions(priority));

  return true;
}

// ─── enqueueBroadcast ────────────────────────────────────────────────────────

/**
 * Enqueue broadcast push jobs in batches of 500 users per chunk.
 * Uses cursor-based pagination to iterate through eligible users.
 *
 * Preference filtering is intentionally SKIPPED at enqueue time — the worker's
 * resolveTokens handles opt-out exclusion at delivery time. This avoids a
 * stale-preference race and simplifies the broadcast path.
 *
 * City filter is deferred — accepted in schema but ignored until user profiles
 * have a city field (launches Lagos-only).
 *
 * Requirements: 7.2, 7.3
 */
export async function enqueueBroadcast(
  segment: 'all' | 'customers' | 'drivers',
  payload: PushNotificationPayload,
  _city?: string, // Accepted but deferred — no city field on users table yet
): Promise<{ enqueued: number; failed: number }> {
  let enqueued = 0;
  let failed = 0;
  let lastId = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Cursor-based pagination: SELECT user IDs in batches, ordered by id, WHERE id > lastId
    const conditions = lastId ? and(gt(users.id, lastId)) : undefined;

    const batch = await db
      .select({ id: users.id })
      .from(users)
      .where(conditions)
      .orderBy(users.id)
      .limit(PUSH_BROADCAST_BATCH_SIZE);

    if (batch.length === 0) break;

    // Enqueue a single chunk job for this batch
    const chunkJobData: BroadcastChunkJobData = {
      userIds: batch.map((u) => u.id),
      payload,
      segment,
    };

    try {
      await broadcastQueue.add('broadcast-chunk', chunkJobData, getJobOptions('normal'));
      enqueued++;
    } catch (err) {
      console.error('[PushService] Failed to enqueue broadcast chunk:', err);
      failed++;
      // Halt further batches on failure (Req 7.7)
      break;
    }

    // Update cursor
    lastId = batch[batch.length - 1]!.id;

    // If batch size is less than limit, we've reached the end
    if (batch.length < PUSH_BROADCAST_BATCH_SIZE) break;
  }

  return { enqueued, failed };
}

// ─── getBroadcastEstimate ────────────────────────────────────────────────────

/**
 * Get estimated recipient count for broadcast confirmation UI.
 * Filters by notification_push = true to show admins accurate estimates.
 * City filter is deferred — no city field on users table yet.
 *
 * Requirements: 7.5
 */
export async function getBroadcastEstimate(
  _segment: 'all' | 'customers' | 'drivers',
  _city?: string, // Accepted but deferred
): Promise<number> {
  // Count users with push preference enabled
  // Segment filtering by role is deferred — we count all push-enabled users
  // because the users table role doesn't directly map to customer/driver app usage.
  // A user with role='customer' might also have the driver app, and vice versa.
  // The broadcast worker handles segment → token app filtering at delivery time.
  const [result] = await db
    .select({ total: count() })
    .from(users)
    .where(eq(users.notificationPush, true));

  return result?.total ?? 0;
}
