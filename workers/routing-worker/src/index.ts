import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { routingQueue } from './queue';
import { startHealthServer } from './health';
import { db, deliveries } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { enqueuePushFromWorker } from './push-enqueue';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// ─── Routing Worker (route computation) ───────────────────────────────────────

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

// ─── Matching Worker (driver matching orchestrator) ───────────────────────────
// Req 15.1: 3 attempts + exponential backoff from 5s (configured at enqueue time)
// Req 15.3: Stalled job detection every 60s — if worker crashes mid-matching,
//           the job re-queues after 60s. Reservations auto-expire via 60s TTL,
//           so stalled re-runs start fresh from GEOSEARCH (Req 15.4).

const matchingWorker = new Worker(
  'matching',
  async (job) => {
    const { handleMatchDriver } = await import('./jobs/match-driver');
    return handleMatchDriver(job);
  },
  {
    connection,
    concurrency: 5,
    stalledInterval: 60_000,    // 60s stalled detection interval (Req 15.3)
    maxStalledCount: 1,         // 1 stall before re-queuing (matching should be fast)
    lockDuration: 360_000,      // 6 min lock — matching can take up to 5 min (tiered broadcast)
  },
);

// ─── Routing Worker Observability ─────────────────────────────────────────────

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

// ─── Matching Worker Observability ────────────────────────────────────────────

matchingWorker.on('completed', (job) => {
  const elapsed = Date.now() - (job.processedOn ?? Date.now());
  console.info(`[matching-worker] Job ${job.id} completed in ${elapsed}ms`);
});

// Req 15.2: On all retries exhausted, mark delivery as 'routing_failed' and notify customer
matchingWorker.on('failed', async (job, err) => {
  if (!job) return;

  // Only handle final failure (all retries exhausted)
  const maxAttempts = job.opts?.attempts ?? 3;
  if (job.attemptsMade >= maxAttempts) {
    const { deliveryId, customerId } = job.data;

    console.error(
      `[matching-worker] All retries exhausted for delivery ${deliveryId}:`,
      err.message,
    );

    // Mark delivery as routing_failed
    await db
      .update(deliveries)
      .set({ status: 'routing_failed', updatedAt: new Date() })
      .where(eq(deliveries.id, deliveryId));

    // Send push notification to customer about routing failure
    await enqueuePushFromWorker(customerId, 'routing-failed', {
      title: 'Unable to find a driver',
      body: 'We could not match a driver for your delivery. Our team has been notified and will assist you shortly.',
      data: {
        type: 'routing-failed',
        resourceId: deliveryId,
        deepLink: `/deliveries`,
      },
    });
  } else {
    console.warn(
      `[matching-worker] Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${err.message}`,
    );
  }
});

matchingWorker.on('stalled', (jobId) => {
  console.warn(`[matching-worker] Job ${jobId} stalled — will be re-run fresh from GEOSEARCH`);
});

matchingWorker.on('error', (err) => {
  console.error('[matching-worker] Worker error:', err);
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
    await Promise.all([worker.close(), matchingWorker.close()]);
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

console.log('[routing-worker] Started, listening on "routing" and "matching" queues');
