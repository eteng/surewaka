import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type IORedis from 'ioredis';
import type { Queue } from 'bullmq';

export function startHealthServer(
  redis: IORedis,
  queue: Queue,
  port: number = Number(process.env.HEALTH_PORT) || 4004,
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
      res.end(JSON.stringify({ status: 'ok', redis: 'connected', queue: counts }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', redis: 'connected', queue: 'unavailable' }));
    }
  });

  server.listen(port, () => {
    console.info(`[matching-worker] Health server on :${port}`);
  });
}
