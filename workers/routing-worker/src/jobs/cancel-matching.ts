import { matchingQueue } from '../queue';
import { db, deliveryOffers } from '@surewaka/db';
import { eq, and } from 'drizzle-orm';
import { releaseReservations } from '../lib/reservation';

/**
 * Cancel a scheduled matching job before it fires.
 * Used when a customer cancels before the delayed match triggers.
 *
 * Validates: Requirement 13.2
 */
export async function cancelScheduledMatching(legId: string): Promise<void> {
  const jobId = `match-leg:${legId}`;
  const job = await matchingQueue.getJob(jobId);

  if (job) {
    await job.remove();
  }
}

/**
 * Full cancellation cleanup for an in-progress or scheduled matching.
 * Releases all driver reservations and expires all pending offers.
 *
 * Validates: Requirement 13.3
 */
export async function cleanupCancelledMatching(deliveryId: string): Promise<void> {
  // Expire all pending offers for this delivery
  await db
    .update(deliveryOffers)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(deliveryOffers.deliveryId, deliveryId),
        eq(deliveryOffers.status, 'pending'),
      ),
    );

  // Get all driver IDs that were offered
  const offers = await db
    .select({ driverId: deliveryOffers.driverId })
    .from(deliveryOffers)
    .where(eq(deliveryOffers.deliveryId, deliveryId));

  const driverIds = [...new Set(offers.map((o) => o.driverId))];
  if (driverIds.length > 0) {
    await releaseReservations(driverIds);
  }
}
