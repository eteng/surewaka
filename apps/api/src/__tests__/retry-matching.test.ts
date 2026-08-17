// Tests for POST /api/v1/deliveries/:id/retry-matching (Retry_Matching,
// Requirement 4 in .kiro/specs/realtime-delivery-tracking/requirements.md):
// the in-app equivalent of the manual rescue script used repeatedly this
// session to un-stick a routing_failed delivery.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { asUser } from '../test-utils/auth-mock';

// ─── Mock state ─────────────────────────────────────────────────────────────

// requireAuth resolves AuthUser.id from its own DB lookup (mocked below),
// not from the Clerk persona directly — matchDriverJobDataSchema requires
// a real UUID for customerId, so this must be UUID-shaped too.
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const LEG_ID = '22222222-2222-4222-8222-222222222222';

let deliveryResult: Array<{ id: string; customerId: string; status: string }> = [];
let legResult: Array<Record<string, unknown>> = [];
let existingJob: { remove: ReturnType<typeof vi.fn> } | null = null;

const deliveriesUpdateCalls: Array<Record<string, unknown>> = [];
const matchingQueueAddCalls: Array<[string, unknown, unknown]> = [];
const mockGetJob = vi.fn();

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
vi.mock('@surewaka/auth', () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));

vi.mock('../lib/matching-queue', () => ({
  matchingQueue: {
    getJob: (...args: unknown[]) => mockGetJob(...args),
    add: (...args: [string, unknown, unknown]) => {
      matchingQueueAddCalls.push(args);
      return Promise.resolve();
    },
  },
}));

vi.mock('@surewaka/db', () => {
  const deliveriesTable = { id: 'deliveries.id', customerId: 'deliveries.customerId', status: 'deliveries.status' };
  const deliveryLegsTable = {
    id: 'deliveryLegs.id',
    deliveryId: 'deliveryLegs.deliveryId',
    actorType: 'deliveryLegs.actorType',
    actorId: 'deliveryLegs.actorId',
    isActive: 'deliveryLegs.isActive',
    status: 'deliveryLegs.status',
    legType: 'deliveryLegs.legType',
  };
  const usersTable = { id: 'users.id', clerkId: 'users.clerkId' };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if (table === deliveriesTable) return Promise.resolve(deliveryResult);
              if (table === deliveryLegsTable) return Promise.resolve(legResult);
              return Promise.resolve([{ id: CUSTOMER_ID }]); // users lookup (requireAuth)
            },
          }),
        }),
      }),
      update: () => ({
        set: (data: Record<string, unknown>) => {
          deliveriesUpdateCalls.push(data);
          return { where: () => Promise.resolve(undefined) };
        },
      }),
    },
    users: usersTable,
    deliveries: deliveriesTable,
    deliveryLegs: deliveryLegsTable,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b, op: 'eq' }),
  and: (...args: unknown[]) => ({ args, op: 'and' }),
}));

// ─── App setup ──────────────────────────────────────────────────────────────

async function createTestApp() {
  const mod = await import('../routes/retry-matching');
  const app = new Hono();
  app.route('/api/v1/deliveries', mod.default);
  return app;
}

const LEG_ROW = {
  id: LEG_ID,
  legType: 'first_mile',
  pickupLng: 3.35,
  pickupLat: 6.6,
  dropoffLng: 3.45,
  dropoffLat: 6.45,
};

describe('POST /api/v1/deliveries/:id/retry-matching', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    deliveryResult = [];
    legResult = [];
    existingJob = null;
    deliveriesUpdateCalls.length = 0;
    matchingQueueAddCalls.length = 0;
    mockGetJob.mockImplementation(() => Promise.resolve(existingJob));
    asUser(mockVerifyToken, 'customer');
    app = await createTestApp();
  });

  it('returns 404 when the caller does not own the delivery', async () => {
    deliveryResult = [{ id: DELIVERY_ID, customerId: 'someone-else', status: 'routing_failed' }];

    const res = await app.request(`/api/v1/deliveries/${DELIVERY_ID}/retry-matching`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });

    expect(res.status).toBe(404);
    expect(matchingQueueAddCalls).toHaveLength(0);
  });

  it('rejects a delivery that is not in routing_failed state', async () => {
    deliveryResult = [{ id: DELIVERY_ID, customerId: CUSTOMER_ID, status: 'pending' }];

    const res = await app.request(`/api/v1/deliveries/${DELIVERY_ID}/retry-matching`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_STATUS');
    expect(deliveriesUpdateCalls).toHaveLength(0);
    expect(matchingQueueAddCalls).toHaveLength(0);
  });

  it('enqueues a fresh match-driver job and resets status on the happy path', async () => {
    deliveryResult = [{ id: DELIVERY_ID, customerId: CUSTOMER_ID, status: 'routing_failed' }];
    legResult = [LEG_ROW];
    existingJob = null; // no stale job — first-time retry

    const res = await app.request(`/api/v1/deliveries/${DELIVERY_ID}/retry-matching`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });

    expect(res.status).toBe(200);
    expect(deliveriesUpdateCalls).toHaveLength(1);
    expect(deliveriesUpdateCalls[0]).toMatchObject({ status: 'pending' });

    expect(matchingQueueAddCalls).toHaveLength(1);
    const [jobName, jobData, jobOpts] = matchingQueueAddCalls[0];
    expect(jobName).toBe('match-driver');
    expect(jobData).toMatchObject({ deliveryId: DELIVERY_ID, legId: LEG_ID, legType: 'first_mile' });
    expect(jobOpts).toMatchObject({ jobId: `match-leg-${LEG_ID}` });
  });

  it('removes a stale job under the same deterministic jobId before re-adding', async () => {
    deliveryResult = [{ id: DELIVERY_ID, customerId: CUSTOMER_ID, status: 'routing_failed' }];
    legResult = [LEG_ROW];
    const removeMock = vi.fn().mockResolvedValue(undefined);
    existingJob = { remove: removeMock };

    const res = await app.request(`/api/v1/deliveries/${DELIVERY_ID}/retry-matching`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });

    expect(res.status).toBe(200);
    expect(mockGetJob).toHaveBeenCalledWith(`match-leg-${LEG_ID}`);
    expect(removeMock).toHaveBeenCalledTimes(1);
    // Still enqueues the fresh job after removing the stale one — this is
    // the exact duplicate-jobId error hit by hand this session otherwise.
    expect(matchingQueueAddCalls).toHaveLength(1);
  });

  it('returns 404 when no unmatched driver leg exists for the delivery', async () => {
    deliveryResult = [{ id: DELIVERY_ID, customerId: CUSTOMER_ID, status: 'routing_failed' }];
    legResult = [];

    const res = await app.request(`/api/v1/deliveries/${DELIVERY_ID}/retry-matching`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
    });

    expect(res.status).toBe(404);
    expect(matchingQueueAddCalls).toHaveLength(0);
  });
});
