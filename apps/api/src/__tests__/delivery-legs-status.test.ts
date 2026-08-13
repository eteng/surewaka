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
const deliveriesUpdateCalls: Array<Record<string, unknown>> = [];
const mockTriggerNextLegMatching = vi.fn().mockResolvedValue(undefined);

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
  const deliveriesTable = { id: 'deliveries.id' };

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
        from: () => ({
          where: () => Promise.resolve(remainingLegsResult),
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
  });
});
