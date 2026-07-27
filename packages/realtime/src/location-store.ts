import type IORedis from 'ioredis';
import type { RealtimeProvider } from './types';
import { CHANNELS, EVENTS } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DriverMeta = {
  lastSeen: string; // unix timestamp ms
  lat: string;
  lng: string;
  status: 'available' | 'busy' | 'offline';
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
};

export type NearbyDriver = {
  driverId: string;
  distanceKm: number;
  meta: DriverMeta;
};

// ─── Dependency Injection ─────────────────────────────────────────────────────

type PersistLocationFn = (data: {
  driverId: string;
  deliveryId: string;
  lat: number;
  lng: number;
}) => Promise<void>;

export type LocationStoreDeps = {
  redis: IORedis;
  realtime: RealtimeProvider;
  persistLocation?: PersistLocationFn;
};

let deps: LocationStoreDeps;

export function initLocationStore(d: LocationStoreDeps): void {
  deps = d;
}

function getDeps(): LocationStoreDeps {
  if (!deps) {
    throw new Error('Location store not initialized. Call initLocationStore() first.');
  }
  return deps;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GEO_KEY = 'drivers:active';
const metaKey = (driverId: string) => `driver:${driverId}:meta`;

// ─── updateDriverLocation ─────────────────────────────────────────────────────

/**
 * Update a driver's real-time location in Redis and publish to Ably.
 *
 * - Stores position in the `drivers:active` geo sorted set
 * - Stores metadata in the `driver:{id}:meta` hash
 * - Publishes location update to the `driver-location:{driverId}` Ably channel
 * - Conditionally persists to Postgres `driver_locations` audit table when
 *   a `deliveryId` is provided (indicating an active delivery)
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5
 */
export async function updateDriverLocation(
  driverId: string,
  lng: number,
  lat: number,
  meta: Partial<DriverMeta>,
  options?: { deliveryId?: string },
): Promise<void> {
  const { redis, realtime, persistLocation } = getDeps();

  const now = Date.now().toString();

  // 1. GEOADD to drivers:active geo set (Req 1.1)
  await redis.geoadd(GEO_KEY, lng, lat, driverId);

  // 2. HSET driver metadata (Req 1.2)
  const hashData: Record<string, string> = {
    lastSeen: now,
    lat: lat.toString(),
    lng: lng.toString(),
  };

  if (meta.status) hashData.status = meta.status;
  if (meta.vehicleType) hashData.vehicleType = meta.vehicleType;

  await redis.hset(metaKey(driverId), hashData);

  // 3. Publish position to Ably channel (Req 1.4)
  await realtime.publish(
    CHANNELS.driverLocation(driverId),
    EVENTS.locationUpdate,
    { driverId, lng, lat, timestamp: now },
  );

  // 4. Conditionally persist to Postgres audit table (Req 1.5)
  if (options?.deliveryId && persistLocation) {
    await persistLocation({
      driverId,
      deliveryId: options.deliveryId,
      lat,
      lng,
    });
  }
}

// ─── findNearbyDrivers ────────────────────────────────────────────────────────

/** Default stale threshold: 30 seconds */
const DEFAULT_STALE_MS = 30_000;

/**
 * Find nearby available drivers within a given radius of a point.
 *
 * Uses Redis GEOSEARCH for spatial query, fetches metadata for each result,
 * then filters out stale, non-available, and vehicle-type-mismatched drivers.
 *
 * This is a read-only operation — no mutations to Redis state.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */
export async function findNearbyDrivers(
  lng: number,
  lat: number,
  radiusKm: number,
  filters?: { vehicleType?: string; maxStaleMs?: number },
): Promise<NearbyDriver[]> {
  const { redis } = getDeps();
  const maxStaleMs = filters?.maxStaleMs ?? DEFAULT_STALE_MS;

  // GEOSEARCH with WITHDIST returns [member, distance] pairs sorted by distance ASC
  const results = (await redis.geosearch(
    GEO_KEY,
    'FROMLONLAT',
    lng,
    lat,
    'BYRADIUS',
    radiusKm,
    'km',
    'ASC',
    'WITHDIST',
    'COUNT',
    100,
  )) as unknown as Array<[string, string]>;

  if (!results || results.length === 0) {
    return [];
  }

  const now = Date.now();
  const nearby: NearbyDriver[] = [];

  for (const [driverId, distanceStr] of results) {
    // Fetch driver metadata
    const metaRaw = await redis.hgetall(metaKey(driverId));

    // Skip if metadata is missing (driver removed between geo query and meta fetch)
    if (!metaRaw || Object.keys(metaRaw).length === 0) {
      continue;
    }

    const meta = metaRaw as unknown as DriverMeta;

    // Filter: stale drivers (lastSeen > threshold) — Req 2.2
    if (now - Number(meta.lastSeen) > maxStaleMs) {
      continue;
    }

    // Filter: non-available status — Req 2.3
    if (meta.status !== 'available') {
      continue;
    }

    // Filter: vehicle type mismatch — Req 2.4
    if (filters?.vehicleType && meta.vehicleType !== filters.vehicleType) {
      continue;
    }

    nearby.push({
      driverId,
      distanceKm: parseFloat(distanceStr),
      meta,
    });
  }

  // Results are already sorted by distance ASC from GEOSEARCH — Req 2.1
  return nearby;
}

// ─── removeDriver ─────────────────────────────────────────────────────────────

/**
 * Remove a driver from the geo set and delete their metadata hash.
 * Called when a driver logs out or disconnects.
 *
 * Validates: Requirement 1.3
 */
export async function removeDriver(driverId: string): Promise<void> {
  const { redis } = getDeps();

  await Promise.all([
    redis.zrem(GEO_KEY, driverId),
    redis.del(metaKey(driverId)),
  ]);
}

// ─── getDriverMeta ────────────────────────────────────────────────────────────

/**
 * Fetch driver metadata from Redis.
 * Returns null if the driver has no metadata stored (key doesn't exist).
 *
 * Validates: Requirement 1.3
 */
export async function getDriverMeta(driverId: string): Promise<DriverMeta | null> {
  const { redis } = getDeps();
  const result = await redis.hgetall(metaKey(driverId));

  if (Object.keys(result).length === 0) {
    return null;
  }

  return result as unknown as DriverMeta;
}
