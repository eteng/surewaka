import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { PUSH_QUEUE_NAME } from '@surewaka/shared';
import type { AlertRule, PushJobData } from '@surewaka/shared';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let _queue: Queue<PushJobData> | null = null;

function getQueue(): Queue<PushJobData> {
  if (!_queue) {
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _queue = new Queue<PushJobData>(PUSH_QUEUE_NAME, { connection });
  }
  return _queue;
}

const RULE_PUSH_TITLES: Record<AlertRule, string> = {
  driver_silent: '🔴 Driver Silent',
  leg_overdue: '🔴 Leg Overdue',
  driver_ghost: '🔴 Driver Ghost',
  dispute_filed: '⚠️ Dispute Filed',
  delivery_failed: '⚠️ Delivery Failed',
  ontime_rate_drop: '⚠️ On-Time Rate Drop',
  customer_update_gap: '⚠️ Customer Update Gap',
};

export async function enqueueAdminPush(
  rule: AlertRule,
  context: Record<string, unknown>,
  adminUserIds: string[],
): Promise<void> {
  if (adminUserIds.length === 0) return;
  const queue = getQueue();

  const body = context.deliveryId
    ? `Delivery #${context.deliveryId} needs attention`
    : 'Check the operations dashboard';

  for (const userId of adminUserIds) {
    await queue.add(
      'admin-alert',
      {
        userId,
        targetApp: 'admin' as const,
        payload: {
          title: RULE_PUSH_TITLES[rule],
          body,
          data: {
            type: 'system_alert' as const,
            resourceId: String(context.deliveryId ?? ''),
            deepLink: context.deliveryId ? `/deliveries/${context.deliveryId}` : '/alerts',
            metadata: { alertRule: rule },
          },
        },
        priority: 'high' as const,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }
}
