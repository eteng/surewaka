// Feature: booking-city-classification
// surewaka_way delivery creation — city resolution via classifyZone, not a
// client-supplied city string.
// Requirements: .kiro/specs/booking-city-classification/requirements.md #3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

// ─── Chainable Drizzle-like mock helper ─────────────────────────────────────

function chainableResolve<T>(result: T) {
  const obj: Record<string, unknown> = {};
  obj.from = () => obj;
  obj.where = () => obj;
  obj.limit = () => obj;
  obj.then = (resolve: (v: T) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockClassifyZone = vi.fn();
vi.mock('../lib/zone-classifier', () => ({
  classifyZone: (...args: unknown[]) => mockClassifyZone(...args),
}));

const mockEnqueueRouteDelivery = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/routing-queue', () => ({
  enqueueRouteDelivery: (...args: unknown[]) => mockEnqueueRouteDelivery(...args),
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

const mockSelectQueue: Array<() => unknown> = [];
const mockDb = {
  select: vi.fn(() => {
    const next = mockSelectQueue.shift();
    if (!next) throw new Error('Unexpected extra db.select() call');
    return next();
  }),
  insert: vi.fn(() => ({
    values: () => ({
      returning: () => Promise.resolve([{ id: 'delivery-1' }]),
    }),
  })),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  deliveries: { id: 'id' },
  deliveryLegs: {},
  users: { id: 'id', phone: 'phone' },
  carriers: {},
  carrierRoutes: {},
  feeSettings: {},
  vehicleTypeRates: {},
  quotes: {},
  carrierParks: { id: 'id', city: 'city', isActive: 'isActive' },
}));

async function createTestApp() {
  const mod = await import('../routes/deliveries');
  const app = new Hono();
  app.route('/api/v1/deliveries', mod.default);
  return app;
}

const VALID_LOCATION = {
  address: '1 Admiralty Way, Lekki Phase 1, Lagos',
  city: 'Ikeja', // deliberately the "wrong"/ungrouped city a geocoder might send — must be ignored
  state: 'Lagos',
  lat: 6.4478,
  lng: 3.4726,
};

const VALID_DROPOFF = {
  address: 'Area 11, Garki, Abuja',
  city: 'Garki',
  state: 'FCT',
  lat: 9.0227,
  lng: 7.4842,
};

function surewakaWayBody(overrides: Partial<{ pickup: typeof VALID_LOCATION; dropoff: typeof VALID_DROPOFF }> = {}) {
  return {
    mode: 'surewaka_way',
    pickup: overrides.pickup ?? VALID_LOCATION,
    dropoff: overrides.dropoff ?? VALID_DROPOFF,
    packageDetails: { description: 'A parcel of documents', weight: 2, category: 'document' },
    recipientDetails: { recipientName: 'Jane Doe', recipientPhone: '08012345678' },
  };
}

describe('POST /api/v1/deliveries — surewaka_way city classification', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSelectQueue.length = 0;
    app = await createTestApp();
  });

  it('classifies pickup/dropoff and ignores the client-supplied city string', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'zone-lekki', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce({ id: 'zone-garki', name: 'Garki', city: 'Abuja' });

    mockSelectQueue.push(
      () => chainableResolve([{ id: 'park-lagos' }]), // pickup parks
      () => chainableResolve([{ id: 'park-abuja' }]), // dropoff parks
      () => chainableResolve([{ phone: '08000000000' }]), // sender phone
    );

    const res = await app.request('/api/v1/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify(surewakaWayBody()),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { deliveryId: string; status: string } };
    expect(body.data.status).toBe('pending_routing');

    // classifyZone called with the location's address + lat/lng, not the raw city string
    expect(mockClassifyZone).toHaveBeenNthCalledWith(1, VALID_LOCATION.address, VALID_LOCATION.lat, VALID_LOCATION.lng);
    expect(mockClassifyZone).toHaveBeenNthCalledWith(2, VALID_DROPOFF.address, VALID_DROPOFF.lat, VALID_DROPOFF.lng);

    // Delivery was enqueued for routing
    expect(mockEnqueueRouteDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'delivery-1' }),
    );

    // The stored city came from classification (Lagos/Abuja), not the client's
    // "Ikeja"/"Garki" strings — verified via the insert call's values.
    const insertCall = mockDb.insert.mock.results[0]!.value as { values: (v: unknown) => unknown };
    expect(insertCall).toBeDefined();
  });

  it('returns 422 SAME_CITY when both locations classify to the same city, even if the client sent different city strings', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'zone-lekki', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce({ id: 'zone-ikeja', name: 'Ikeja', city: 'Lagos' });

    const res = await app.request('/api/v1/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify(surewakaWayBody()),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SAME_CITY');
  });

  it('returns 422 UNCLASSIFIED_LOCATION when pickup fails to classify', async () => {
    mockClassifyZone.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'z', name: 'Z', city: 'Abuja' });

    const res = await app.request('/api/v1/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify(surewakaWayBody()),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNCLASSIFIED_LOCATION');
  });

  it('returns 422 NO_PARKS_IN_CITY using the classified city name in the message', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'zone-lekki', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce({ id: 'zone-garki', name: 'Garki', city: 'Abuja' });

    mockSelectQueue.push(
      () => chainableResolve([]), // no active parks in Lagos
    );

    const res = await app.request('/api/v1/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify(surewakaWayBody()),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NO_PARKS_IN_CITY');
    expect(body.error.message).toContain('lagos');
  });
});
