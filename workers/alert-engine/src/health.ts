import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

// alert-engine has no BullMQ queue to introspect — it runs a fixed-interval poll
// loop instead, so "healthy" here means "the loop is ticking on schedule and its
// last tick didn't throw", tracked via the record* functions below.

const STALL_THRESHOLD_MULTIPLIER = 3; // missed this many consecutive ticks → unhealthy

let lastTickStartedAt: number | null = null;
let lastTickCompletedAt: number | null = null;
let lastTickDurationMs: number | null = null;
let lastError: string | null = null;
let tickRunning = false;

export function recordTickStart(): void {
  tickRunning = true;
  lastTickStartedAt = Date.now();
}

export function recordTickSuccess(): void {
  tickRunning = false;
  lastTickCompletedAt = Date.now();
  lastTickDurationMs = lastTickStartedAt !== null ? lastTickCompletedAt - lastTickStartedAt : null;
  lastError = null;
}

export function recordTickError(err: unknown): void {
  tickRunning = false;
  lastError = err instanceof Error ? err.message : String(err);
}

export function startHealthServer(
  pollIntervalMs: number,
  port: number = Number(process.env.ALERT_ENGINE_HEALTH_PORT) || 4005,
): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/health' || req.method !== 'GET') {
      res.writeHead(404);
      res.end();
      return;
    }

    const now = Date.now();
    const msSinceLastTick = lastTickCompletedAt !== null ? now - lastTickCompletedAt : null;
    const stalled = lastTickCompletedAt === null
      ? lastTickStartedAt !== null && now - lastTickStartedAt > pollIntervalMs * STALL_THRESHOLD_MULTIPLIER
      : msSinceLastTick !== null && msSinceLastTick > pollIntervalMs * STALL_THRESHOLD_MULTIPLIER;

    const status = stalled ? 'unhealthy' : lastError ? 'degraded' : 'ok';

    res.writeHead(status === 'unhealthy' ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status,
      tickRunning,
      lastTickStartedAt: lastTickStartedAt ? new Date(lastTickStartedAt).toISOString() : null,
      lastTickCompletedAt: lastTickCompletedAt ? new Date(lastTickCompletedAt).toISOString() : null,
      lastTickDurationMs,
      msSinceLastTick,
      lastError,
    }));
  });

  server.listen(port, () => {
    console.info(`[alert-engine] Health server on :${port}`);
  });
}
