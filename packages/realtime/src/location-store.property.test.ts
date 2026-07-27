import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  initLocationStore,
  updateDriverLocation,
  findNearbyDrivers,
  removeDriver,
  getDriverMeta,
} from './location-store';
import type { RealtimeProvider } from './types';

// ─── Haversine helper ─────────────────────────────────────────────────────────

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── In-memory mock Redis with faithful geo semantics ─────────────────────────

type GeoEntry = { lng: number; lat: number; member: string };

function createMockRedis() {
  const geoSets = new Map<string, GeoEntry[]>();
  const hashes = new Map<string, Record<string, string>>();
  const keys = new Set<string>();

  return {
    geoadd(key: string, lng: number, lat: number, member: string) {
      if (!geoSets.has(key)) geoSets.set(key, []);
      const set = geoSets.get(key)!;
      const existing = set.findIndex((e) => e.member === member);
      if (existing >= 0) {
        set[existing] = { lng, lat, member };
      } else {
        set.push({ lng, lat, member });
      }
      keys.add(key);
      return Promise.resolve(existing >= 0 ? 0 : 1);
    },

    hset(key: string, data: Record<string, string>) {
      if (!hashes.has(key)) hashes.set(key, {});
      const hash = hashes.get(key)!;
      Object.assign(hash, data);
      keys.add(key);
      return Promise.resolve('OK');
    },

    hgetall(key: string) {
      const hash = hashes.get(key);
      if (!hash || Object.keys(hash).length === 0) return Promise.resolve({});
      return Promise.resolve({ ...hash });
    },

    geosearch(
      key: string,
      _fromType: string,
      lng: number,
      lat: number,
      _byType: string,
      radius: number,
      _unit: string,
      _sort: string,
      _withDist: string,
      _count: string,
      _countVal: number,
    ): Promise<Array<[string, string]>> {
      const set = geoSets.get(key);
      if (!set || set.length === 0) return Promise.resolve([]);

      const results: Array<{ member: string; distance: number }> = [];
      for (const entry of set) {
        const dist = haversineKm(lat, lng, entry.lat, entry.lng);
        if (dist <= radius) {
          results.push({ member: entry.member, distance: dist });
        }
      }

      // Sort by distance ascending (matches Redis GEOSEARCH ASC behavior)
      results.sort((a, b) => a.distance - b.distance);

      return Promise.resolve(
        results.map((r) => [r.member, r.distance.toFixed(4)]),
      );
    },

    zrem(key: string, member: string) {
      const set = geoSets.get(key);
      if (set) {
        const idx = set.findIndex((e) => e.member === member);
        if (idx >= 0) {
          set.splice(idx, 1);
          return Promise.resolve(1);
        }
      }
      return Promise.resolve(0);
    },

    del(key: string) {
      hashes.delete(key);
      keys.delete(key);
      return Promise.resolve(1);
    },
  };
}

// ─── Mock Realtime Provider ───────────────────────────────────────────────────

