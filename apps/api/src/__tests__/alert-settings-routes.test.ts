import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{
          driverSilentWarningMin: 15,
          driverSilentCriticalMin: 30,
          legOverdueWarningMin: 30,
          legOverdueCriticalMin: 60,
          customerUpdateGapWarningMin: 45,
          customerUpdateGapCriticalMin: 90,
          ontimeRateWarningPct: 80,
          ontimeRateCriticalPct: 60,
          pumbleWebhookUrl: null,
          pushEnabled: true,
          pumbleEnabled: false,
        }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ driverSilentWarningMin: 20 }]),
      }),
    }),
  },
  alertSettings: {},
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: Context, next: () => Promise<void>) => { c.set('user', { id: 'u1' }); await next(); }),
}));

vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: Context, next: () => Promise<void>) => next()),
}));

async function createTestApp() {
  const { default: alertSettingsRoutes } = await import('../routes/admin/alert-settings');
  const app = new Hono();
  app.route('/api/v1/admin/alert-settings', alertSettingsRoutes);
  return app;
}

describe('GET /api/v1/admin/alert-settings', () => {
  it('returns current settings', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/alert-settings', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { driverSilentWarningMin: number }; error: unknown };
    expect(body.data.driverSilentWarningMin).toBe(15);
    expect(body.error).toBeNull();
  });
});

describe('PUT /api/v1/admin/alert-settings', () => {
  it('returns 400 for invalid threshold', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/alert-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ driverSilentWarningMin: 3 }), // below min of 5
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { data: unknown; error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns updated settings for valid body', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/alert-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ driverSilentWarningMin: 20 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { driverSilentWarningMin: number }; error: unknown };
    expect(body.data.driverSilentWarningMin).toBe(20);
    expect(body.error).toBeNull();
  });
});

describe('POST /api/v1/admin/alert-settings/test', () => {
  it('returns 200 with sent: true', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/alert-settings/test', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { sent: boolean; pumble: boolean; push: boolean }; error: unknown };
    expect(body.data.sent).toBe(true);
    expect(typeof body.data.pumble).toBe('boolean');
    expect(typeof body.data.push).toBe('boolean');
    expect(body.error).toBeNull();
  });
});
