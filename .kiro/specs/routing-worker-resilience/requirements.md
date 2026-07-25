# Routing Worker Resilience — Requirements

## Context

The routing worker (`workers/routing-worker`) processes `surewaka_way` deliveries asynchronously
via BullMQ. A routing job takes 10–30 seconds (DB queries, graph construction, Dijkstra, Mapbox
API calls, transaction, Ably publish). During this window the delivery sits in `pending_routing`.

Currently the worker has **no protection against stalled or orphaned jobs**:

- No `stalledInterval` — BullMQ's stall detection is only active when another worker instance
  is running. With a single process (`concurrency: 3`), a dead worker leaves jobs permanently
  in the "active" list.
- Default `lockDuration` is 30s — too short for a routing job that may take 30s+ (cold Neon
  connection, multiple Mapbox calls). The lock expires before the job completes, causing
  BullMQ to consider it stalled even when it's still running.
- No graceful shutdown — `SIGTERM` during a deploy kills mid-job, orphaning it.
- No external rescue — if BullMQ's stalled detection fails (single worker, Redis blip),
  deliveries stay in `pending_routing` indefinitely with no recovery path.

This spec adds four layers of resilience: proper BullMQ configuration, graceful shutdown,
a cron-based rescue job, and a health check endpoint.

---

## User Stories

### REQ-1 — BullMQ stalled job detection

WHEN a routing worker process dies mid-job (OOM, SIGKILL, machine eviction),  
THEN BullMQ detects the stalled job within 60 seconds,  
THEN the job is automatically returned to the waiting queue for retry.

Acceptance criteria:
- `lockDuration: 120_000` (2 minutes) — gives routing jobs enough time to complete without false stalls
- `stalledInterval: 60_000` (60 seconds) — checks for stalled jobs every minute
- `maxStalledCount: 2` — a job must stall twice before being moved to failed (forgives single GC pauses or transient network blips)
- Worker emits a `stalled` event → logged with `console.warn` including the job ID
- Existing `attempts: 3` on job creation (in `routing-queue.ts`) provides retry budget after stall recovery

### REQ-2 — Graceful shutdown on deploy

WHEN the worker process receives `SIGTERM` (Fly.io sends this 10s before eviction) or `SIGINT`,  
THEN in-progress jobs are allowed to complete (up to the lock duration),  
THEN the worker stops accepting new jobs,  
THEN the Redis connection is closed cleanly,  
THEN the process exits.

Acceptance criteria:
- `worker.close()` is called on SIGTERM/SIGINT — this waits for active jobs to finish
- Redis connection (`IORedis`) is quit after worker close
- Process exits with code 0 on clean shutdown
- If `worker.close()` takes longer than 30 seconds, force-exit with code 1 (prevents hanging deploys)
- Log: `[routing-worker] Shutting down gracefully...` on signal receipt
- Log: `[routing-worker] Shutdown complete` before exit

### REQ-3 — Cron rescue for orphaned deliveries

WHEN a delivery has been in `pending_routing` status for more than 10 minutes,  
THEN a cron job re-enqueues the routing job with a fresh `bookingTime`,  
THEN the delivery gets another chance at routing.

Acceptance criteria:
- New cron job: `rescue-stale-routing`, runs every 5 minutes
- Query: `SELECT id FROM deliveries WHERE status = 'pending_routing' AND created_at < now() - interval '10 minutes'`
- For each result: call `enqueueRouteDelivery({ deliveryId, bookingTime: new Date().toISOString(), vehicleType: 'motorcycle' })`
- Idempotent: the routing worker's existing check (`if (status !== 'pending_routing') skip`) prevents double-processing if the original job eventually completes
- Max 20 deliveries per cron run (prevent thundering herd if Redis was down for hours)
- Log: `[cron:rescue-stale-routing] Re-enqueued N stale deliveries`
- If zero stale deliveries found, no log (quiet when healthy)

### REQ-4 — Health check endpoint

WHEN Fly.io (or any orchestrator) checks the routing worker's health,  
THEN a lightweight HTTP endpoint reports whether the worker is alive and connected.

Acceptance criteria:
- HTTP server on port `process.env.HEALTH_PORT ?? 4003`
- `GET /health` returns 200 with JSON: `{ status: "ok", redis: "connected", queue: { waiting, active, failed } }`
- If Redis is disconnected, returns 503 with `{ status: "unhealthy", redis: "disconnected" }`
- Fly.io `fly.toml` configured with TCP or HTTP health check targeting this port
- Health server starts after worker is initialized (not before)
- Minimal dependencies — no framework, just `http.createServer`

### REQ-5 — Observability improvements

WHEN a job completes, fails, or stalls,  
THEN structured logs are emitted for debugging and alerting.

Acceptance criteria:
- `completed` event: log job ID + duration ms (already partially exists)
- `failed` event: log job ID + error message + attempt count (already partially exists)
- `stalled` event: log job ID with `console.warn` (new)
- `error` event: log worker-level errors (already exists)
- Add duration tracking: record `Date.now()` at job start, log elapsed on completion
- Format: `[routing-worker] Job <id> completed in <ms>ms` / `[routing-worker] Job <id> stalled`