function createMockRealtime(): RealtimeProvider {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const validLng = fc.double({ min: -180, max: 180, noNaN: true });
const validLat = fc.double({ min: -90, max: 90, noNaN: true });

// Avoid extreme latitudes where geo math becomes imprecise
const safeLng = fc.double({ min: -179, max: 179, noNaN: true });
const safeLat = fc.double({ min: -85, max: 85, noNaN: true });

const driverIdArb = fc.uuid();
const vehicleTypeArb = fc.constantFrom(
  'motorcycle' as const,
  'car' as const,
  'van' as const,
  'truck' as const,
);
const statusArb = fc.constantFrom(
  'available' as const,
  'busy' as const,
  'offline' as const,
);

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Location Store Property Tests', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockRealtime: RealtimeProvider;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockRealtime = createMockRealtime();
    initLocationStore({
      redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
      realtime: mockRealtime,
    });
  });

  /**
   * **Property 1: Location Update Round-Trip**
   * After `updateDriverLocation`, geo set and meta hash return stored values.
   *
   * **Validates: Requirements 1.1, 1.2**
   */
  describe('Property 1: Location Update Round-Trip', () => {
    it('after updateDriverLocation, getDriverMeta returns stored metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          validLng,
          validLat,
          vehicleTypeArb,
          async (driverId, lng, lat, vehicleType) => {
            // Re-init for isolation
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            await updateDriverLocation(driverId, lng, lat, {
              status: 'available',
              vehicleType,
            });

            const meta = await getDriverMeta(driverId);
            expect(meta).not.toBeNull();
            expect(meta!.lat).toBe(lat.toString());
            expect(meta!.lng).toBe(lng.toString());
            expect(meta!.status).toBe('available');
            expect(meta!.vehicleType).toBe(vehicleType);
            expect(Number(meta!.lastSeen)).toBeGreaterThan(0);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('after updateDriverLocation, findNearbyDrivers at same coordinates finds the driver', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          safeLng,
          safeLat,
          vehicleTypeArb,
          async (driverId, lng, lat, vehicleType) => {
            // Re-init for isolation
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            await updateDriverLocation(driverId, lng, lat, {
              status: 'available',
              vehicleType,
            });

            // Use a small radius to find driver at exact location
            const nearby = await findNearbyDrivers(lng, lat, 1, {
              maxStaleMs: 60_000,
            });

            const found = nearby.find((d) => d.driverId === driverId);
            expect(found).toBeDefined();
            expect(found!.distanceKm).toBeCloseTo(0, 1);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * **Property 2: Driver Removal Cleanup**
   * After `removeDriver`, both lookups return null/empty.
   *
   * **Validates: Requirement 1.3**
   */
  describe('Property 2: Driver Removal Cleanup', () => {
    it('after removeDriver, getDriverMeta returns null', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          validLng,
          validLat,
          vehicleTypeArb,
          async (driverId, lng, lat, vehicleType) => {
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            await updateDriverLocation(driverId, lng, lat, {
              status: 'available',
              vehicleType,
            });

            // Confirm driver exists
            const metaBefore = await getDriverMeta(driverId);
            expect(metaBefore).not.toBeNull();

            // Remove driver
            await removeDriver(driverId);

            // Both lookups return null/empty
            const metaAfter = await getDriverMeta(driverId);
            expect(metaAfter).toBeNull();
          },
        ),
        { numRuns: 50 },
      );
    });

    it('after removeDriver, findNearbyDrivers does not include the removed driver', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          safeLng,
          safeLat,
          vehicleTypeArb,
          async (driverId, lng, lat, vehicleType) => {
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            await updateDriverLocation(driverId, lng, lat, {
              status: 'available',
              vehicleType,
            });

            await removeDriver(driverId);

            const nearby = await findNearbyDrivers(lng, lat, 100, {
              maxStaleMs: 60_000,
            });

            const found = nearby.find((d) => d.driverId === driverId);
            expect(found).toBeUndefined();
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * **Property 3: Spatial Query Correctness**
   * All returned drivers are within radius, sorted by distance ascending.
   *
   * **Validates: Requirements 2.1, 2.2**
   */
  describe('Property 3: Spatial Query Correctness', () => {
    it('all returned drivers are within radius and sorted by distance ascending', async () => {
      const driverLocationArb = fc.record({
        driverId: fc.uuid(),
        lng: safeLng,
        lat: safeLat,
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(driverLocationArb, { minLength: 2, maxLength: 15 }),
          safeLng,
          safeLat,
          fc.double({ min: 1, max: 50, noNaN: true }),
          async (drivers, queryLng, queryLat, radiusKm) => {
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            // Add all drivers as available
            for (const d of drivers) {
              await updateDriverLocation(d.driverId, d.lng, d.lat, {
                status: 'available',
                vehicleType: 'motorcycle',
              });
            }

            const nearby = await findNearbyDrivers(queryLng, queryLat, radiusKm, {
              maxStaleMs: 60_000,
            });

            // All returned drivers must be within the radius
            for (const result of nearby) {
              expect(result.distanceKm).toBeLessThanOrEqual(radiusKm);
            }

            // Results must be sorted by distance ascending
            for (let i = 1; i < nearby.length; i++) {
              expect(nearby[i]!.distanceKm).toBeGreaterThanOrEqual(
                nearby[i - 1]!.distanceKm,
              );
            }
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  /**
   * **Property 4: Driver Filtering Invariants**
   * Only available, non-stale, matching vehicle type drivers are returned.
   *
   * **Validates: Requirements 2.2, 2.3, 2.4**
   */
  describe('Property 4: Driver Filtering Invariants', () => {
    it('only available, non-stale, matching vehicleType drivers are returned', async () => {
      const driverArb = fc.record({
        driverId: fc.uuid(),
        lng: safeLng,
        lat: safeLat,
        status: statusArb,
        vehicleType: vehicleTypeArb,
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(driverArb, { minLength: 3, maxLength: 15 }),
          vehicleTypeArb,
          async (drivers, filterVehicleType) => {
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            // Use a common point and large radius so all drivers are in range
            const centerLng = 3.38;
            const centerLat = 6.52;

            for (const d of drivers) {
              // Place all drivers within 1km of center for simplicity
              await updateDriverLocation(
                d.driverId,
                centerLng + (d.lng % 0.005),
                centerLat + (d.lat % 0.005),
                {
                  status: d.status,
                  vehicleType: d.vehicleType,
                },
              );
            }

            const nearby = await findNearbyDrivers(centerLng, centerLat, 100, {
              vehicleType: filterVehicleType,
              maxStaleMs: 60_000,
            });

            // All returned drivers must be available
            for (const result of nearby) {
              expect(result.meta.status).toBe('available');
            }

            // All returned drivers must match the vehicle type filter
            for (const result of nearby) {
              expect(result.meta.vehicleType).toBe(filterVehicleType);
            }

            // Verify completeness: every driver that's available + matching type should be in results
            const expectedIds = new Set(
              drivers
                .filter(
                  (d) =>
                    d.status === 'available' &&
                    d.vehicleType === filterVehicleType,
                )
                .map((d) => d.driverId),
            );

            const returnedIds = new Set(nearby.map((n) => n.driverId));
            for (const expectedId of expectedIds) {
              expect(returnedIds.has(expectedId)).toBe(true);
            }
          },
        ),
        { numRuns: 30 },
      );
    });

    it('stale drivers are excluded from results', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          safeLng,
          safeLat,
          vehicleTypeArb,
          async (driverId, lng, lat, vehicleType) => {
            mockRedis = createMockRedis();
            initLocationStore({
              redis: mockRedis as unknown as Parameters<typeof initLocationStore>[0]['redis'],
              realtime: mockRealtime,
            });

            await updateDriverLocation(driverId, lng, lat, {
              status: 'available',
              vehicleType,
            });

            // Query with extremely short stale threshold (1ms) to make driver appear stale
            // We need to wait at least 1ms
            await new Promise((resolve) => setTimeout(resolve, 5));

            const nearby = await findNearbyDrivers(lng, lat, 100, {
              maxStaleMs: 1,
            });

            // The driver should be excluded because lastSeen > 1ms ago
            const found = nearby.find((d) => d.driverId === driverId);
            expect(found).toBeUndefined();
          },
        ),
        { numRuns: 20 },
      );
    });
  });
});
