import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, deliveries, deliveryLegs, drivers } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { triggerNextLegMatching } from '../lib/trigger-next-leg';
import type { AuthUser } from '@surewaka/auth';

type DeliveryLegsEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const deliveryLegRoutes = new Hono<DeliveryLegsEnv>();

deliveryLegRoutes.use('*', requireAuth);

// ─── Input validation schema ──────────────────────────────────────────────────

const ALLOWED_LEG_STATUSES = [
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
] as const;

const updateLegStatusSchema = z.object({
  status: z.enum(ALLOWED_LEG_STATUSES),
});

/**
 * PATCH /api/v1/deliveries/:deliveryId/legs/:legId/status
 *
 * Update a delivery leg's status. When a leg is marked 'delivered',
 * triggers matching for the next driver-type leg in sequence.
 *
 * Authorization: The authenticated user must be either:
 * - The assigned driver for this leg (actorType='driver', actorId matches)
 * - A surewaka_admin
 *
 * Validates: Requirements 10.1, 10.6
 */
deliveryLegRoutes.patch('/:deliveryId/legs/:legId/status', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('deliveryId');
  const legId = c.req.param('legId');

  // Input validation — only allow known status values (prevents mass assignment)
  const body = await c.req.json();
  const parsed = updateLegStatusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid status' }, meta: null },
      400,
    );
  }
  const { status } = parsed.data;

  try {
    // Verify the delivery exists
    const [delivery] = await db
      .select({ id: deliveries.id, customerId: deliveries.customerId, driverId: deliveries.driverId })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));

    if (!delivery) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
        404,
      );
    }

    // Verify the leg exists and belongs to this delivery
    const [leg] = await db
      .select()
      .from(deliveryLegs)
      .where(
        and(
          eq(deliveryLegs.id, legId),
          eq(deliveryLegs.deliveryId, deliveryId),
        ),
      );

    if (!leg) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Delivery leg not found' }, meta: null },
        404,
      );
    }

    // ── Authorization (IDOR prevention) ─────────────────────────────────────
    // Only the assigned actor for this leg or an admin can update status.
    const isAdmin = user.roles.includes('surewaka_admin');

    if (!isAdmin) {
      // For driver-type legs, resolve the user's driver ID and check against actorId
      if (leg.actorType === 'driver') {
        const [driver] = await db
          .select({ id: drivers.id })
          .from(drivers)
          .where(eq(drivers.userId, user.id))
          .limit(1);

        if (!driver || driver.id !== leg.actorId) {
          return c.json(
            { data: null, error: { code: 'FORBIDDEN', message: 'Not authorized to update this leg' }, meta: null },
            403,
          );
        }
      } else {
        // For carrier-type legs, check if user is the customer or has carrier role for this carrier
        const isCustomer = delivery.customerId === user.id;
        const isCarrierMember = user.roles.includes('carrier_admin') || user.roles.includes('carrier_driver');
        if (!isCustomer && !isCarrierMember) {
          return c.json(
            { data: null, error: { code: 'FORBIDDEN', message: 'Not authorized to update this leg' }, meta: null },
            403,
          );
        }
      }
    }

    // Update the leg status (only the validated status field — no mass assignment)
    const now = new Date();
    const updateValues: { status: string; completedAt?: Date } = { status };

    // Set completedAt timestamp when leg is marked delivered
    if (status === 'delivered') {
      updateValues.completedAt = now;
    }

    const [updatedLeg] = await db
      .update(deliveryLegs)
      .set(updateValues)
      .where(eq(deliveryLegs.id, legId))
      .returning();

    // Req 10.1, 10.6: Trigger next leg matching only after preceding leg is delivered
    if (status === 'delivered') {
      await triggerNextLegMatching(deliveryId, leg.legNumber);
    }

    return c.json({ data: updatedLeg, error: null, meta: null });
  } catch (err) {
    console.error('[PATCH /deliveries/:deliveryId/legs/:legId/status]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update leg status' }, meta: null },
      500,
    );
  }
});

export default deliveryLegRoutes;
