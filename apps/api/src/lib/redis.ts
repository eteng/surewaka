import IORedis from 'ioredis';

/**
 * Shared Redis client for the API server.
 *
 * Used by the location store (geospatial updates) and potentially
 * other features that need direct Redis access beyond BullMQ queues.
 *
 * Lazy-initialized on first access; reuses the same REDIS_URL env var
 * that BullMQ queues already consume.
 */
let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (!client) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    client = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return client;
}
