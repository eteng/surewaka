import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PUSH_QUEUE_NAME, PUSH_BROADCAST_QUEUE_NAME } from '@surewaka/shared';
import type { PushJobData, BroadcastChunkJobData } from '@surewaka/shared';
import { processTransactionalJob, processBroadcastChunkJob } from './processor';
import { startHealthServer, recordProcessed, recordFailed } from './health';

// ─── Redis Connection ────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let reconnectAttempts = 0;

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    reconnectAttempts = times;

    if (times > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `❌ Redis connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Exiting.`,
      );
      process.exit(1);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (times - 1), MAX_RECONNECT_DELAY_MS);
    console.warn(`⚠️  Redis reconnect attempt ${times}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    return delay;
  },
});

connection.on('connect', () => {
  reconnectAttempts = 0;
  console.log('🔗 Redis connected');
});

connection.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

// ─── Workers ─────────────────────────────────────────────────────────────────

const transactionalConcurrency = Number(process.env.PUSH_WORKER_CONCURRENCY) || 5;

const transactionalWorker = new Worker<PushJobData>(
  PUSH_QUEUE_NAME,
  async (job) => processTransactionalJob(job),
  {
    connection,
    concurrency: transactionalConcurrency,
  },
);

const broadcastWorker = new Worker<BroadcastChunkJobData>(
  PUSH_BROADCAST_QUEUE_NAME,
  async (job) => processBroadcastChunkJob(job),
  {
    connection,
    concurrency: 2, // Lower to avoid starving transactional jobs
  },
);

// ─── Worker Events ───────────────────────────────────────────────────────────

transactionalWorker.on('completed', (job) => {
  recordProcessed('transactional');
  console.log(`✅ Transactional job ${job.id} completed`);
});

transactionalWorker.on('failed', (job, err) => {
  recordFailed('transactional');
  console.error(`❌ Transactional job ${job?.id} failed:`, err.message);
});

broadcastWorker.on('completed', (job) => {
  recordProcessed('broadcast');
  console.log(`✅ Broadcast job ${job.id} completed`);
});

broadcastWorker.on('failed', (job, err) => {
  recordFailed('broadcast');
  console.error(`❌ Broadcast job ${job?.id} failed:`, err.message);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown() {
  console.log('🛑 Shutting down push worker...');
  await Promise.all([transactionalWorker.close(), broadcastWorker.close()]);
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Startup ─────────────────────────────────────────────────────────────────

// Queue instances for health check depth metrics (read-only)
const transactionalQueue = new Queue(PUSH_QUEUE_NAME, { connection });
const broadcastQueue = new Queue(PUSH_BROADCAST_QUEUE_NAME, { connection });

startHealthServer(transactionalQueue, broadcastQueue);

console.log(
  `🚀 Push worker started — transactional concurrency: ${transactionalConcurrency}, broadcast concurrency: 2`,
);
