/**
 * Admin Queue Dashboard API Routes.
 *
 * Provides full BullMQ introspection for the admin dashboard:
 * - List all queues with job counts
 * - Browse jobs by status with pagination
 * - Inspect individual job payloads, stack traces, timing
 * - Actions: retry, remove, clean, pause/resume
 * - Real-time SSE event stream
 *
 * All routes require surewaka_admin role.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';
import {
  getQueue,
  getAllQueues,
  getQueueEvents,
  getRedisInfo,
  redactJobData,
  QUEUE_META,
  type QueueName,
} from '../../lib/queue-registry';
import { getWorkerHealth } from '../../lib/worker-registry';

type QueueEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const queueRoutes = new Hono<QueueEnv>();

// All routes require admin auth
queueRoutes.use('*', requireAuth);
queueRoutes.use('*', requireRole('surewaka_admin'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_QUEUE_NAMES = new Set(QUEUE_META.map((m) => m.name));

const VALID_STATUSES = [
  'active', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized',
] as const;
type JobStatus = (typeof VALID_STATUSES)[number];

function isValidQueueName(name: string): name is QueueName {
  return VALID_QUEUE_NAMES.has(name as QueueName);
}

function isValidStatus(status: string): status is JobStatus {
  return VALID_STATUSES.includes(status as JobStatus);
}

function formatJob(job: {
  id?: string;
  name: string;
  data: unknown;
  opts: unknown;
  timestamp: number;
  processedOn?: number | null;
  finishedOn?: number | null;
  attemptsMade: number;
  failedReason?: string | null;
  stacktrace?: string[] | null;
  returnvalue?: unknown;
  progress?: number | object | null;
  delay?: number;
}, redact = true) {
  return {
    id: job.id,
    name: job.name,
    data: redact ? redactJobData(job.data) : job.data,
    opts: job.opts,
    timestamp: job.timestamp,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    stacktrace: job.stacktrace ?? [],
    returnvalue: job.returnvalue ?? null,
    progress: job.progress ?? null,
    delay: job.delay ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /metrics — Aggregate metrics across all queues (time-series + Redis info)
// Query params: period ('day' | 'month', default 'day')
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.get('/metrics', async (c) => {
  const period = c.req.query('period') ?? 'day';
  // day = last 24h (1440 data points at 1-min granularity)
  // month = last 30 days (we downsample to hourly = 720 points)
  const dataPoints = period === 'month' ? 60 * 24 * 30 : 60 * 24;

  try {
    const allQueues = getAllQueues();

    // Get metrics for each queue
    const metricsPromises = QUEUE_META.map(async (meta) => {
      const queue = allQueues.get(meta.name)!;
      const [completed, failed] = await Promise.all([
        queue.getMetrics('completed', 0, dataPoints).catch(() => ({ data: [], count: 0, meta: { count: 0, prevTS: 0, prevCount: 0 } })),
        queue.getMetrics('failed', 0, dataPoints).catch(() => ({ data: [], count: 0, meta: { count: 0, prevTS: 0, prevCount: 0 } })),
      ]);
      return { name: meta.name, completed, failed };
    });

    const metrics = await Promise.all(metricsPromises);

    // Get Redis INFO
    const redisInfo = await getRedisInfo();

    // Compute throughput (jobs/min over last 5 minutes)
    let throughputPerMin = 0;
    for (const m of metrics) {
      const recentCompleted = m.completed.data.slice(0, 5);
      throughputPerMin += recentCompleted.reduce((sum, v) => sum + v, 0) / Math.max(recentCompleted.length, 1);
    }

    // Compute fail rate (last 7 days)
    let totalCompleted7d = 0;
    let totalFailed7d = 0;
    for (const m of metrics) {
      const completedData = m.completed.data.slice(0, 60 * 24 * 7); // 7 days
      const failedData = m.failed.data.slice(0, 60 * 24 * 7);
      totalCompleted7d += completedData.reduce((sum, v) => sum + v, 0);
      totalFailed7d += failedData.reduce((sum, v) => sum + v, 0);
    }
    const total7d = totalCompleted7d + totalFailed7d;
    const failRate = total7d > 0 ? ((totalFailed7d / total7d) * 100).toFixed(1) : '0';

    return c.json({
      data: {
        redis: redisInfo,
        throughputPerMin: Math.round(throughputPerMin),
        failRate: parseFloat(failRate),
        totalJobs7d: total7d,
        queues: metrics.map((m) => ({
          name: m.name,
          completed: m.completed.data,
          failed: m.failed.data,
          totalCompleted: m.completed.count,
          totalFailed: m.failed.count,
        })),
      },
      error: null,
      meta: { period, dataPoints },
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'METRICS_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /workers — Non-queue worker state: health-endpoint workers + known stubs
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.get('/workers', async (c) => {
  try {
    const workers = await getWorkerHealth();
    return c.json({ data: workers, error: null, meta: null });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'WORKER_HEALTH_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET / — List all queues with job counts and status
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.get('/', async (c) => {
  try {
    const allQueues = getAllQueues();
    const results = await Promise.all(
      QUEUE_META.map(async (meta) => {
        const queue = allQueues.get(meta.name)!;
        const [counts, isPaused, workers, workersCount] = await Promise.all([
          queue.getJobCounts(
            'active', 'waiting', 'completed', 'failed', 'delayed', 'paused', 'prioritized',
          ),
          queue.isPaused(),
          queue.getWorkers().catch(() => []),
          queue.getWorkersCount().catch(() => 0),
        ]);

        return {
          name: meta.name,
          displayName: meta.displayName,
          description: meta.description,
          isPaused,
          counts,
          totalFailed: counts.failed ?? 0,
          totalActive: counts.active ?? 0,
          workers: {
            count: workersCount,
            instances: workers,
          },
        };
      }),
    );

    return c.json({ data: results, error: null, meta: null });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'QUEUE_INTROSPECTION_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:name/jobs — Paginated job list by status
// Query params: status (default 'active'), page (default 1), limit (default 20)
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.get('/:name/jobs', async (c) => {
  const { name } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  const status = c.req.query('status') ?? 'active';
  if (!isValidStatus(status)) {
    return c.json(
      { data: null, error: { code: 'INVALID_STATUS', message: `Status "${status}" is not valid` }, meta: null },
      400,
    );
  }

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)));
  const start = (page - 1) * limit;
  const end = start + limit - 1;

  try {
    const queue = getQueue(name);
    const jobs = await queue.getJobs([status], start, end);
    const counts = await queue.getJobCounts(status);
    const total = counts[status] ?? 0;

    const formattedJobs = jobs.map((job) => formatJob(job as unknown as Parameters<typeof formatJob>[0]));

    return c.json({
      data: formattedJobs,
      error: null,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), status },
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'JOB_FETCH_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:name/jobs/:jobId — Single job detail (full payload, no redaction)
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.get('/:name/jobs/:jobId', async (c) => {
  const { name, jobId } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  try {
    const queue = getQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) {
      return c.json(
        { data: null, error: { code: 'JOB_NOT_FOUND', message: `Job "${jobId}" not found` }, meta: null },
        404,
      );
    }

    const state = await job.getState();
    const logs = await queue.getJobLogs(jobId, 0, 100);

    return c.json({
      data: {
        ...formatJob(job as unknown as Parameters<typeof formatJob>[0], false), // Full payload for detail view (admin only)
        state,
        logs: logs.logs,
        logsCount: logs.count,
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'JOB_DETAIL_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:name/jobs/:jobId/retry — Retry a failed job
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.post('/:name/jobs/:jobId/retry', async (c) => {
  const { name, jobId } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  try {
    const queue = getQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) {
      return c.json(
        { data: null, error: { code: 'JOB_NOT_FOUND', message: `Job "${jobId}" not found` }, meta: null },
        404,
      );
    }

    const state = await job.getState();
    if (state !== 'failed') {
      return c.json(
        { data: null, error: { code: 'INVALID_STATE', message: `Can only retry failed jobs (current: ${state})` }, meta: null },
        400,
      );
    }

    await job.retry();
    return c.json({ data: { success: true, jobId }, error: null, meta: null });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'RETRY_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /:name/jobs/:jobId — Remove a single job
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.delete('/:name/jobs/:jobId', async (c) => {
  const { name, jobId } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  try {
    const queue = getQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) {
      return c.json(
        { data: null, error: { code: 'JOB_NOT_FOUND', message: `Job "${jobId}" not found` }, meta: null },
        404,
      );
    }

    await job.remove();
    return c.json({ data: { success: true, jobId }, error: null, meta: null });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'REMOVE_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:name/clean — Batch clean jobs by status
// Body: { status: string, grace?: number (ms, default 0), limit?: number (default 1000) }
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.post('/:name/clean', async (c) => {
  const { name } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  const body = await c.req.json<{ status?: string; grace?: number; limit?: number }>();
  const status = body.status ?? 'completed';
  if (!isValidStatus(status)) {
    return c.json(
      { data: null, error: { code: 'INVALID_STATUS', message: `Status "${status}" is not valid for cleaning` }, meta: null },
      400,
    );
  }

  const grace = Math.max(0, body.grace ?? 0);
  const limit = Math.min(10_000, Math.max(1, body.limit ?? 1000));

  try {
    const queue = getQueue(name);
    const removed = await queue.clean(grace, limit, status);
    return c.json({
      data: { success: true, removed: removed.length, status },
      error: null,
      meta: null,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'CLEAN_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:name/pause — Pause a queue
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.post('/:name/pause', async (c) => {
  const { name } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  try {
    const queue = getQueue(name);
    await queue.pause();
    return c.json({ data: { success: true, paused: true }, error: null, meta: null });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'PAUSE_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:name/resume — Resume a paused queue
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.post('/:name/resume', async (c) => {
  const { name } = c.req.param();
  if (!isValidQueueName(name)) {
    return c.json(
      { data: null, error: { code: 'INVALID_QUEUE', message: `Queue "${name}" not found` }, meta: null },
      404,
    );
  }

  try {
    const queue = getQueue(name);
    await queue.resume();
    return c.json({ data: { success: true, paused: false }, error: null, meta: null });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return c.json(
      { data: null, error: { code: 'RESUME_ERROR', message: error.message }, meta: null },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /events — Real-time SSE stream of queue events
// ═══════════════════════════════════════════════════════════════════════════════

queueRoutes.get('/events', async (c) => {
  return streamSSE(c, async (stream) => {
    const abortController = new AbortController();

    // Track listeners for cleanup
    const cleanups: Array<() => void> = [];

    // Subscribe to all queue events
    for (const meta of QUEUE_META) {
      const qe = getQueueEvents(meta.name);

      const onCompleted = ({ jobId, returnvalue }: { jobId: string; returnvalue: string }) => {
        stream.writeSSE({
          event: 'job:completed',
          data: JSON.stringify({ queue: meta.name, jobId, returnvalue }),
        });
      };

      const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
        stream.writeSSE({
          event: 'job:failed',
          data: JSON.stringify({ queue: meta.name, jobId, failedReason }),
        });
      };

      const onActive = ({ jobId }: { jobId: string }) => {
        stream.writeSSE({
          event: 'job:active',
          data: JSON.stringify({ queue: meta.name, jobId }),
        });
      };

      const onWaiting = ({ jobId }: { jobId: string }) => {
        stream.writeSSE({
          event: 'job:waiting',
          data: JSON.stringify({ queue: meta.name, jobId }),
        });
      };

      const onStalled = ({ jobId }: { jobId: string }) => {
        stream.writeSSE({
          event: 'job:stalled',
          data: JSON.stringify({ queue: meta.name, jobId }),
        });
      };

      qe.on('completed', onCompleted);
      qe.on('failed', onFailed);
      qe.on('active', onActive);
      qe.on('waiting', onWaiting);
      qe.on('stalled', onStalled);

      cleanups.push(() => {
        qe.off('completed', onCompleted);
        qe.off('failed', onFailed);
        qe.off('active', onActive);
        qe.off('waiting', onWaiting);
        qe.off('stalled', onStalled);
      });
    }

    // Send initial heartbeat
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ queues: QUEUE_META.map((m) => m.name) }) });

    // Keep-alive heartbeat every 30s
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ time: new Date().toISOString() }) });
    }, 30_000);

    // Wait for disconnect
    stream.onAbort(() => {
      abortController.abort();
      clearInterval(heartbeat);
      for (const cleanup of cleanups) cleanup();
    });

    // Keep the stream open until client disconnects
    await new Promise<void>((resolve) => {
      abortController.signal.addEventListener('abort', () => resolve());
    });
  });
});

export default queueRoutes;
