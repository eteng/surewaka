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

export async function enqueuePushFromWorker(
  userId: string,
  type: PushNotificationType,
  payload: PushNotificationPayload,
  targetAppOverride?: PushTargetApp,
): Promise<boolean> {
  try {
    const targetApp: PushTargetApp | 'all' = targetAppOverride ?? PUSH_APP_ROUTING[type];
    const priority: 'high' | 'normal' = HIGH_PRIORITY_PUSH_TYPES.includes(type) ? 'high' : 'normal';
    const jobData: PushJobData = { userId, targetApp, payload, priority };
    await pushQueue.add('push', jobData, {
      priority: priority === 'high' ? 1 : 5,
      attempts: PUSH_MAX_RETRIES,
      backoff: { type: 'exponential' as const, delay: PUSH_RETRY_BASE_MS },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
    return true;
  } catch (err) {
    console.error('[RoutingWorker:PushEnqueue] Failed to enqueue push:', err);
    return false;
  }
}
