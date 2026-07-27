import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { MatchDriverJobData } from '@surewaka/shared';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const matchingQueue = new Queue<MatchDriverJobData>('matching', { connection });
