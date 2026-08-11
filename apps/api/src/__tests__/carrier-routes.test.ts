// Feature: booking-city-classification
// GET /api/v1/carrier-routes — city resolution via classifyZone (lat/lng +
// address), not client-supplied fromCity/toCity strings.
// Requirements: .kiro/specs/booking-city-classification/requirements.md #2

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

function chainableResolve<T>(result: T) {
  const obj: Record<string, unknown> = {};
  obj.from = () => obj;
  obj.where = () => obj;
  obj.innerJoin = () => obj;
  obj.then = (resolve: (v: T) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const mockClassifyZone = vi.fn();
vi.mock('../lib/zone-classifier', () => ({
  classifyZone: (...args: unknown[]) => mockClassifyZone(...args),
}));

vi.mock('../middleware/auth', () => stubAuthModule(personas.customer()));

const mockSelectQueue: Array<() => unknown> = [];
const mockDb = {
  select: vi.fn(() => {
    const next = mockSelectQueue.shift();
    if (!next) throw new Error('Unexpected extra db.select() call');
    return next();
  }),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  carrierRoutes: { id: 'id', carrierId: 'carrierId', isActive: 'isActive', originParkId: 'originParkId', destinationParkId: 'destinationParkId' },
  carrierRouteSchedules: { carrierRouteId: 'carrierRouteId', isActive: 'isActive' },
  carrierParks: { id: 'id', city: 'city' },
  carriers: { id: 'id', name: 'name' },
}));

async function createTestApp() {
  const mod = await import('../routes/carrier-routes');
  const app = new Hono();
  app.route('/api/v1/carrier-routes', mod.default);
  return app;
}

const BASE_QUERY = 'fromLat=6.4478&fromLng=3.4726&fromAddress=Lekki%2C+Lagos&toLat=9.0227&toLng=7.4842&toAddress=Garki%2C+Abuja';

describe('GET /api/v1/carrier-routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSelectQueue.length = 0;
    app = await createTestApp();
  });

  it('returns 400 MISSING_PARAMS without classifying when coordinates are absent', async () => {
    const res = await app.request('/api/v1/carrier-routes?fromLat=6.44', {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_PARAMS');
    expect(mockClassifyZone).not.toHaveBeenCalled();
  });

  it('returns 422 UNCLASSIFIED_LOCATION when either location fails to classify', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'z1', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce(null);

    const res = await app.request(`/api/v1/carrier-routes?${BASE_QUERY}`, {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNCLASSIFIED_LOCATION');
  });

  it('classifies via address + coordinates, not a client-supplied city string', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'z1', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce({ id: 'z2', name: 'Garki', city: 'Abuja' });

    mockSelectQueue.push(
      () => chainableResolve([]), // no matching routes
      () => chainableResolve([]), // no dest parks
    );

    const res = await app.request(`/api/v1/carrier-routes?${BASE_QUERY}`, {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    expect(mockClassifyZone).toHaveBeenNthCalledWith(1, 'Lekki, Lagos', 6.4478, 3.4726);
    expect(mockClassifyZone).toHaveBeenNthCalledWith(2, 'Garki, Abuja', 9.0227, 7.4842);

    const body = (await res.json()) as { data: unknown[]; meta: { fromCity: string; toCity: string; sameCity: boolean } };
    expect(body.data).toEqual([]);
    expect(body.meta).toEqual({ fromCity: 'Lagos', toCity: 'Abuja', sameCity: false });
  });

  it('reports sameCity: true when both locations classify to the same city', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'z1', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce({ id: 'z2', name: 'Ikeja', city: 'Lagos' });

    mockSelectQueue.push(
      () => chainableResolve([]),
      () => chainableResolve([]),
    );

    const res = await app.request(`/api/v1/carrier-routes?${BASE_QUERY}`, {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { sameCity: boolean } };
    expect(body.meta.sameCity).toBe(true);
  });

  it('returns a matched route with resolved carrier name', async () => {
    mockClassifyZone
      .mockResolvedValueOnce({ id: 'z1', name: 'Lekki', city: 'Lagos' })
      .mockResolvedValueOnce({ id: 'z2', name: 'Garki', city: 'Abuja' });

    mockSelectQueue.push(
      () =>
        chainableResolve([
          {
            routeId: 'route-1',
            carrierId: 'carrier-1',
            basePriceKobo: 500000,
            estimatedTransitHrs: 6,
            maxWeightKg: 50,
            originParkId: 'park-lagos',
            destinationParkId: 'park-abuja',
          },
        ]), // matching origin-city routes
      () => chainableResolve([{ id: 'park-abuja' }]), // dest parks in Abuja
      () => chainableResolve([]), // schedules for route-1 (none — nextDepartureAt stays null)
      () => chainableResolve([{ name: 'GIG Logistics' }]), // carrier name lookup
    );

    const res = await app.request(`/api/v1/carrier-routes?${BASE_QUERY}`, {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ routeId: string; carrierName: string; nextDepartureAt: string | null }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ routeId: 'route-1', carrierName: 'GIG Logistics', nextDepartureAt: null });
  });
});
