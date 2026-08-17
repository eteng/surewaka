import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, deliveries, deliveryLegs } from '@surewaka/db';
import { NIL_UUID } from '@surewaka/shared';
import { requireAuth } from '../middleware/auth';
import { matchingQueue } from '../lib/matching-queue';
import { enqueueMatchDriverJob } from '../lib/enqueue-match-driver';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser } };

const retryMatchingRoutes = new Hono<Env>();
retryMatchingRoutes.use('*', requireAuth);

const uuidSchema = z.string().uuid();

/**
 * POST /api/v1/deliveries/:id/retry-matching
 *
 * The in-app equivalent of the manual rescue script used repeatedly this
 * session: verify the delivery belongs to the caller and is in a
 * `routing_failed` state, reset it to `pending`, remove any existing
 * BullMQ job under the same deterministic jobId (a duplicate-id add is
 * otherwise rejected — see enqueue-match-driver.ts), and enqueue a fresh
 * `match-driver` job for the leg that failed to match.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */
retryMatchingRoutes.post('/:id/retry-matching', async (c) => {
  const user = c.get('user');

  const parsedId = uuidSchema.safeParse(c.req.param('id'));
  if (!parsedId.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery ID format' }, meta: null },
      400,
    );
  }
  const deliveryId = parsedId.data;

  const [delivery] = await db
    .select({ id: deliveries.id, customerId: deliveries.customerId, status: deliveries.status })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!delivery || delivery.customerId !== user.id) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
      404,
    );
  }

  if (delivery.status !== 'routing_failed') {
    return c.json(
      {
        data: null,
        error: { code: 'INVALID_STATUS', message: 'Delivery is not in a retryable state' },
        meta: null,
      },
      409,
    );
  }

  // The leg matching failed for: still unmatched (actorId placeholder),
  // still driver-type, still the active leg for this delivery. Same
  // predicate the cron rescue-sweeper uses to find unmatched driver legs.
  const [leg] = await db
    .select({
      id: deliveryLegs.id,
      legType: deliveryLegs.legType,
      pickupLng: deliveryLegs.pickupLng,
      pickupLat: deliveryLegs.pickupLat,
      dropoffLng: deliveryLegs.dropoffLng,
      dropoffLat: deliveryLegs.dropoffLat,
    })
    .from(deliveryLegs)
    .where(
      and(
        eq(deliveryLegs.deliveryId, deliveryId),
        eq(deliveryLegs.actorType, 'driver'),
        eq(deliveryLegs.actorId, NIL_UUID),
        eq(deliveryLegs.isActive, true),
        eq(deliveryLegs.status, 'pending'),
      ),
    )
    .limit(1);

  if (!leg) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No unmatched leg found for this delivery' }, meta: null },
      404,
    );
  }

  // Remove the exhausted job under the same deterministic jobId before
  // re-adding — BullMQ rejects a duplicate-jobId add outright rather than
  // replacing it (hit this exact error by hand this session).
  const jobId = `match-leg-${leg.id}`;
  const existingJob = await matchingQueue.getJob(jobId);
  if (existingJob) {
    await existingJob.remove();
  }

  await db
    .update(deliveries)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));

  await enqueueMatchDriverJob({
    deliveryId,
    legId: leg.id,
    legType: leg.legType as 'first_mile' | 'transfer' | 'last_mile',
    pickupLng: leg.pickupLng,
    pickupLat: leg.pickupLat,
    dropoffLng: leg.dropoffLng,
    dropoffLat: leg.dropoffLat,
    customerId: user.id,
  });

  return c.json({ data: { deliveryId, retried: true }, error: null, meta: null });
});

export default retryMatchingRoutes;
