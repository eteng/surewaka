import { Hono } from 'hono';
import { db, deliveryOffers, deliveries, drivers } from '@surewaka/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import type { AuthUser } from '@surewaka/auth';
import { z } from 'zod';
import { getRedis } from '../lib/redis';
import { claimDelivery, releaseReservations } from '../lib/matching-redis';
import { getRealtime, CHANNELS } from '../lib/realtime';
import { enqueuePush } from '../services/push-service';
import { PUSH_DEEP_LINK_MAP } from '@surewaka/shared';
import type { PushNotificationPayload } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser } };

const deliveryAcceptRoutes = new Hono<Env>();
deliveryAcceptRoutes.use('*', requireAuth);

// UUID format validation for path parameter
const uuidSchema = z.string().uuid();

deliveryAcceptRoutes.post('/:deliveryId/accept', async (c) => {
  const user = c.get('user');

  // 1. Role check: require driver or carrier_driver role (Req 16.2)
  if (!user.roles.includes('driver') && !user.roles.includes('carrier_driver')) {
    return c.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'Driver role required' }, meta: null },
      403,
    );
  }

  // 2. Validate deliveryId format (Req 16.4)
  const deliveryId = c.req.param('deliveryId');
  const parsed = uuidSchema.safeParse(deliveryId);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery ID format' },
        meta: null,
      },
      400,
    );
  }

  // 3. Resolve driver record for this user
  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);

  if (!driver) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Driver profile not found' }, meta: null },
      404,
    );
  }

  // 4. Verify offer exists with status 'pending' for this driver/delivery (Req 6.8)
  const [offer] = await db
    .select({ id: deliveryOffers.id })
    .from(deliveryOffers)
    .where(
      and(
        eq(deliveryOffers.deliveryId, deliveryId),
        eq(deliveryOffers.driverId, driver.id),
        eq(deliveryOffers.status, 'pending'),
      ),
    )
    .limit(1);

  if (!offer) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'No pending offer found for this delivery' },
        meta: null,
      },
      404,
    );
  }

  // 5. Attempt atomic claim via Redis SET NX (Req 6.1)
  const redis = getRedis();
  const claimResult = await claimDelivery(redis, deliveryId, driver.id);

  if (!claimResult.claimed) {
    // Race lost — another driver already claimed (Req 6.3, 6.7)
    return c.json({ data: { matched: false }, error: null, meta: null });
  }

  // 6. Claim succeeded — update Postgres state

  // 6a. Update delivery with driver assignment (WHERE driver_id IS NULL safety — Req 6.2)
  await db
    .update(deliveries)
    .set({ driverId: driver.id, status: 'accepted', updatedAt: new Date() })
    .where(and(eq(deliveries.id, deliveryId), isNull(deliveries.driverId)));

  // 6b. Update winning offer to 'accepted' with respondedAt (Req 8.2)
  await db
    .update(deliveryOffers)
    .set({ status: 'accepted', respondedAt: new Date(), updatedAt: new Date() })
    .where(eq(deliveryOffers.id, offer.id));

  // 6c. Cancel all other pending offers for this delivery (Req 6.4, 8.4)
  await db
    .update(deliveryOffers)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(deliveryOffers.deliveryId, deliveryId),
        eq(deliveryOffers.status, 'pending'),
      ),
    );

  // 6d. Release all driver reservations for this delivery (Req 6.5)
  const allOffers = await db
    .select({ driverId: deliveryOffers.driverId })
    .from(deliveryOffers)
    .where(eq(deliveryOffers.deliveryId, deliveryId));

  const reservedDriverIds = [...new Set(allOffers.map((o) => o.driverId))];
  if (reservedDriverIds.length > 0) {
    await releaseReservations(redis, reservedDriverIds);
  }

  // 7. Publish 'driver-assigned' event via Ably (Req 6.6)
  const realtime = getRealtime();
  const assignedAt = new Date().toISOString();
  await realtime.publish(
    CHANNELS.deliveryTracking(deliveryId),
    'driver-assigned',
    { deliveryId, driverId: driver.id, assignedAt },
  );

  // 8. Send push notification to customer (Req 6.6)
  const [delivery] = await db
    .select({ customerId: deliveries.customerId })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (delivery) {
    const pushPayload: PushNotificationPayload = {
      title: 'Driver Assigned',
      body: 'A driver has been assigned to your delivery and is on the way to pick up.',
      data: {
        type: 'delivery_status_change',
        resourceId: deliveryId,
        deepLink: PUSH_DEEP_LINK_MAP.delivery_status_change.replace(':resourceId', deliveryId),
      },
    };
    // Fire-and-forget — don't block the response on push delivery
    enqueuePush(delivery.customerId, 'delivery_status_change', pushPayload, 'customer').catch(
      (err) => console.error('[delivery-accept] Push notification failed:', err),
    );
  }

  return c.json({ data: { matched: true }, error: null, meta: null });
});

export default deliveryAcceptRoutes;
