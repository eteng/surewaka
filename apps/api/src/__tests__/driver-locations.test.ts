import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@surewaka/db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'loc-1' }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'driver-1' }]),
        }),
      }),
    }),
  },
  driverLocations: {},
  drivers: {},
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: any, next: any) => {
    c.set('user', { id: 'user-1' });
    await next();
  }),
}));

async function createTestApp() {
  const { default: driverLocationRoutes } = await import('../routes/driver-locations');
  const app = new Hono();
  app.route('/api/v1/driver/location', driverLocationRoutes);
  return app;
}

describe('POST /api/v1/driver/location', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('returns 400 for invalid coordinates', async () => {
    const res = await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 999, lng: 3.3792 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with location id for valid ping', async () => {
    const res = await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('loc-1');
  });
});
