import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, deliveries, deliveryLegs } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { requireLegActor } from '../middleware/require-leg-actor';
import { triggerNextLegMatching } from '../lib/trigger-next-leg';
import type { AuthUser } from '@surewaka/auth';

type DeliveryLegsEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
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
 * Authorization: requireLegActor verifies the user is the assigned driver
 * for this leg (or an admin). The leg record is pre-loaded on c.get('leg').
 *
 * Validates: Requirements 10.1, 10.6
 */
deliveryLegRoutes.patch(
  '/:deliveryId/legs/:legId/status',
  requireRole('driver', 'carrier_driver'),
  requireLegActor,
  async (c) => {
    const leg = c.get('leg');
    const deliveryId = c.req.param('deliveryId');

    // Input validation — only allow known status values
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
      // Update the leg status (only the validated status field)
      const now = new Date();
      const updateValues: { status: string; completedAt?: Date } = { status };

      if (status === 'delivered') {
        updateValues.completedAt = now;
      }

      const [updatedLeg] = await db
        .update(deliveryLegs)
        .set(updateValues)
        .where(eq(deliveryLegs.id, leg.id))
        .returning();

      // Trigger next leg matching only after preceding leg is delivered
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
  },
);

export default deliveryLegRoutes;
