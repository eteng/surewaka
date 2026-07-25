import { db, deliveries } from '@surewaka/db';
import { eq, and, lt } from 'drizzle-orm';
import { enqueueRouteDelivery } from '../lib/routing-enqueue';

const STALE_THRESHOLD_MINUTES = 10;
const MAX_RESCUE_BATCH = 20;

/**
 * Rescues deliveries stuck in `pending_routing` for more than 10 minutes.
 * Re-enqueues them to the routing queue with a fresh bookingTime.
 *
 * Idempotent: the routing worker skips jobs where delivery status has already changed.
 * Runs every 5 minutes via cron scheduler.
 */
export async function rescueStaleRouting(): Promise<void> {
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  const staleDeliveries = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, 'pending_routing'),
        lt(deliveries.createdAt, threshold),
      ),
    )
    .limit(MAX_RESCUE_BATCH);

  if (staleDeliveries.length === 0) return;

  for (const delivery of staleDeliveries) {
    await enqueueRouteDelivery({
      deliveryId: delivery.id,
      bookingTime: new Date().toISOString(),
      vehicleType: 'motorcycle',
    });
  }

  console.info(`[cron:rescue-stale-routing] Re-enqueued ${staleDeliveries.length} stale deliveries`);
}
