// Regression tests for the missing initial-matching-trigger fix in
// booking-payment.ts: nothing anywhere enqueued a driver-matching job for a
// delivery booked with legs already known upfront (plain on-demand, or a
// customer-selected specific carrier route) -- escrow would confirm and the
// delivery would just sit there, unmatchable, forever. See POST
// /booking/confirm, the block right after the transaction commits.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { asUser } from '../test-utils/auth-mock';

// ─── Mock state ─────────────────────────────────────────────────────────────

let firstLegResult: Array<Record<string, unknown>> = [];
const matchingQueueAddCalls: Array<[string, unknown, unknown]> = [];

const DELIVERY_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'draft',
  customerId: '33333333-3333-4333-8333-333333333333',
  amountPaid: 350000,
  escrowHoldId: null,
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
vi.mock('@surewaka/auth', () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));

vi.mock('../lib/wallet-service', () => ({
  debitWallet: vi.fn().mockResolvedValue(undefined),
  getWalletByUserId: vi.fn().mockResolvedValue({ id: 'wallet-1' }),
  creditWallet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/quote-service', () => ({
  confirmAll: vi.fn().mockResolvedValue({ confirmedCount: 1, totalKobo: 350000 }),
}));

vi.mock('../lib/matching-queue', () => ({
  matchingQueue: {
    add: (...args: [string, unknown, unknown]) => {
      matchingQueueAddCalls.push(args);
      return Promise.resolve();
    },
  },
}));

vi.mock('@surewaka/db', () => {
  const usersTable = { id: 'users.id', clerkId: 'users.clerkId' };
  const deliveryLegsTable = {
    id: 'deliveryLegs.id',
    deliveryId: 'deliveryLegs.deliveryId',
    legNumber: 'deliveryLegs.legNumber',
    actorType: 'deliveryLegs.actorType',
  };

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => Promise.resolve([DELIVERY_ROW]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'escrow-1' }]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(undefined),
      }),
    }),
  };

  return {
    db: {
      transaction: (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
      select: (fields?: unknown) => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if (table === deliveryLegsTable) return Promise.resolve(firstLegResult);
              return Promise.resolve([{ id: '33333333-3333-4333-8333-333333333333' }]); // users lookup (auth)
            },
          }),
        }),
      }),
    },
    users: usersTable,
    deliveries: { id: 'deliveries.id' },
    escrowHolds: { id: 'escrowHolds.id' },
    deliveryLegs: deliveryLegsTable,
  };
});

async function createTestApp() {
  const mod = await import('../routes/booking-payment');
  const app = new Hono();
  app.route('/api/v1', mod.default);
  return app;
}

describe('POST /booking/confirm — initial matching trigger', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    matchingQueueAddCalls.length = 0;
    firstLegResult = [];
    asUser(mockVerifyToken, 'customer');
    app = await createTestApp();
  });

  it('enqueues a match job when the first leg is a driver leg', async () => {
    firstLegResult = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        actorType: 'driver',
        pickupLng: 3.35,
        pickupLat: 6.6,
        dropoffLng: 3.45,
        dropoffLat: 6.45,
      },
    ];

    const res = await app.request('/api/v1/booking/confirm', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_id: '11111111-1111-4111-8111-111111111111', amount: 350000 }),
    });

    expect(res.status).toBe(200);
    expect(matchingQueueAddCalls).toHaveLength(1);
    const [jobName, jobData, jobOpts] = matchingQueueAddCalls[0];
    expect(jobName).toBe('match-driver');
    expect(jobData).toMatchObject({ deliveryId: '11111111-1111-4111-8111-111111111111', legId: '22222222-2222-4222-8222-222222222222', legType: 'first_mile' });
    expect(jobOpts).toMatchObject({ delay: 0, jobId: 'match-leg:22222222-2222-4222-8222-222222222222' });
  });

  it('does not enqueue a match job when the first leg is a carrier leg (self-drop)', async () => {
    firstLegResult = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        actorType: 'carrier',
        pickupLng: 3.35,
        pickupLat: 6.6,
        dropoffLng: 3.45,
        dropoffLat: 6.45,
      },
    ];

    const res = await app.request('/api/v1/booking/confirm', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_id: '11111111-1111-4111-8111-111111111111', amount: 350000 }),
    });

    expect(res.status).toBe(200);
    expect(matchingQueueAddCalls).toHaveLength(0);
  });
});
