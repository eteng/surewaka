import { Queue } from 'bullmq';
import type { MatchDriverJobData } from '@surewaka/shared';

const connection = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
};

/**
 * BullMQ queue reference for driver matching jobs.
 * Used by the API process to enqueue matching jobs (event-driven triggers).
 *
 * The same queue is consumed by the routing-worker process.
 */
export const matchingQueue = new Queue<MatchDriverJobData>('matching', { connection });
