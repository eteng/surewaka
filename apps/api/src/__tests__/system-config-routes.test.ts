import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        // Supports: await db.select().from(t)              (buildConfigList — no where/limit)
        //           await db.select().from(t).where().limit()  (GET /:key)
        const chain: {
          then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
          catch: (fn: (e: unknown) => unknown) => Promise<unknown>;
          where: ReturnType<typeof vi.fn>;
          limit: ReturnType<typeof vi.fn>;
        } = {
          then: (resolve, reject) => Promise.resolve([]).then(resolve, reject),
          catch: (fn) => Promise.resolve([]).catch(fn),
          where: vi.fn(),
          limit: vi.fn().mockResolvedValue([]),
        };
        chain.where.mockReturnValue(chain);
        return chain;
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            key: 'matching.tier1_radius_km',
            value: 7,
            updatedBy: 'user-id',
            updatedAt: new Date('2026-07-27T10:00:00Z'),
          }]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{}]),
          }),
        }),
      }),
    })),
  },
  systemConfig: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('@surewaka/shared', async () => {
  const actual = await vi.importActual<typeof import('@surewaka/shared')>('@surewaka/shared');
  return { ...actual, invalidateConfig: vi.fn() };
});
vi.mock('../middleware/auth', () => stubAuthModule(personas.admin()));
vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: Context, next: () => Promise<void>) => next()),
}));

async function createTestApp() {
  const { default: systemConfigRoutes } = await import('../routes/admin/system-config');
  const app = new Hono();
  app.route('/api/v1/admin/config', systemConfigRoutes);
  return app;
}

describe('GET /api/v1/admin/config', () => {
  it('returns all registry keys with defaults for unseeded rows', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ key: string; value: unknown }> };
    expect(body.data.length).toBeGreaterThan(0);
    const bufferItem = body.data.find((d) => d.key === 'matching.first_mile_dispatch_buffer_min');
    expect(bufferItem?.value).toBe(45);
  });
});

describe('GET /api/v1/admin/config/export', () => {
  it('returns flat JSON with all config keys', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/export', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as Record<string, unknown>;
    expect(body['matching.first_mile_dispatch_buffer_min']).toBe(45);
    expect(body['matching.tier1_radius_km']).toBe(5);
  });
});

describe('GET /api/v1/admin/config/:key', () => {
  it('returns 400 for an unknown config key', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/does.not.exist', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNKNOWN_CONFIG_KEY');
  });

  it('returns registry default when no DB row exists', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { key: string; value: unknown } };
    expect(body.data.key).toBe('matching.tier1_radius_km');
    expect(body.data.value).toBe(5);
  });
});

describe('PUT /api/v1/admin/config/:key', () => {
  it('returns 400 for an unknown config key', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/unknown.key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNKNOWN_CONFIG_KEY');
  });

  it('returns 400 when value fails schema validation', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ value: 999 }), // max is 20
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('upserts and returns updated value on valid input', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ value: 7 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { key: string; value: unknown } };
    expect(body.data.value).toBe(7);
  });
});

describe('POST /api/v1/admin/config/:key/reset', () => {
  it('returns 400 for unknown key', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/unknown.key/reset', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(400);
  });

  it('returns registry default after reset', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km/reset', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { value: unknown } };
    expect(body.data.value).toBe(5);
  });
});

describe('POST /api/v1/admin/config/import', () => {
  it('returns 400 when a registered key has invalid value — no partial writes', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ 'matching.tier1_radius_km': 999 }), // exceeds max
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveLength(1);
  });

  it('skips unknown keys and imports valid ones', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({
        'matching.tier1_radius_km': 6,
        'some.unknown.key': 'ignored',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { imported: number; skipped: number } };
    expect(body.data.imported).toBe(1);
    expect(body.data.skipped).toBe(1);
  });
});
