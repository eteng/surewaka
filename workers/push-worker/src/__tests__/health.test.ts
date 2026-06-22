import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { recordProcessed, recordFailed, startHealthServer } from '../health';

// Mock BullMQ Queue
function createMockQueue(waitingCount: number, activeCount: number) {
  return {
    getWaitingCount: vi.fn().mockResolvedValue(waitingCount),
    getActiveCount: vi.fn().mockResolvedValue(activeCount),
  } as unknown as import('bullmq').Queue;
}

function fetchUrl(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode!, body: JSON.parse(data) });
      });
    });
    request.on('error', reject);
  });
}

let portCounter = 19800;
function nextPort() {
  return portCounter++;
}

describe('health module', () => {
  let server: ReturnType<typeof startHealthServer> | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  describe('recordProcessed / recordFailed', () => {
    it('should not throw when recording metrics', () => {
      expect(() => recordProcessed('transactional')).not.toThrow();
      expect(() => recordProcessed('broadcast')).not.toThrow();
      expect(() => recordFailed('transactional')).not.toThrow();
      expect(() => recordFailed('broadcast')).not.toThrow();
    });
  });

  describe('startHealthServer', () => {
    it('should start and respond to GET /health with metrics', async () => {
      const port = nextPort();
      vi.stubEnv('PUSH_WORKER_HEALTH_PORT', String(port));

      const txQueue = createMockQueue(5, 2);
      const bcQueue = createMockQueue(3, 1);

      server = startHealthServer(txQueue, bcQueue);
      await new Promise<void>((resolve) => server!.on('listening', resolve));

      const { status, body } = await fetchUrl(port, '/health');

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: 'healthy',
        transactional: {
          depth: 7,
          processedPerMinute: expect.any(Number),
          failureRate: expect.any(Number),
        },
        broadcast: {
          depth: 4,
          processedPerMinute: expect.any(Number),
          failureRate: expect.any(Number),
        },
        timestamp: expect.any(String),
      });
    });

    it('should return 404 for unknown paths', async () => {
      const port = nextPort();
      vi.stubEnv('PUSH_WORKER_HEALTH_PORT', String(port));

      const txQueue = createMockQueue(0, 0);
      const bcQueue = createMockQueue(0, 0);

      server = startHealthServer(txQueue, bcQueue);
      await new Promise<void>((resolve) => server!.on('listening', resolve));

      const { status, body } = await fetchUrl(port, '/unknown');

      expect(status).toBe(404);
      expect(body).toMatchObject({ error: 'Not Found' });
    });

    it('should report degraded status when queue depth exceeds threshold', async () => {
      const port = nextPort();
      vi.stubEnv('PUSH_WORKER_HEALTH_PORT', String(port));

      const txQueue = createMockQueue(900, 200); // 1100 > 1000 threshold
      const bcQueue = createMockQueue(0, 0);

      server = startHealthServer(txQueue, bcQueue);
      await new Promise<void>((resolve) => server!.on('listening', resolve));

      const { body } = await fetchUrl(port, '/health');
      expect((body as { status: string }).status).toBe('degraded');
    });

    it('should return 503 when queue methods throw', async () => {
      const port = nextPort();
      vi.stubEnv('PUSH_WORKER_HEALTH_PORT', String(port));

      const txQueue = {
        getWaitingCount: vi.fn().mockRejectedValue(new Error('Redis down')),
        getActiveCount: vi.fn().mockRejectedValue(new Error('Redis down')),
      } as unknown as import('bullmq').Queue;
      const bcQueue = createMockQueue(0, 0);

      server = startHealthServer(txQueue, bcQueue);
      await new Promise<void>((resolve) => server!.on('listening', resolve));

      const { status, body } = await fetchUrl(port, '/health');

      expect(status).toBe(503);
      expect(body).toMatchObject({ status: 'error', error: 'Redis down' });
    });
  });
});
