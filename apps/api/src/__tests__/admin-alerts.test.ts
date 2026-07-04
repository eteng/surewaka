import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';

vi.mock('@surewaka/db', () => ({
  db: { execute: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: Context, next: () => Promise<void>) => { c.set('user', { id: 'u1' }); await next(); }),
}));
vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: Context, next: () => Promise<void>) => next()),
}));

async function createTestApp() {
  const { default: alertRoutes } = await import('../routes/admin/alerts');
  const app = new Hono();
  app.route('/api/v1/admin/alerts', alertRoutes);
  return app;
}

describe('GET /api/v1/admin/alerts', () => {
  it('returns 200 with empty array when no alerts', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/alerts', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown; error: unknown };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.error).toBeNull();
  });
});
