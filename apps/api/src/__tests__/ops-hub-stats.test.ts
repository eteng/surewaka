import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@surewaka/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue([
      { active_deliveries: '5', drivers_on_duty: '8', drivers_available: '3',
        at_risk_deliveries: '2', open_disputes: '1', on_time_rate_today: '87.50' },
    ]),
    update: vi.fn(),
  },
  deliveries: {},
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: any, next: any) => { c.set('user', { id: 'u1' }); await next(); }),
}));
vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: any, next: any) => next()),
}));

async function createTestApp() {
  const { default: opsHubRoutes } = await import('../routes/admin/ops-hub');
  const app = new Hono();
  app.route('/api/v1/admin/ops-hub', opsHubRoutes);
  return app;
}

describe('GET /api/v1/admin/ops-hub/stats', () => {
  it('returns 200 with OpsHubStats shape', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/ops-hub/stats', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toMatchObject({
      activeDeliveries: 5,
      driversOnDuty: 8,
      driversAvailable: 3,
      atRiskDeliveries: 2,
      openDisputes: 1,
      onTimeRateToday: 87.5,
    });
  });
});
