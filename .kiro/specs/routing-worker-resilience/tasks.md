# Routing Worker Resilience — Tasks

Bottom-up order: worker config → shutdown → cron rescue → health check → verification.
Pick up from the first unchecked task.

---

## Layer 1 — BullMQ Worker Configuration

- [ ] 1. Update `workers/routing-worker/src/index.ts`: add `lockDuration: 120_000`, `stalledInterval: 60_000`, `maxStalledCount: 2` to the Worker constructor options. Add `worker.on('stalled', (jobId) => console.warn(...))` event listener.

- [ ] 2. Add completion timing to `workers/routing-worker/src/index.ts`: listen to `worker.on('completed', (job) => ...)` and log elapsed time (`Date.now() - job.processedOn!`). Update the existing `worker.on('failed', ...)` handler to include `job.attemptsMade` in the log.

---

## Layer 2 — Graceful Shutdown

- [ ] 3. Add graceful shutdown handler to `workers/routing-worker/src/index.ts`: listen for `SIGTERM` and `SIGINT`, call `worker.close()` (waits for in-progress jobs), then `connection.quit()`, then `process.exit(0)`. Add a 30-second force-exit timeout — if `worker.close()` hangs, `process.exit(1)`.

---

## Layer 3 — Cron Rescue Job

- [ ] 4. Create `workers/cron/src/lib/routing-enqueue.ts`: thin BullMQ Queue client for the `routing` queue. Export `enqueueRouteDelivery(data)` with the same job options as `apps/api/src/lib/routing-queue.ts` (attempts: 3, exponential backoff, removeOnComplete/Fail counts).

- [ ] 5. Create `workers/cron/src/jobs/rescue-stale-routing.ts`: query deliveries with `status = 'pending_routing'` and `created_at < now() - 10 minutes`, limit 20. For each, call `enqueueRouteDelivery` with fresh bookingTime. Log count if > 0.

- [ ] 6. Register the rescue job in `workers/cron/src/index.ts`: add a `*/5 * * * *` schedule (every 5 minutes) that calls `rescueStaleRouting()`.

---

## Layer 4 — Health Check

- [ ] 7. Create `workers/routing-worker/src/health.ts`: minimal `http.createServer` on port `process.env.HEALTH_PORT ?? 4003`. `GET /health` returns 200 with `{ status, redis, queue }` JSON. Returns 503 if Redis is disconnected. Export `startHealthServer(redis, queue, port?)`.

- [ ] 8. Call `startHealthServer(connection, routingQueue)` in `workers/routing-worker/src/index.ts` after worker is initialized. Import `routingQueue` from `./queue.ts` (it already exports the Queue instance).

- [ ] 9. Update Fly.io config: add HTTP health check to `workers/fly.toml` (or create a routing-worker-specific fly.toml if workers are deployed separately) targeting port 4003 path `/health`, interval 15s, timeout 5s.

---

## Layer 5 — Testing

- [ ] 10. Create `workers/routing-worker/src/__tests__/resilience.test.ts`: test that the Worker is constructed with the correct options (mock BullMQ Worker constructor, assert `lockDuration`, `stalledInterval`, `maxStalledCount` are passed). Test that SIGTERM handler calls `worker.close()`.

- [ ] 11. Create `workers/cron/src/jobs/__tests__/rescue-stale-routing.test.ts`: mock `@surewaka/db` to return 2 stale deliveries; assert `enqueueRouteDelivery` is called twice with correct data. Test idempotency: if query returns 0 results, no enqueue calls are made.

---

## Layer 6 — Verification

- [ ] 12. Verify all workers compile: `pnpm --filter @surewaka/routing-worker exec tsc --noEmit` and `pnpm --filter @surewaka/cron exec tsc --noEmit` (adjust filter names to match package.json names).

- [ ] 13. Run full test suite: `pnpm test`. Fix any failures introduced by the changes.

- [ ] 14. Update `docs/issues/pricing-grilling-outcomes.md`: mark the "Routing worker resilience" task as complete.
