import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

// ── Mock setup ────────────────────────────────────────────────────────────────

const mockClaimDelivery = vi.fn();
const mockReleaseReservations = vi.fn();

vi.mock('../lib/matching-redis', () => ({
  claimDelivery: (...args: unknown[]) => mockClaimDelivery(...args),
  releaseReservations: (...args: unknown[]) => mockReleaseReservations(...args),
}));

vi.mock('../lib/redis', () => ({
  getRedis: vi.fn().mockReturnValue({}),
}));

const mockPublish = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/realtime', () => ({
  getRealtime: vi.fn().mockReturnValue({ publish: mockPublish }),
  CHANNELS: { deliveryTracking: (id: string) => `delivery:${id}` },
}));

vi.mock('../services/push-service', () => ({
  enqueuePush: vi.fn().mockResolvedValue(undefined),
}));

// DB mock — tracks calls in order to handle different queries
const mockDbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

const mockDbInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: 'offer-1' }]),
  }),
});

// We need separate select chains for: driver lookup, offer lookup, allOffers, delivery (customerId)
let selectCallCount = 0;
const mockDbSelect = vi.fn().mockImplementation(() => {
  selectCallCount++;
  const callNum = selectCallCount;

  if (callNum === 1) {
    // First select: driver lookup — returns driver record
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'driver-1' }]),
        }),
      }),
    };
  }
  if (callNum === 2) {
    // Second select: offer lookup — returns pending offer
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'offer-1' }]),
        }),
      }),
    };
  }
  if (callNum === 3) {
    // Third select: allOffers for releasing reservations
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { driverId: 'driver-1' },
          { driverId: 'driver-2' },
        ]),
      }),
    };
  }
  if (callNum === 4) {
    // Fourth select: delivery customerId for push notification
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ customerId: 'customer-1' }]),
        }),
      }),
    };
  }
  // Fallback
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
});

vi.mock('@surewaka/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
  deliveryOffers: { id: 'deliveryOffers.id', deliveryId: 'deliveryOffers.deliveryId', driverId: 'deliveryOffers.driverId', status: 'deliveryOffers.status' },
  deliveries: { id: 'deliveries.id', driverId: 'deliveries.driverId', customerId: 'deliveries.customerId' },
  drivers: { id: 'drivers.id', userId: 'drivers.userId' },
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
  isNull: vi.fn((a: unknown) => ['isNull', a]),
}));

vi.mock('../middleware/auth', () => stubAuthModule(personas.driver()));

// ── App setup ─────────────────────────────────────────────────────────────────

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

async function createTestApp() {
  const mod = await import('../routes/delivery-accept');
  const app = new Hono();
  app.route('/api/v1/deliveries', mod.default);
  return app;
}

describe('POST /api/v1/deliveries/:deliveryId/accept', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    selectCallCount = 0;
    app = await createTestApp();
  });

  it('returns matched: true when driver is first to claim (Req 6.1)', async () => {
    mockClaimDelivery.mockResolvedValue({ claimed: true });
    mockReleaseReservations.mockResolvedValue(undefined);

    const res = await app.request(`/api/v1/deliveries/${VALID_UUID}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { matched: boolean } };
    expect(body.data.matched).toBe(true);
    expect(mockClaimDelivery).toHaveBeenCalledWith({}, VALID_UUID, 'driver-1');
  });

  it('returns matched: false when another driver already claimed (Req 6.3, 6.7)', async () => {
    mockClaimDelivery.mockResolvedValue({ claimed: false, claimedBy: 'other-driver' });

    const res = await app.request(`/api/v1/deliveries/${VALID_UUID}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { matched: boolean } };
    expect(body.data.matched).toBe(false);
  });

  it('returns 404 when driver has no pending offer for the delivery (Req 6.8)', async () => {
    // Override selectCallCount behavior: driver found but offer not found
    selectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Driver lookup — found
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'driver-1' }]),
            }),
          }),
        };
      }
      if (selectCallCount === 2) {
        // Offer lookup — empty (no pending offer)
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    });

    const res = await app.request(`/api/v1/deliveries/${VALID_UUID}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('No pending offer found');
  });

  it('returns matched: false for idempotent duplicate accept (Req 6.7)', async () => {
    // Reset db select to return driver + offer (the default happy path)
    selectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'driver-1' }]),
            }),
          }),
        };
      }
      if (selectCallCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'offer-1' }]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    });

    // Same as race loss — Redis SET NX fails because the same driver already claimed
    mockClaimDelivery.mockResolvedValue({ claimed: false, claimedBy: 'driver-1' });

    const res = await app.request(`/api/v1/deliveries/${VALID_UUID}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { matched: boolean } };
    expect(body.data.matched).toBe(false);

    // No state mutations should happen on race loss
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockReleaseReservations).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
