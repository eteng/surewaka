import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, deliveries, deliveryLegs } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { requireLegActor } from '../middleware/require-leg-actor';
import { triggerNextLegMatching } from '../lib/trigger-next-leg';
import { getRealtime, CHANNELS, EVENTS } from '../lib/realtime';
import { notifyDeliveryStatusChange, notifyDriverArrived } from '../services/push-triggers';
import type { AuthUser } from '@surewaka/auth';
import type { DeliveryStatus, StatusUpdatePayload } from '@surewaka/shared';

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
      // Snapshot the delivery's overall status before this update, so the
      // realtime publish below can report an honest previousStatus/newStatus
      // pair rather than guessing — most leg updates don't move it at all.
      const [deliveryBefore] = await db
        .select({ status: deliveries.status, customerId: deliveries.customerId })
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId))
        .limit(1);
      const previousDeliveryStatus = (deliveryBefore?.status ?? 'accepted') as DeliveryStatus;
      let newDeliveryStatus = previousDeliveryStatus;

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

        // If every still-active leg of this delivery is now delivered, the
        // whole delivery is complete. Nothing else ever advances
        // deliveries.status past 'accepted' — without this, it stays
        // "active" per idx_deliveries_active_driver forever, permanently
        // blocking this driver from ever being matched to another delivery.
        const remainingLegs = await db
          .select({ status: deliveryLegs.status })
          .from(deliveryLegs)
          .where(and(eq(deliveryLegs.deliveryId, deliveryId), eq(deliveryLegs.isActive, true)));

        if (remainingLegs.every((l) => l.status === 'delivered')) {
          await db
            .update(deliveries)
            .set({ status: 'delivered', updatedAt: now })
            .where(eq(deliveries.id, deliveryId));
          newDeliveryStatus = 'delivered';
        }
      }

      // Tell the tracking screen (Requirement 7.1, 7.2) — EVENTS.statusUpdate
      // was a dead constant until now, never published anywhere.
      const realtime = getRealtime();
      const payload: StatusUpdatePayload = {
        deliveryId,
        previousStatus: previousDeliveryStatus,
        newStatus: newDeliveryStatus,
        timestamp: now.toISOString(),
        legId: leg.id,
        legStatus: status,
      };
      await realtime.publish(CHANNELS.deliveryTracking(deliveryId), EVENTS.statusUpdate, payload);

      // Customer-facing milestone pushes — fire-and-forget, a push failure
      // shouldn't fail the status update. 'accepted' is already covered by
      // delivery-accept.ts's own push; 'en_route_pickup' has no trigger
      // function yet (nobody's written driver-en-route copy).
      if (deliveryBefore?.customerId) {
        const customerId = deliveryBefore.customerId;
        if (status === 'arrived_pickup' || status === 'arrived_dropoff') {
          notifyDriverArrived(deliveryId, customerId, status).catch((err) =>
            console.error('[PushTrigger] driver_arrived failed:', err),
          );
        } else if (status === 'picked_up' || status === 'en_route_dropoff' || status === 'delivered') {
          notifyDeliveryStatusChange(deliveryId, customerId, status).catch((err) =>
            console.error('[PushTrigger] delivery_status_change failed:', err),
          );
        }
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
