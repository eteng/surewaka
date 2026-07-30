import { Worker } from 'bullmq';
import { connection, matchingQueue } from './queue';
import { db, deliveries } from '@surewaka/db';
import { startHealthServer } from './health';
import { eq } from 'drizzle-orm';
import { enqueuePushFromWorker } from './push-enqueue';
import { logger } from './lib/logger';

// ─── Matching Worker ──────────────────────────────────────────────────────────
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
    stalledInterval: 60_000,
    maxStalledCount: 1,
    lockDuration: 360_000,
    metrics: { maxDataPoints: 60 * 24 }, // 24h of 1-min data points
  },
);

// ─── Observability ────────────────────────────────────────────────────────────

matchingWorker.on('completed', (job) => {
  const elapsed = Date.now() - (job.processedOn ?? Date.now());
  const log = logger.child({ jobId: job.id, deliveryId: job.data?.deliveryId });
  const result = job.returnvalue as { matched?: boolean; driverId?: string; tier?: number; reason?: string } | undefined;

  log.info('Job completed', {
    durationMs: elapsed,
    attempts: job.attemptsMade,
    matched: result?.matched ?? false,
    driverId: result?.driverId,
    tier: result?.tier,
    reason: result?.reason,
  });
});

matchingWorker.on('failed', async (job, err) => {
  if (!job) {
    logger.error('Job failed (unknown job)', { error: err.message });
    return;
  }

  const log = logger.child({ jobId: job.id, deliveryId: job.data?.deliveryId });
  const maxAttempts = job.opts?.attempts ?? 3;
  const isLastAttempt = job.attemptsMade >= maxAttempts;

  if (isLastAttempt) {
    const { deliveryId, customerId } = job.data;

    log.error('All retries exhausted — marking delivery as routing_failed', {
      attempt: job.attemptsMade,
      maxAttempts,
      error: err.message,
      stack: err.stack,
    });

    await db
      .update(deliveries)
      .set({ status: 'routing_failed', updatedAt: new Date() })
      .where(eq(deliveries.id, deliveryId));

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
    log.warn('Job failed — will retry', {
      attempt: job.attemptsMade,
      maxAttempts,
      nextAttemptIn: `${Math.pow(2, job.attemptsMade) * 5}s`,
      error: err.message,
    });
  }
});

matchingWorker.on('stalled', (jobId) => {
  logger.warn('Job stalled — reservations will auto-expire, re-run starts fresh from GEOSEARCH', { jobId });
});

matchingWorker.on('error', (err) => {
  logger.error('Worker-level error', { error: err.message, stack: err.stack });
});

matchingWorker.on('active', (job) => {
  const log = logger.child({ jobId: job.id, deliveryId: job.data?.deliveryId });
  log.info('Job picked up', {
    attempt: job.attemptsMade + 1,
    legType: job.data?.legType,
    vehicleType: job.data?.vehicleType,
    delay: job.delay,
    waitedMs: job.processedOn ? job.processedOn - job.timestamp : undefined,
  });
});

// ─── Redis Events ─────────────────────────────────────────────────────────────

connection.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});

connection.on('reconnecting', () => {
  logger.warn('Redis reconnecting');
});

connection.on('ready', () => {
  logger.info('Redis connection ready');
});

// ─── Health Check ─────────────────────────────────────────────────────────────

startHealthServer(connection, matchingQueue);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await matchingWorker.close();
    await connection.quit();
    clearTimeout(forceExit);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Error during shutdown', { error: error.message, stack: error.stack });
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info('Started, listening on "matching" queue', {
  concurrency: 5,
  lockDuration: 360_000,
  stalledInterval: 60_000,
  redisUrl: (process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\/.*@/, '//***@'),
});
