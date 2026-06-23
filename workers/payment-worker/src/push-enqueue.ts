// Feature: push-notifications
// Lightweight push notification enqueue utility for the payment worker.
// The payment worker can't import from apps/api, so this module adds jobs
// directly to the same BullMQ push queue that the push-worker consumes.
//
// This mirrors the core logic of apps/api/src/services/push-service.ts:enqueuePush
// but skips the preference check (the push-worker re-checks preference at
// delivery time via token-resolver, so no user notification goes out if they opted out).
// Requirements: 3.1, 10.3

import { Queue } from 'bullmq';
import { connection } from './queue';
import {
  PUSH_QUEUE_NAME,
  PUSH_MAX_RETRIES,
  PUSH_RETRY_BASE_MS,
  PUSH_APP_ROUTING,
  HIGH_PRIORITY_PUSH_TYPES,
  type PushNotificationType,
  type PushNotificationPayload,
  type PushJobData,
  type PushTargetApp,
} from '@surewaka/shared';

const pushQueue = new Queue<PushJobData>(PUSH_QUEUE_NAME, { connection });

/**
 * Enqueue a push notification from the payment worker.
 *
 * Unlike the API's enqueuePush, this does NOT check user preference here —
 * the push-worker's token-resolver re-checks notification_push at delivery time,
 * which handles the case where a job is enqueued before the user opts out.
 *
 * This fire-and-forget approach is intentional: payment processing should not
 * fail or be delayed if push enqueueing fails.
 */
export async function enqueuePushFromWorker(
  userId: string,
  type: PushNotificationType,
  payload: PushNotificationPayload,
  targetAppOverride?: PushTargetApp,
): Promise<boolean> {
  try {
    const targetApp: PushTargetApp | 'all' = targetAppOverride ?? PUSH_APP_ROUTING[type];
    const priority: 'high' | 'normal' = HIGH_PRIORITY_PUSH_TYPES.includes(type)
      ? 'high'
      : 'normal';

    const jobData: PushJobData = {
      userId,
      targetApp,
      payload,
      priority,
    };

    await pushQueue.add('push', jobData, {
      priority: priority === 'high' ? 1 : 5,
      attempts: PUSH_MAX_RETRIES,
      backoff: { type: 'exponential' as const, delay: PUSH_RETRY_BASE_MS },
      removeOnComplete: 1000,
      removeOnFail: false,
    });

    return true;
  } catch (err) {
    console.error('[PaymentWorker:PushEnqueue] Failed to enqueue push:', err);
    return false;
  }
}
