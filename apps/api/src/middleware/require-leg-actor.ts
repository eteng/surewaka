import { createMiddleware } from 'hono/factory';
import { eq, and } from 'drizzle-orm';
import { db, deliveryLegs, drivers } from '@surewaka/db';
import type { AuthUser } from '@surewaka/auth';

type LegActorEnv = {
  Variables: {
    user: AuthUser;
    leg: {
      id: string;
      deliveryId: string;
      actorType: string;
      actorId: string;
      legNumber: number;
      legType: string;
      status: string;
      isActive: boolean;
      systemEtaAt: Date | null;
      slaHours: number | null;
      pickupLng: number;
      pickupLat: number;
      dropoffLng: number;
      dropoffLat: number;
    };
  };
};

/**
 * Resource-level authorization middleware for delivery leg operations.
 *
 * Verifies:
 * 1. The leg exists and belongs to the specified delivery
 * 2. The authenticated user is either:
 *    - The assigned driver for this leg (actorType='driver', actorId matches user's driver record)
 *    - A carrier member for carrier-type legs
 *    - A surewaka_admin (bypass)
 *
 * On success, attaches the `leg` record to the Hono context for downstream use.
 *
 * Must execute AFTER `requireAuth` (and optionally `requireRole`) in the middleware chain.
 *
 * Expects path params: `deliveryId` (or `id`) and `legId`.
 */
export const requireLegActor = createMiddleware<LegActorEnv>(async (c, next) => {
  const user = c.get('user');

  // Admin bypass
  if (user.roles.includes('surewaka_admin')) {
    // Still load the leg for downstream handlers
    const legId = c.req.param('legId');
    const deliveryId = c.req.param('deliveryId') ?? c.req.param('id');

    if (!legId || !deliveryId) {
      return c.json(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'Missing legId or deliveryId' }, meta: null },
        400,
      );
    }

    const [leg] = await db
      .select()
      .from(deliveryLegs)
      .where(and(eq(deliveryLegs.id, legId), eq(deliveryLegs.deliveryId, deliveryId)));

    if (!leg) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Delivery leg not found' }, meta: null },
        404,
      );
    }

    c.set('leg', leg as LegActorEnv['Variables']['leg']);
    return next();
  }

  // Resolve path params (supports both `:deliveryId` and `:id` conventions)
  const legId = c.req.param('legId');
  const deliveryId = c.req.param('deliveryId') ?? c.req.param('id');

  if (!legId || !deliveryId) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Missing legId or deliveryId' }, meta: null },
      400,
    );
  }

  // Load the leg
  const [leg] = await db
    .select()
    .from(deliveryLegs)
    .where(and(eq(deliveryLegs.id, legId), eq(deliveryLegs.deliveryId, deliveryId)));

  if (!leg) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Delivery leg not found' }, meta: null },
      404,
    );
  }

  // Authorization check based on leg actor type
  if (leg.actorType === 'driver') {
    // Resolve the user's driver record
    const [driver] = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.userId, user.id))
      .limit(1);

    if (!driver || driver.id !== leg.actorId) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Not the assigned driver for this leg' }, meta: null },
        403,
      );
    }
  } else if (leg.actorType === 'carrier') {
    // For carrier legs, user must have carrier_admin or carrier_driver role
    const isCarrierMember = user.roles.includes('carrier_admin') || user.roles.includes('carrier_driver');
    if (!isCarrierMember) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Not authorized for this carrier leg' }, meta: null },
        403,
      );
    }
  }

  // Attach leg to context for downstream handlers (avoids re-fetching)
  c.set('leg', leg as LegActorEnv['Variables']['leg']);
  await next();
});
