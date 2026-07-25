import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';

// We test the health server by importing and calling it with mocked dependencies
describe('Health Server', () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it('returns 200 with queue stats when Redis is ready', async () => {
    const mockRedis = { status: 'ready' } as unknown as import('ioredis').default;
    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 1, failed: 0 }),
    } as unknown as import('bullmq').Queue;

    const { startHealthServer } = await import('../health');

    // Use a random high port to avoid conflicts
    const port = 49100 + Math.floor(Math.random() * 900);
    startHealthServer(mockRedis, mockQueue, port);

    // Wait for server to be ready
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as { status: string; redis: string; queue: unknown };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.redis).toBe('connected');
    expect(body.queue).toEqual({ waiting: 2, active: 1, failed: 0 });
  });

  it('returns 503 when Redis is disconnected', async () => {
    const mockRedis = { status: 'connecting' } as unknown as import('ioredis').default;
    const mockQueue = {
      getJobCounts: vi.fn(),
    } as unknown as import('bullmq').Queue;

    const { startHealthServer } = await import('../health');

    const port = 49100 + Math.floor(Math.random() * 900);
    startHealthServer(mockRedis, mockQueue, port);

    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as { status: string; redis: string };

    expect(res.status).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(body.redis).toBe('disconnected');
    expect(mockQueue.getJobCounts).not.toHaveBeenCalled();
  });

  it('returns 404 for non-health paths', async () => {
    const mockRedis = { status: 'ready' } as unknown as import('ioredis').default;
    const mockQueue = {
      getJobCounts: vi.fn(),
    } as unknown as import('bullmq').Queue;

    const { startHealthServer } = await import('../health');

    const port = 49100 + Math.floor(Math.random() * 900);
    startHealthServer(mockRedis, mockQueue, port);

    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${port}/other`);
    expect(res.status).toBe(404);
  });
});
