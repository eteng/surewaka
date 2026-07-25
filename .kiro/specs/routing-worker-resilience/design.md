# Routing Worker Resilience — Design

## Overview

Four layers of protection, each catching failures the previous layer missed:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  Layer 1: BullMQ Config        → detects stalls within 60s           │
│  Layer 2: Graceful Shutdown    → prevents stalls during deploys      │
│  Layer 3: Cron Rescue          → catches anything else (10-min max)  │
│  Layer 4: Health Check         → restarts zombie processes           │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

Worst case recovery time: 10 minutes (cron interval + stale threshold).
Typical case: 60 seconds (BullMQ stalled detection).
Deploy case: 0 seconds (graceful shutdown completes in-flight jobs).

---

## Layer 1: BullMQ Worker Configuration

### Current (`workers/routing-worker/src/index.ts`)

```ts
const worker = new Worker('routing', handler, {
  connection,
  concurrency: 3,
});
```

### Target

```ts
const worker = new Worker('routing', handler, {
  connection,
  concurrency: 3,
  lockDuration: 120_000,      // 2 min — job execution budget
  stalledInterval: 60_000,    // check every 60s for stalled
  maxStalledCount: 2,         // 2 stalls → failed (forgives 1 GC pause)
});
```

### Why these values

| Setting | Value | Reasoning |
|---------|-------|-----------|
| `lockDuration` | 120s | Routing job does: 3-5 DB queries + Mapbox calls + graph + Dijkstra + transaction + Ably. Cold path can take 30s. 120s gives 4× headroom. |
| `stalledInterval` | 60s | Checks once per minute. Customer wait for routing is already "under a minute" per UX copy — 60s extra is tolerable. |
| `maxStalledCount` | 2 | A single false stall (GC pause, Redis hiccup) gets forgiven. Two consecutive = actually dead. |

### Lock Renewal

BullMQ auto-renews locks at `lockDuration / 2` (60s). As long as the worker's event loop is responsive, locks renew indefinitely. A stall only triggers when the event loop is blocked for >60s or the process is dead.

---

## Layer 2: Graceful Shutdown

```ts
// workers/routing-worker/src/index.ts

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function shutdown(signal: string) {
  console.info(`[routing-worker] Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[routing-worker] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await worker.close(); // waits for in-progress jobs to complete
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
```

### Behavior during deploy

1. Fly.io sends `SIGTERM`
2. Worker stops accepting new jobs
3. In-progress jobs (up to 3 concurrent) finish their execution
4. Worker closes Redis connection
5. Process exits 0
6. Fly.io starts new machine with new code

If jobs take >30s to finish, the force-exit timer kills the process. Those jobs will be detected as stalled by the new machine's worker within 60s.

---

## Layer 3: Cron Rescue Job

### File: `workers/cron/src/jobs/rescue-stale-routing.ts`

```ts
import { db, deliveries } from '@surewaka/db';
import { eq, lt, and } from 'drizzle-orm';
import { enqueueRouteDelivery } from './lib/routing-enqueue';

const STALE_THRESHOLD_MINUTES = 10;
const MAX_RESCUE_BATCH = 20;

export async function rescueStaleRouting(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  const staleDeliveries = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, 'pending_routing'),
        lt(deliveries.createdAt, threshold),
      ),
    )
    .limit(MAX_RESCUE_BATCH);

  if (staleDeliveries.length === 0) return;

  for (const delivery of staleDeliveries) {
    await enqueueRouteDelivery({
      deliveryId: delivery.id,
      bookingTime: new Date().toISOString(),
      vehicleType: 'motorcycle',
    });
  }

  console.info(`[cron:rescue-stale-routing] Re-enqueued ${staleDeliveries.length} stale deliveries`);
}
```

### Registration in cron worker

Add to `workers/cron/src/index.ts` scheduler:
```ts
// Every 5 minutes
schedule('*/5 * * * *', 'rescue-stale-routing', rescueStaleRouting);
```

### Routing queue access from cron

The cron worker needs to enqueue to the `routing` queue. Create a thin helper:

**File: `workers/cron/src/lib/routing-enqueue.ts`**
```ts
import { Queue } from 'bullmq';

type RouteDeliveryJobData = {
  deliveryId: string;
  bookingTime: string;
  vehicleType: string;
};

const routingQueue = new Queue<RouteDeliveryJobData>('routing', {
  connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
});

export async function enqueueRouteDelivery(data: RouteDeliveryJobData): Promise<void> {
  await routingQueue.add('route-delivery', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
}
```

### Idempotency

The routing worker's `handleRouteDelivery` already checks:
```ts
if (delivery.status !== 'pending_routing') {
  console.info(`[routing-worker] Delivery ${deliveryId} in status ${delivery.status} — skip`);
  return;
}
```

If the original job completes between the cron query and the re-enqueued job being processed, the re-enqueued job sees `status: 'draft'` and exits immediately. No double-routing.

---

## Layer 4: Health Check

### File: `workers/routing-worker/src/health.ts`

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type IORedis from 'ioredis';
import type { Queue } from 'bullmq';

export function startHealthServer(
  redis: IORedis,
  queue: Queue,
  port: number = Number(process.env.HEALTH_PORT) || 4003,
): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/health' || req.method !== 'GET') {
      res.writeHead(404);
      res.end();
      return;
    }

    const redisOk = redis.status === 'ready';

    if (!redisOk) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', redis: 'disconnected' }));
      return;
    }

    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'failed');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        redis: 'connected',
        queue: counts,
      }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', redis: 'connected', queue: 'unavailable' }));
    }
  });

  server.listen(port, () => {
    console.info(`[routing-worker] Health server on :${port}`);
  });
}
```

### Fly.io configuration

Add to `workers/fly.toml` (or a dedicated `workers/routing-worker/fly.toml` if workers are split):

```toml
[[services.http_checks]]
  interval = 15000       # 15s
  timeout = 5000
  path = "/health"
  port = 4003
  method = "GET"
```

---

## Layer 5: Observability

### Event listeners (added to `workers/routing-worker/src/index.ts`)

```ts
worker.on('stalled', (jobId) => {
  console.warn(`[routing-worker] Job ${jobId} stalled`);
});

worker.on('completed', (job) => {
  const elapsed = Date.now() - job.processedOn!;
  console.info(`[routing-worker] Job ${job.id} completed in ${elapsed}ms`);
});

worker.on('failed', (job, err) => {
  console.error(`[routing-worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});
```

The existing `worker.on('error', ...)` handler is preserved as-is.

---

## File Changes Summary

| File | Change Type | Layer |
|------|------------|-------|
| `workers/routing-worker/src/index.ts` | Modify — add config, shutdown, event listeners | 1, 2, 5 |
| `workers/routing-worker/src/health.ts` | New | 4 |
| `workers/cron/src/jobs/rescue-stale-routing.ts` | New | 3 |
| `workers/cron/src/lib/routing-enqueue.ts` | New | 3 |
| `workers/cron/src/index.ts` | Modify — register rescue job | 3 |
| `workers/fly.toml` (or routing-worker-specific) | Modify — add health check | 4 |
