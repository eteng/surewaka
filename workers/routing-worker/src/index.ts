import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { routingQueue } from './queue';
import { startHealthServer } from './health';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'routing',
  async (job) => {
    const { handleRouteDelivery } = await import('./jobs/route-delivery');
    return handleRouteDelivery(job);
  },
  {
    connection,
    concurrency: 3,
    lockDuration: 120_000,      // 2 min — routing jobs do DB + Mapbox + graph + Ably
    stalledInterval: 60_000,    // Check for stalled jobs every 60s
    maxStalledCount: 2,         // 2 stalls before failing (forgives GC pauses)
  },
);

// ─── Observability ────────────────────────────────────────────────────────────

worker.on('completed', (job) => {
  const elapsed = Date.now() - (job.processedOn ?? Date.now());
  console.info(`[routing-worker] Job ${job.id} completed in ${elapsed}ms`);
});

worker.on('failed', (job, err) => {
  console.error(`[routing-worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});

worker.on('stalled', (jobId) => {
  console.warn(`[routing-worker] Job ${jobId} stalled`);
});

worker.on('error', (err) => {
  console.error('[routing-worker] Worker error:', err);
});

// ─── Health Check ─────────────────────────────────────────────────────────────

startHealthServer(connection, routingQueue);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string) {
  console.info(`[routing-worker] Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[routing-worker] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await worker.close();
    await connection.quit();
    clearTimeout(forceExit);
    console.info('[routing-worker] Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[routing-worker] Error during shutdown:', err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[routing-worker] Started, listening on "routing" queue');
