/**
 * Queue Registry for BullMQ Dashboard.
 *
 * Centralizes Queue instances used for introspection (getJobCounts, getJobs, etc.)
 * and QueueEvents instances used for real-time SSE streaming.
 *
 * All queues share a single IORedis connection to avoid connection bloat.
 */

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { PUSH_QUEUE_NAME, PUSH_BROADCAST_QUEUE_NAME } from '@surewaka/shared';

// ─── Connection ───────────────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
});

// ─── Queue Definitions ────────────────────────────────────────────────────────

export type QueueName =
  | 'routing'
  | 'matching'
  | 'payment'
  | 'ledger'
  | 'cron'
  | typeof PUSH_QUEUE_NAME
  | typeof PUSH_BROADCAST_QUEUE_NAME;

export type QueueMeta = {
  name: QueueName;
  displayName: string;
  description: string;
};

export const QUEUE_META: QueueMeta[] = [
  { name: 'routing', displayName: 'Routing', description: 'Route computation for SureWaka Way deliveries' },
  { name: 'matching', displayName: 'Matching', description: 'Driver matching (tiered broadcast algorithm)' },
  { name: 'payment', displayName: 'Payment', description: 'Escrow holds, releases, refunds, payouts' },
  { name: 'ledger', displayName: 'Ledger', description: 'Finance ledger event writes (commission, fees, reversals)' },
  { name: 'cron', displayName: 'Cron', description: 'Scheduled maintenance jobs' },
  { name: PUSH_QUEUE_NAME, displayName: 'Push Notifications', description: 'Expo push notification delivery (transactional)' },
  { name: PUSH_BROADCAST_QUEUE_NAME, displayName: 'Push Broadcasts', description: 'Expo push notification delivery (admin broadcasts)' },
];

// ─── Queue Instances ──────────────────────────────────────────────────────────

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection });
    queues.set(name, queue);
  }
  return queue;
}

export function getAllQueues(): Map<QueueName, Queue> {
  // Ensure all queues are instantiated
  for (const meta of QUEUE_META) {
    getQueue(meta.name);
  }
  return queues;
}

// ─── QueueEvents Instances (for SSE) ─────────────────────────────────────────

const queueEventsMap = new Map<QueueName, QueueEvents>();

export function getQueueEvents(name: QueueName): QueueEvents {
  let qe = queueEventsMap.get(name);
  if (!qe) {
    qe = new QueueEvents(name, { connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }) });
    queueEventsMap.set(name, qe);
  }
  return qe;
}

// ─── Redaction ────────────────────────────────────────────────────────────────

/**
 * Fields to redact from job data when returning to the dashboard.
 * Prevents sensitive customer PII from being displayed in plain text.
 */
const REDACTED_FIELDS = new Set([
  'phone',
  'phoneNumber',
  'email',
  'customerPhone',
  'driverPhone',
  'recipientPhone',
  'recipientName',
  'senderName',
  'token',
  'accessToken',
  'pushToken',
  'expoPushToken',
]);

/**
 * Deep-redact sensitive fields from a job data object.
 * Returns a new object with sensitive values replaced with '[REDACTED]'.
 */
export function redactJobData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(redactJobData);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (REDACTED_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactJobData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Redis Info ───────────────────────────────────────────────────────────────

export type RedisInfo = {
  version: string;
  connections: number;
  usedMemory: string;
  usedMemoryHuman: string;
  usedCpuSys: string;
  uptimeDays: number;
  connectedClients: number;
};

export async function getRedisInfo(): Promise<RedisInfo> {
  await connection.connect().catch(() => {}); // ensure connected
  const info = await connection.info();

  const get = (key: string): string => {
    const match = info.match(new RegExp(`${key}:(.+?)\\r?\\n`));
    return match?.[1]?.trim() ?? '';
  };

  return {
    version: get('redis_version'),
    connections: parseInt(get('connected_clients')) || 0,
    usedMemory: get('used_memory'),
    usedMemoryHuman: get('used_memory_human'),
    usedCpuSys: get('used_cpu_sys'),
    uptimeDays: parseInt(get('uptime_in_days')) || 0,
    connectedClients: parseInt(get('connected_clients')) || 0,
  };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  for (const queue of queues.values()) {
    await queue.close();
  }
  for (const qe of queueEventsMap.values()) {
    await qe.close();
  }
  await connection.quit();
}
