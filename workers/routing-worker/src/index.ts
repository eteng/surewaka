import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { routingQueue } from './queue';
import { startHealthServer } from './health';
import { logger } from './lib/logger';

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
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 2,
    metrics: { maxDataPoints: 60 * 24 }, // 24h of 1-min data points
  },
);

// ─── Observability ────────────────────────────────────────────────────────────

worker.on('completed', (job) => {
  const elapsed = Date.now() - (job.processedOn ?? Date.now());
  const log = logger.child({ jobId: job.id, deliveryId: job.data?.deliveryId });
  log.info('Job completed', {
    durationMs: elapsed,
    attempts: job.attemptsMade,
    dataSize: JSON.stringify(job.data).length,
  });
});

worker.on('failed', (job, err) => {
  if (!job) {
    logger.error('Job failed (unknown job)', { error: err.message });
    return;
  }
  const log = logger.child({ jobId: job.id, deliveryId: job.data?.deliveryId });
  const maxAttempts = job.opts?.attempts ?? 3;
  const isLastAttempt = job.attemptsMade >= maxAttempts;

  log.error('Job failed', {
    attempt: job.attemptsMade,
    maxAttempts,
    isLastAttempt,
    error: err.message,
    stack: err.stack,
  });
});

worker.on('stalled', (jobId) => {
  logger.warn('Job stalled — will be retried', { jobId });
});

worker.on('error', (err) => {
  logger.error('Worker-level error', { error: err.message, stack: err.stack });
});

worker.on('active', (job) => {
  const log = logger.child({ jobId: job.id, deliveryId: job.data?.deliveryId });
  log.info('Job picked up', {
    attempt: job.attemptsMade + 1,
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

startHealthServer(connection, routingQueue);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await worker.close();
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

logger.info('Started, listening on "routing" queue', {
  concurrency: 3,
  lockDuration: 120_000,
  stalledInterval: 60_000,
  redisUrl: (process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\/.*@/, '//***@'),
});
