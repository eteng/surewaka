// Feature: coverage-map
// h3Index-on-write behavior for admin carrier park routes.
// Requirements: .kiro/specs/coverage-map/requirements.md #2

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { getH3Cell } from '@surewaka/shared';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

const H3_RESOLUTION = 7;

type ParkRow = {
  id: string;
  carrierId: string;
  city: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  h3Index: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let parkStore: ParkRow[] = [];
let idCounter = 0;
function nextId() {
  idCounter++;
  return `park-uuid-${idCounter}`;
}

function seedPark(overrides: Partial<ParkRow> = {}): ParkRow {
  const park: ParkRow = {
    id: nextId(),
    carrierId: 'carrier-1',
    city: 'lagos',
    name: 'Lekki Hub',
    address: '1 Admiralty Way',
    lat: 6.4478,
    lng: 3.4726,
    h3Index: '',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  parkStore.push(park);
  return park;
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  carrierParks: {
    id: 'id',
    carrierId: 'carrierId',
    city: 'city',
    name: 'name',
    address: 'address',
    lat: 'lat',
    lng: 'lng',
    h3Index: 'h3Index',
    isActive: 'isActive',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: string, val: unknown) => ({ field, val, type: 'eq' }),
}));

vi.mock('../middleware/auth', () => stubAuthModule(personas.admin()));

function setupDbMocks() {
  mockDb.select.mockImplementation((_fields?: Record<string, unknown>) => ({
    from: () => ({
      where: (condition: { field?: string; val?: unknown }) => ({
        limit: () => {
          const found = parkStore.find((p) => p.id === condition.val);
          return Promise.resolve(found ? [{ lat: found.lat, lng: found.lng }] : []);
        },
      }),
    }),
  }));

  mockDb.insert.mockImplementation(() => ({
    values: (data: Record<string, unknown>) => ({
      returning: () => {
        const park: ParkRow = {
          id: nextId(),
          carrierId: data.carrierId as string,
          city: data.city as string,
          name: data.name as string,
          address: data.address as string,
          lat: data.lat as number,
          lng: data.lng as number,
          h3Index: data.h3Index as string,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        parkStore.push(park);
        return Promise.resolve([park]);
      },
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: (data: Record<string, unknown>) => ({
      where: (condition: { field?: string; val?: unknown }) => ({
        returning: () => {
          const idx = parkStore.findIndex((p) => p.id === condition.val);
          if (idx === -1) return Promise.resolve([]);
          const updated = { ...parkStore[idx], ...data };
          parkStore[idx] = updated as ParkRow;
          return Promise.resolve([updated]);
        },
      }),
    }),
  }));
}

async function createTestApp() {
  const mod = await import('../routes/admin/carrier-parks');
  const app = new Hono();
  app.route('/api/v1/admin/carrier-parks', mod.default);
  return app;
}

describe('carrier parks — h3Index on write', () => {
  let app: Hono;

  beforeEach(async () => {
    parkStore = [];
    idCounter = 0;
    vi.clearAllMocks();
    setupDbMocks();
    app = await createTestApp();
  });

  it('computes h3Index from lat/lng on create', async () => {
    const lat = 6.4478;
    const lng = 3.4726;
    const expected = getH3Cell(lat, lng, H3_RESOLUTION);

    const res = await app.request('/api/v1/admin/carrier-parks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({
        carrierId: '11111111-1111-4111-8111-111111111111',
        city: 'Lagos',
        name: 'Lekki Hub',
        address: '1 Admiralty Way, Lekki',
        lat,
        lng,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { h3Index: string } };
    expect(body.data.h3Index).toBe(expected);
  });

  it('recomputes h3Index when lat/lng change on update', async () => {
    const park = seedPark({ h3Index: getH3Cell(6.4478, 3.4726, H3_RESOLUTION) });
    const newLat = 9.0765;
    const newLng = 7.3986; // Abuja — a different H3 cell entirely
    const expected = getH3Cell(newLat, newLng, H3_RESOLUTION);
    expect(expected).not.toBe(park.h3Index);

    const res = await app.request(`/api/v1/admin/carrier-parks/${park.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: newLat, lng: newLng }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { h3Index: string } };
    expect(body.data.h3Index).toBe(expected);
  });

  it('recomputes h3Index from merged coordinates when only lng changes', async () => {
    const originalLat = 6.4478;
    const park = seedPark({ lat: originalLat, lng: 3.4726, h3Index: getH3Cell(originalLat, 3.4726, H3_RESOLUTION) });
    const newLng = 3.5;
    const expected = getH3Cell(originalLat, newLng, H3_RESOLUTION);

    const res = await app.request(`/api/v1/admin/carrier-parks/${park.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lng: newLng }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { h3Index: string; lat: number } };
    expect(body.data.h3Index).toBe(expected);
    expect(body.data.lat).toBe(originalLat);
  });

  it('leaves h3Index untouched on a metadata-only update', async () => {
    const fixedH3 = getH3Cell(6.4478, 3.4726, H3_RESOLUTION);
    const park = seedPark({ h3Index: fixedH3 });

    const res = await app.request(`/api/v1/admin/carrier-parks/${park.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ name: 'Renamed Hub' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { h3Index: string; name: string } };
    expect(body.data.h3Index).toBe(fixedH3);
    expect(body.data.name).toBe('Renamed Hub');
    // No select-then-merge lookup should have happened for a coordinate-free update
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns 404 when patching lat/lng on a non-existent park', async () => {
    const res = await app.request('/api/v1/admin/carrier-parks/does-not-exist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 1, lng: 1 }),
    });

    expect(res.status).toBe(404);
  });
});
