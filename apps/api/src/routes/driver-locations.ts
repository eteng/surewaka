import { Hono } from 'hono';
import { db, deliveries, driverLocations, drivers } from '@surewaka/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { recordDriverLocationSchema } from '@surewaka/shared';
import { getH3Cell, H3_RESOLUTION } from '@surewaka/shared/h3';
import { initLocationStore, updateDriverLocation } from '@surewaka/realtime';
import type { AuthUser } from '@surewaka/auth';
import { getRedis } from '../lib/redis';
import { getRealtime } from '../lib/realtime';

type Env = { Variables: { user: AuthUser } };

// ─── Rate Limiting ────────────────────────────────────────────────────────────

/** Simple per-driver rate limit: 1 request per 2 seconds */
const lastUpdateMap = new Map<string, number>();
const RATE_LIMIT_MS = 2000;

function isRateLimited(driverId: string): boolean {
  const now = Date.now();
  const lastUpdate = lastUpdateMap.get(driverId) ?? 0;
  if (now - lastUpdate < RATE_LIMIT_MS) return true;
  lastUpdateMap.set(driverId, now);
  return false;
}

/** @internal — exposed for test teardown only */
export function _resetRateLimit(): void {
  lastUpdateMap.clear();
}

// ─── Postgres Write Throttling ─────────────────────────────────────────────────

/**
 * Redis + Ably get every ping at whatever cadence the client sends (that's
 * what they're built for — cheap, and it's the live-tracking path). Postgres
 * does not need that freshness: `drivers.lat/lng/h3Index` only feeds
 * density/matching queries, and `driver_locations` is an audit trail, not
 * where live tracking reads from. Throttling these separately from the
 * request-level rate limit above keeps the fast path fast while capping
 * write (and index-maintenance) volume on the two Postgres tables.
 */
const lastPgWriteMap = new Map<string, number>();
const POSTGRES_WRITE_THROTTLE_MS = 15_000;

function shouldPersistToPostgres(driverId: string): boolean {
  const now = Date.now();
  const lastWrite = lastPgWriteMap.get(driverId) ?? 0;
  if (now - lastWrite < POSTGRES_WRITE_THROTTLE_MS) return false;
  lastPgWriteMap.set(driverId, now);
  return true;
}

/** @internal — exposed for test teardown only */
export function _resetPgWriteThrottle(): void {
  lastPgWriteMap.clear();
}

// ─── Location Store Lazy Init ─────────────────────────────────────────────────

let locationStoreInitialized = false;

function ensureLocationStore(): void {
  if (locationStoreInitialized) return;
  initLocationStore({
    redis: getRedis(),
    realtime: getRealtime(),
  });
  locationStoreInitialized = true;
}

// ─── Route ────────────────────────────────────────────────────────────────────

const driverLocationRoutes = new Hono<Env>();
driverLocationRoutes.use('*', requireAuth);

driverLocationRoutes.post('/', async (c) => {
  const user = c.get('user');

  // Role check: require driver or carrier_driver role
  if (!user.roles.includes('driver') && !user.roles.includes('carrier_driver')) {
    return c.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'Driver role required' }, meta: null },
      403,
    );
  }

  const body = await c.req.json();
  const parsed = recordDriverLocationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  // Resolve driver record for this user
  const [driver] = await db
    .select({ id: drivers.id, vehicleType: drivers.vehicleType })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);

  if (!driver) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Driver profile not found' }, meta: null },
      404,
    );
  }

  // Rate limit: 1 request per 2 seconds per driver
  if (isRateLimited(driver.id)) {
    return c.json(
      { data: null, error: { code: 'RATE_LIMITED', message: 'Too many location updates' }, meta: null },
      429,
    );
  }

  if (parsed.data.deliveryId) {
    const [delivery] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.id, parsed.data.deliveryId), eq(deliveries.driverId, driver.id)))
      .limit(1);

    if (!delivery) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Delivery not assigned to this driver' }, meta: null },
        403,
      );
    }
  }

  // Update Redis geo store + publish to Ably via location store — every
  // ping, at full client cadence. This is the live-tracking path.
  ensureLocationStore();
  await updateDriverLocation(
    driver.id,
    parsed.data.lng,
    parsed.data.lat,
    { status: 'available', vehicleType: driver.vehicleType },
    { deliveryId: parsed.data.deliveryId },
  );

  // Postgres writes are throttled independently of the above — see
  // shouldPersistToPostgres for why.
  const persisted = shouldPersistToPostgres(driver.id);
  let locationId: string | undefined;

  if (persisted) {
    // Update driver's H3 cell + coordinates in Postgres (for density queries)
    const h3Index = getH3Cell(parsed.data.lat, parsed.data.lng, H3_RESOLUTION);
    await db
      .update(drivers)
      .set({ lat: parsed.data.lat, lng: parsed.data.lng, h3Index })
      .where(eq(drivers.id, driver.id));

    // Postgres audit trail (when there's an active delivery)
    if (parsed.data.deliveryId) {
      const [location] = await db
        .insert(driverLocations)
        .values({
          driverId: driver.id,
          deliveryId: parsed.data.deliveryId,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
        })
        .returning({ id: driverLocations.id });

      locationId = location.id;
    }
  }

  return c.json({
    data: { recorded: true, persisted, ...(locationId ? { id: locationId } : {}) },
    error: null,
    meta: null,
  });
});

export default driverLocationRoutes;
