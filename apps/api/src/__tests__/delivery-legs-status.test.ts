// Regression tests for the delivery-completion fix in delivery-legs.ts:
// nothing else ever advanced deliveries.status past 'accepted', so
// idx_deliveries_active_driver kept treating the driver as permanently
// "active" — unmatchable to any future delivery — once their first one
// finished. See PATCH /:deliveryId/legs/:legId/status, the "delivered"
// branch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mock state ─────────────────────────────────────────────────────────────

let remainingLegsResult: Array<{ status: string }> = [];
let deliveryBeforeResult: Array<{ status: string }> = [{ status: 'accepted' }];
const deliveriesUpdateCalls: Array<Record<string, unknown>> = [];
const mockTriggerNextLegMatching = vi.fn().mockResolvedValue(undefined);
const mockPublish = vi.fn().mockResolvedValue(undefined);

const LEG = {
  id: 'leg-1',
  deliveryId: 'delivery-1',
  actorType: 'driver',
  actorId: 'driver-1',
  legNumber: 1,
  legType: 'first_mile',
  status: 'arrived_dropoff',
  isActive: true,
  systemEtaAt: null,
  slaHours: null,
  pickupLng: 0,
  pickupLat: 0,
  dropoffLng: 0,
  dropoffLat: 0,
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b, op: 'eq' }),
  and: (...args: unknown[]) => ({ args, op: 'and' }),
}));

vi.mock('@surewaka/db', () => {
  const deliveryLegsTable = {
    id: 'deliveryLegs.id',
    deliveryId: 'deliveryLegs.deliveryId',
    isActive: 'deliveryLegs.isActive',
    status: 'deliveryLegs.status',
  };
  const deliveriesTable = { id: 'deliveries.id', status: 'deliveries.status' };

  return {
    db: {
      update: (table: unknown) => {
        if (table === deliveriesTable) {
          return {
            set: (data: Record<string, unknown>) => {
              deliveriesUpdateCalls.push(data);
              return { where: () => Promise.resolve(undefined) };
            },
          };
        }
        // deliveryLegs update (the leg's own status write)
        return {
          set: () => ({
            where: () => ({
              returning: () => Promise.resolve([{ ...LEG, status: 'delivered' }]),
            }),
          }),
        };
      },
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === deliveriesTable) {
              return { limit: () => Promise.resolve(deliveryBeforeResult) };
            }
            return Promise.resolve(remainingLegsResult);
          },
        }),
      }),
    },
    deliveryLegs: deliveryLegsTable,
    deliveries: deliveriesTable,
  };
});

vi.mock('../lib/trigger-next-leg', () => ({
  triggerNextLegMatching: (...args: unknown[]) => mockTriggerNextLegMatching(...args),
}));

vi.mock('../lib/realtime', () => ({
  getRealtime: vi.fn().mockReturnValue({ publish: (...args: unknown[]) => mockPublish(...args) }),
  CHANNELS: { deliveryTracking: (id: string) => `delivery:${id}` },
  EVENTS: { statusUpdate: 'status-update' },
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock('../middleware/role', () => ({
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock('../middleware/require-leg-actor', () => ({
  requireLegActor: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('leg', LEG);
    await next();
  },
}));

// ─── App setup ──────────────────────────────────────────────────────────────

async function createTestApp() {
  const mod = await import('../routes/delivery-legs');
  const app = new Hono();
  app.route('/api/v1/deliveries', mod.default);
  return app;
}

describe('PATCH /api/v1/deliveries/:deliveryId/legs/:legId/status', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    remainingLegsResult = [];
    deliveryBeforeResult = [{ status: 'accepted' }];
    deliveriesUpdateCalls.length = 0;
    app = await createTestApp();
  });

  it('marks the delivery delivered when the last active leg reaches delivered', async () => {
    remainingLegsResult = [{ status: 'delivered' }];

    const res = await app.request('/api/v1/deliveries/delivery-1/legs/leg-1/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    });

    expect(res.status).toBe(200);
    expect(deliveriesUpdateCalls).toHaveLength(1);
    expect(deliveriesUpdateCalls[0]).toMatchObject({ status: 'delivered' });

    // Realtime publish reflects the genuine delivery-level transition
    // (Requirement 7.2), not just the leg's own status
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(
      'delivery:delivery-1',
      'status-update',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        previousStatus: 'accepted',
        newStatus: 'delivered',
        legId: 'leg-1',
        legStatus: 'delivered',
      }),
    );
  });

  it('does not mark the delivery delivered while another active leg is still in progress', async () => {
    // e.g. a multi-leg surewaka_way delivery where first-mile just finished
    // but the intercity/last-mile legs haven't
    remainingLegsResult = [{ status: 'delivered' }, { status: 'en_route_pickup' }];

    const res = await app.request('/api/v1/deliveries/delivery-1/legs/leg-1/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    });

    expect(res.status).toBe(200);
    expect(deliveriesUpdateCalls).toHaveLength(0);

    // Leg-level publish still fires — the delivery just hasn't transitioned
    // overall yet (previousStatus === newStatus signals that to consumers)
    expect(mockPublish).toHaveBeenCalledWith(
      'delivery:delivery-1',
      'status-update',
      expect.objectContaining({
        previousStatus: 'accepted',
        newStatus: 'accepted',
        legStatus: 'delivered',
      }),
    );
  });

  it('does not touch deliveries.status for non-terminal leg status updates', async () => {
    const res = await app.request('/api/v1/deliveries/delivery-1/legs/leg-1/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'picked_up' }),
    });

    expect(res.status).toBe(200);
    expect(deliveriesUpdateCalls).toHaveLength(0);
    expect(mockTriggerNextLegMatching).not.toHaveBeenCalled();

    // Still publishes so the tracking screen sees granular leg progress
    // even when the delivery's overall status hasn't moved
    expect(mockPublish).toHaveBeenCalledWith(
      'delivery:delivery-1',
      'status-update',
      expect.objectContaining({ legStatus: 'picked_up', previousStatus: 'accepted', newStatus: 'accepted' }),
    );
  });
});
