import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db, deliveries, deliveryLegs } from '@surewaka/db';
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

/**
 * PATCH /api/v1/deliveries/:deliveryId/legs/:legId/status
 *
 * Update a delivery leg's status. When a leg is marked 'delivered',
 * triggers matching for the next driver-type leg in sequence.
 *
 * Validates: Requirements 10.1, 10.6
 */
deliveryLegRoutes.patch('/:deliveryId/legs/:legId/status', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('deliveryId');
  const legId = c.req.param('legId');

  const body = await c.req.json();
  const { status } = body as { status: string };

  if (!status) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'status is required' }, meta: null },
      400,
    );
  }

  try {
    // Verify the delivery exists and belongs to the user (or is an authorized actor)
    const [delivery] = await db
      .select({ id: deliveries.id, customerId: deliveries.customerId })
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

    // Update the leg status
    const now = new Date();
    const updateValues: Record<string, unknown> = { status };

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
