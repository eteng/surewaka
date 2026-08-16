// Feature: coverage-map
// Resolve/reopen + nearest-distance behavior for the coverage-gap cron job.
// Requirements: .kiro/specs/coverage-map/requirements.md #3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getH3Cell, getH3Center } from '@surewaka/shared/h3';
import { haversineKm } from '@surewaka/shared';

const H3_RESOLUTION = 7;

// Lekki, Lagos — used as the "gap" location throughout.
const GAP_LAT = 6.4478;
const GAP_LNG = 3.4726;
const GAP_H3 = getH3Cell(GAP_LAT, GAP_LNG, H3_RESOLUTION);

// Abuja — a different H3 cell entirely, used where a query should exclude it.
const OTHER_LAT = 9.0765;
const OTHER_LNG = 7.3986;
const OTHER_H3 = getH3Cell(OTHER_LAT, OTHER_LNG, H3_RESOLUTION);

type DeliveryRow = { pickupLat: number; pickupLng: number; createdAt: Date; status: string };
type GapRow = {
  id: string;
  h3Index: string;
  demandCount: number;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  nearestParkKm: number | null;
  nearestDriverKm: number | null;
  createdAt: Date;
  updatedAt: Date;
};
type ParkRow = { lat: number; lng: number; isActive: boolean };
type DriverRow = { lat: number | null; lng: number | null; available: boolean };

let deliveryStore: DeliveryRow[] = [];
let gapStore: GapRow[] = [];
let parkStore: ParkRow[] = [];
let driverStore: DriverRow[] = [];
let idCounter = 0;
function nextId() {
  idCounter++;
  return `gap-uuid-${idCounter}`;
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  deliveries: { __table: 'deliveries' },
  coverageGaps: { __table: 'coverageGaps', h3Index: 'h3Index', resolvedAt: 'resolvedAt' },
  carrierParks: { __table: 'carrierParks' },
  drivers: { __table: 'drivers' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, val: unknown) => ({ type: 'eq', field, val }),
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  isNull: (field: unknown) => ({ type: 'isNull', field }),
  isNotNull: (field: unknown) => ({ type: 'isNotNull', field }),
  notInArray: (field: unknown, vals: unknown[]) => ({ type: 'notInArray', field, vals }),
}));

type Condition =
  | { type: 'eq'; field: string; val: unknown }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'isNull'; field: string }
  | { type: 'isNotNull'; field: string }
  | { type: 'notInArray'; field: string; vals: unknown[] };

function applyGapCondition(rows: GapRow[], cond: Condition): GapRow[] {
  if (cond.type === 'and') return cond.conditions.reduce((acc, c) => applyGapCondition(acc, c), rows);
  if (cond.type === 'isNull') return rows.filter((r) => r.resolvedAt == null);
  if (cond.type === 'notInArray') return rows.filter((r) => !cond.vals.includes(r.h3Index));
  return rows;
}

