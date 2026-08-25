import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { db } from '@surewaka/db';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

const mockUpdateDriverLocation = vi.fn().mockResolvedValue(undefined);

vi.mock('@surewaka/realtime', () => ({
  initLocationStore: vi.fn(),
  updateDriverLocation: (...args: unknown[]) => mockUpdateDriverLocation(...args),
}));

vi.mock('../lib/redis', () => ({
  getRedis: vi.fn().mockReturnValue({}),
}));

vi.mock('../lib/realtime', () => ({
  getRealtime: vi.fn().mockReturnValue({ publish: vi.fn() }),
}));

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
          limit: vi.fn().mockResolvedValue([{ id: 'driver-1', vehicleType: 'motorcycle' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  driverLocations: {},
  drivers: { id: 'drivers.id', userId: 'drivers.userId', vehicleType: 'drivers.vehicleType' },
  deliveries: {},
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../middleware/auth', () => stubAuthModule(personas.driver()));

async function createTestApp() {
  const mod = await import('../routes/driver-locations');
  const app = new Hono();
  app.route('/api/v1/driver/location', mod.default);
  return { app, resetRateLimit: mod._resetRateLimit, resetPgWriteThrottle: mod._resetPgWriteThrottle };
}

describe('POST /api/v1/driver/location', () => {
  let app: Hono;
  let resetRateLimit: () => void;
  let resetPgWriteThrottle: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    const result = await createTestApp();
    app = result.app;
    resetRateLimit = result.resetRateLimit;
    resetPgWriteThrottle = result.resetPgWriteThrottle;
    resetRateLimit();
    resetPgWriteThrottle();
  });

  it('returns 400 for invalid coordinates', async () => {
    const res = await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 999, lng: 3.3792 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with recorded:true for valid ping without deliveryId', async () => {
    const res = await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { recorded: boolean; persisted: boolean } };
    expect(body.data.recorded).toBe(true);
    expect(body.data.persisted).toBe(true);
  });

  it('calls updateDriverLocation with validated data', async () => {
    await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
    });
    expect(mockUpdateDriverLocation).toHaveBeenCalledWith(
      'driver-1',
      3.3792,
      6.5244,
      { status: 'available', vehicleType: 'motorcycle' },
      { deliveryId: undefined },
    );
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 429 when second request is within 2s (rate limited)', async () => {
      // First request succeeds
      const res1 = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });
      expect(res1.status).toBe(200);

      // Second request within 2s should be rate limited
      const res2 = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });
      expect(res2.status).toBe(429);
      const body = (await res2.json()) as { error: { code: string } };
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('allows request after 2s have elapsed', async () => {
      // First request succeeds
      const res1 = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });
      expect(res1.status).toBe(200);

      // Advance time past the 2s rate limit window
      vi.advanceTimersByTime(2001);

      // Second request after 2s should succeed
      const res2 = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });
      expect(res2.status).toBe(200);
    });
  });

  describe('postgres write throttling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('persists to Postgres on the first ping', async () => {
      const res = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { persisted: boolean } };
      expect(body.data.persisted).toBe(true);
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('skips the Postgres write for a ping inside the throttle window, but still updates Redis/Ably every time', async () => {
      await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });

      // Past the 2s request rate limit, but well inside the 15s Postgres throttle
      vi.advanceTimersByTime(2001);

      const res2 = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });

      expect(res2.status).toBe(200);
      const body = (await res2.json()) as { data: { recorded: boolean; persisted: boolean } };
      expect(body.data.recorded).toBe(true);
      expect(body.data.persisted).toBe(false);
      // Only the first ping should have touched Postgres
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.insert).not.toHaveBeenCalled();
      // Redis/Ably still got both pings — the live-tracking path isn't throttled
      expect(mockUpdateDriverLocation).toHaveBeenCalledTimes(2);
    });

    it('persists again once the throttle window has elapsed', async () => {
      await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });

      vi.advanceTimersByTime(15_001);

      const res2 = await app.request('/api/v1/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
      });

      expect(res2.status).toBe(200);
      const body = (await res2.json()) as { data: { persisted: boolean } };
      expect(body.data.persisted).toBe(true);
      expect(db.update).toHaveBeenCalledTimes(2);
    });
  });
});
