import { eq } from 'drizzle-orm';
import { db, systemConfig } from '@surewaka/db';
import type { z } from 'zod';
import { configRegistry } from './registry';
import type { ConfigKey } from './registry';

const cache = new Map<string, { value: unknown; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getConfig<K extends ConfigKey>(
  key: K,
): Promise<z.infer<typeof configRegistry[K]['schema']>> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as z.infer<typeof configRegistry[K]['schema']>;
  }

  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  const entry = configRegistry[key];
  const value = row ? entry.schema.parse(row.value) : entry.default;
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value as z.infer<typeof configRegistry[K]['schema']>;
}

export function invalidateConfig(key: string): void {
  cache.delete(key);
}

// Exposed for tests only — clears the entire cache
export function _resetConfigCache(): void {
  cache.clear();
}