function setupDbMocks() {
  mockDb.select.mockImplementation((_fields?: Record<string, unknown>) => ({
    from: (table: { __table: string }) => {
      if (table.__table === 'deliveries') {
        return { where: () => Promise.resolve(deliveryStore.filter((d) => d.status === 'routing_failed')) };
      }
      if (table.__table === 'carrierParks') {
        return { where: () => Promise.resolve(parkStore.filter((p) => p.isActive)) };
      }
      if (table.__table === 'drivers') {
        return {
          where: () =>
            Promise.resolve(driverStore.filter((d) => d.available && d.lat != null && d.lng != null)),
        };
      }
      if (table.__table === 'coverageGaps') {
        return { where: (cond: Condition) => Promise.resolve(applyGapCondition([...gapStore], cond)) };
      }
      throw new Error(`Unexpected table in select().from(): ${table.__table}`);
    },
  }));

  mockDb.insert.mockImplementation(() => ({
    values: (data: Partial<GapRow> & { h3Index: string }) => ({
      onConflictDoUpdate: ({ set }: { set: Partial<GapRow> }) => {
        const idx = gapStore.findIndex((g) => g.h3Index === data.h3Index);
        if (idx === -1) {
          gapStore.push({
            id: nextId(),
            demandCount: 0,
            lastSeenAt: new Date(),
            resolvedAt: null,
            nearestParkKm: null,
            nearestDriverKm: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          } as GapRow);
        } else {
          gapStore[idx] = { ...gapStore[idx], ...set };
        }
        return Promise.resolve();
      },
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: (data: Partial<GapRow>) => ({
      where: (cond: { type: 'eq'; field: string; val: unknown }) => {
        const idx = gapStore.findIndex((g) => g.h3Index === cond.val);
        if (idx !== -1) gapStore[idx] = { ...gapStore[idx], ...data };
        return Promise.resolve();
      },
    }),
  }));
}

async function runJob() {
  vi.resetModules();
  const mod = await import('../jobs/compute-coverage-gaps');
  await mod.computeCoverageGaps();
}

describe('computeCoverageGaps — resolve/reopen + distance', () => {
  beforeEach(() => {
    deliveryStore = [];
    gapStore = [];
    parkStore = [];
    driverStore = [];
    idCounter = 0;
    vi.clearAllMocks();
    setupDbMocks();
  });

  it('creates an active gap (resolvedAt null) for a cell with current demand', async () => {
    deliveryStore.push({ pickupLat: GAP_LAT, pickupLng: GAP_LNG, createdAt: new Date(), status: 'routing_failed' });

    await runJob();

    const gap = gapStore.find((g) => g.h3Index === GAP_H3);
    expect(gap).toBeDefined();
    expect(gap!.resolvedAt).toBeNull();
    expect(gap!.demandCount).toBe(1);
  });

  it('resolves a previously-active gap whose cell no longer shows demand', async () => {
    gapStore.push({
      id: nextId(),
      h3Index: GAP_H3,
      demandCount: 3,
      lastSeenAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      resolvedAt: null,
      nearestParkKm: null,
      nearestDriverKm: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // No deliveries at all this run — demand dried up everywhere.

    await runJob();

    const gap = gapStore.find((g) => g.h3Index === GAP_H3);
    expect(gap!.resolvedAt).not.toBeNull();
  });

  it('leaves other active gaps alone and only resolves the one missing from this run', async () => {
    gapStore.push(
      {
        id: nextId(),
        h3Index: GAP_H3,
        demandCount: 2,
        lastSeenAt: new Date(),
        resolvedAt: null,
        nearestParkKm: null,
        nearestDriverKm: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: nextId(),
        h3Index: OTHER_H3,
        demandCount: 5,
        lastSeenAt: new Date(),
        resolvedAt: null,
        nearestParkKm: null,
        nearestDriverKm: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );
    // Only GAP_H3 still has demand this run; OTHER_H3 should resolve.
    deliveryStore.push({ pickupLat: GAP_LAT, pickupLng: GAP_LNG, createdAt: new Date(), status: 'routing_failed' });

    await runJob();

    expect(gapStore.find((g) => g.h3Index === GAP_H3)!.resolvedAt).toBeNull();
    expect(gapStore.find((g) => g.h3Index === OTHER_H3)!.resolvedAt).not.toBeNull();
  });

  it('reopens a resolved gap when demand recurs in the same cell', async () => {
    gapStore.push({
      id: nextId(),
      h3Index: GAP_H3,
      demandCount: 4,
      lastSeenAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      resolvedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      nearestParkKm: null,
      nearestDriverKm: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    deliveryStore.push({ pickupLat: GAP_LAT, pickupLng: GAP_LNG, createdAt: new Date(), status: 'routing_failed' });

    await runJob();

    const gap = gapStore.find((g) => g.h3Index === GAP_H3);
    expect(gap!.resolvedAt).toBeNull();
    expect(gap!.demandCount).toBe(1);
  });

  it('computes nearest_park_km / nearest_driver_km via haversine when parks and drivers exist', async () => {
    deliveryStore.push({ pickupLat: GAP_LAT, pickupLng: GAP_LNG, createdAt: new Date(), status: 'routing_failed' });
    parkStore.push({ lat: OTHER_LAT, lng: OTHER_LNG, isActive: true });
    driverStore.push({ lat: GAP_LAT + 0.01, lng: GAP_LNG + 0.01, available: true });

    await runJob();

    const gap = gapStore.find((g) => g.h3Index === GAP_H3)!;
    const center = getH3Center(GAP_H3);
    expect(gap.nearestParkKm).toBeCloseTo(haversineKm(center.lat, center.lng, OTHER_LAT, OTHER_LNG), 5);
    expect(gap.nearestDriverKm).toBeCloseTo(
      haversineKm(center.lat, center.lng, GAP_LAT + 0.01, GAP_LNG + 0.01),
      5,
    );
    // Driver is much closer than the Abuja park
    expect(gap.nearestDriverKm!).toBeLessThan(gap.nearestParkKm!);
  });

  it('leaves nearest_park_km / nearest_driver_km null when none exist', async () => {
    deliveryStore.push({ pickupLat: GAP_LAT, pickupLng: GAP_LNG, createdAt: new Date(), status: 'routing_failed' });

    await runJob();

    const gap = gapStore.find((g) => g.h3Index === GAP_H3)!;
    expect(gap.nearestParkKm).toBeNull();
    expect(gap.nearestDriverKm).toBeNull();
  });

  it('ignores inactive parks and unavailable drivers when computing nearest distance', async () => {
    deliveryStore.push({ pickupLat: GAP_LAT, pickupLng: GAP_LNG, createdAt: new Date(), status: 'routing_failed' });
    parkStore.push({ lat: GAP_LAT, lng: GAP_LNG, isActive: false });
    driverStore.push({ lat: GAP_LAT, lng: GAP_LNG, available: false });

    await runJob();

    const gap = gapStore.find((g) => g.h3Index === GAP_H3)!;
    expect(gap.nearestParkKm).toBeNull();
    expect(gap.nearestDriverKm).toBeNull();
  });
});
