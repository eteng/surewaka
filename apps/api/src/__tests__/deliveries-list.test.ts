// GET /api/v1/deliveries — customer delivery list.
//
// Regression coverage for two bugs fixed alongside this test:
//   1. The query had no ORDER BY, so Postgres gave no ordering guarantee —
//      the customer's list order could shift between refreshes.
//   2. 'draft' deliveries (abandoned/never-paid bookings) weren't excluded,
//      so they showed up mixed into real delivery history.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

// ─── Chainable Drizzle-like mock helper ─────────────────────────────────────
// Captures the `.where()` / `.orderBy()` arguments so tests can assert on
// query intent, then resolves with the given rows (as if the DB had already
// applied that filter/order — matching this repo's other list-route tests,
// e.g. waitlist-sort.property.test.ts).

function chainableSelect<T>(result: T, capture: { where?: unknown; orderBy?: unknown }) {
  const obj: Record<string, unknown> = {};
  obj.from = () => obj;
  obj.where = (cond: unknown) => {
    capture.where = cond;
    return obj;
  };
  obj.orderBy = (cond: unknown) => {
    capture.orderBy = cond;
    return obj;
  };
  obj.then = (resolve: (v: T) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../lib/zone-classifier', () => ({
  classifyZone: vi.fn(),
}));

vi.mock('../lib/routing-queue', () => ({
  enqueueRouteDelivery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/eta-calculator', () => ({
  calculateSystemEta: vi.fn().mockReturnValue(new Date()),
}));

vi.mock('../services/quote-service', () => ({
  createAuthoritativeQuotesForDelivery: vi.fn(),
  supersedeLeg: vi.fn(),
}));

vi.mock('../lib/fee-engine', () => ({
  computeOnDemandQuote: vi.fn(),
  computeCarrierQuote: vi.fn(),
}));

vi.mock('../services/weight-correction-service', () => ({
  respondToCorrection: vi.fn(),
  reportDiscrepancy: vi.fn(),
}));

vi.mock('../middleware/role', () => ({
  requireRole: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock('../middleware/require-leg-actor', () => ({
  requireLegActor: (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock('../middleware/auth', () => stubAuthModule(personas.customer()));

let mockSelectImpl: () => unknown = () => {
  throw new Error('mockSelectImpl not configured for this test');
};
const mockDb = {
  select: vi.fn(() => mockSelectImpl()),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  // Column refs just need a `.name` for eq/ne/desc to build SQL against —
  // see drizzle-orm's Column duck-typing; these aren't real Column instances.
  deliveries: {
    id: { name: 'id' },
    customerId: { name: 'customer_id' },
    status: { name: 'status' },
    createdAt: { name: 'created_at' },
  },
  deliveryLegs: {},
  users: {},
  carriers: {},
  carrierRoutes: {},
  feeSettings: {},
  vehicleTypeRates: {},
  quotes: {},
  carrierParks: {},
}));

async function createTestApp() {
  const mod = await import('../routes/deliveries');
  const app = new Hono();
  app.route('/api/v1/deliveries', mod.default);
  return app;
}

describe('GET /api/v1/deliveries', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('returns 200 with the customer\'s deliveries', async () => {
    const rows = [
      { id: 'd1', status: 'delivered', customerId: 'user-customer-id', priceKobo: 500000, createdAt: '2026-08-18T10:00:00Z' },
      { id: 'd2', status: 'en_route_pickup', customerId: 'user-customer-id', priceKobo: null, createdAt: '2026-08-19T09:00:00Z' },
    ];
    const capture: { where?: unknown; orderBy?: unknown } = {};
    mockSelectImpl = () => chainableSelect(rows, capture);

    const res = await app.request('/api/v1/deliveries', {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deliveries: unknown[]; total: number }; error: null };
    expect(body.error).toBeNull();
    expect(body.data.deliveries).toEqual(rows);
    expect(body.data.total).toBe(2);
  });

  it('filters out draft deliveries and orders by createdAt descending', async () => {
    const capture: { where?: unknown; orderBy?: unknown } = {};
    mockSelectImpl = () => chainableSelect([], capture);

    const res = await app.request('/api/v1/deliveries', {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);

    // where: customerId = <authed user> AND status <> 'draft'
    const whereText = JSON.stringify(capture.where);
    expect(whereText).toContain('customer_id');
    expect(whereText).toContain('user-customer-id');
    expect(whereText).toContain(' and ');
    expect(whereText).toContain('status');
    expect(whereText).toContain(' <> ');
    expect(whereText).toContain('draft');

    // orderBy: createdAt desc
    const orderText = JSON.stringify(capture.orderBy);
    expect(orderText).toContain('created_at');
    expect(orderText).toContain('desc');
  });

  it('returns 500 INTERNAL_ERROR when the query throws', async () => {
    mockSelectImpl = () => {
      throw new Error('connection reset');
    };

    const res = await app.request('/api/v1/deliveries', {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: { code: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
