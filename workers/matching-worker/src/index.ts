import { Worker } from 'bullmq';
import { connection } from './queue';
import { db, deliveries } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { enqueuePushFromWorker } from './push-enqueue';

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
  },
);

// ─── Observability ────────────────────────────────────────────────────────────

matchingWorker.on('completed', (job) => {
  const elapsed = Date.now() - (job.processedOn ?? Date.now());
  console.info(`[matching-worker] Job ${job.id} completed in ${elapsed}ms`);
});

// Req 15.2: On all retries exhausted, mark delivery as 'routing_failed' and notify customer
matchingWorker.on('failed', async (job, err) => {
  if (!job) return;

  const maxAttempts = job.opts?.attempts ?? 3;
  if (job.attemptsMade >= maxAttempts) {
    const { deliveryId, customerId } = job.data;

    console.error(
      `[matching-worker] All retries exhausted for delivery ${deliveryId}:`,
      err.message,
    );

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

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string) {
  console.info(`[matching-worker] Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[matching-worker] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await matchingWorker.close();
    await connection.quit();
    clearTimeout(forceExit);
    console.info('[matching-worker] Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[matching-worker] Error during shutdown:', err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[matching-worker] Started, listening on "matching" queue');
