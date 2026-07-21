import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'routing',
  async (job) => {
    // Job handler implemented in jobs/route-delivery.ts
    const { handleRouteDelivery } = await import('./jobs/route-delivery');
    return handleRouteDelivery(job);
  },
  {
    connection,
    concurrency: 3,
  },
);

worker.on('failed', (job, err) => {
  console.error(`[routing-worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[routing-worker] Worker error:', err);
});

console.log('[routing-worker] Started, listening on "routing" queue');
