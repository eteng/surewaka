import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { db, deliveryLegs, deliveries } from '@surewaka/db';
import { eq, and, lte } from 'drizzle-orm';
import { getConfig, NIL_UUID } from '@surewaka/shared';
import type { MatchDriverJobData } from '@surewaka/shared';

const MAX_RESCUE_BATCH = 20;

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const matchingQueue = new Queue<MatchDriverJobData>('matching', { connection });

/**
 * Rescues delivery legs that should have had matching triggered but don't
 * have a job in the queue. Runs every 5 minutes via cron scheduler.
 *
 * ADR-010 safety net logic:
 * A leg needs rescue if `systemEtaAt - buffer <= now` (i.e., we're within
 * buffer-minutes of the deadline and no driver is assigned).
 *
 * Equivalent query: systemEtaAt <= now + buffer (triggerThreshold).
 *
 * Idempotent: matching worker skips if leg/delivery status has changed.
 * JobId deduplication prevents double-enqueue.
 */
export async function rescueMissedMatching(): Promise<void> {
  const buffer = await getConfig('matching.first_mile_dispatch_buffer_min'); // default: 45
  const bufferMs = buffer * 60 * 1000;
  const triggerThreshold = new Date(Date.now() + bufferMs);

  const missedLegs = await db
    .select({
      id: deliveryLegs.id,
      deliveryId: deliveryLegs.deliveryId,
      legType: deliveryLegs.legType,
      pickupLng: deliveryLegs.pickupLng,
      pickupLat: deliveryLegs.pickupLat,
      dropoffLng: deliveryLegs.dropoffLng,
      dropoffLat: deliveryLegs.dropoffLat,
    })
    .from(deliveryLegs)
    .innerJoin(deliveries, eq(deliveries.id, deliveryLegs.deliveryId))
    .where(
      and(
        eq(deliveryLegs.isActive, true),
        eq(deliveryLegs.status, 'pending'),
        eq(deliveryLegs.actorType, 'driver'),
        eq(deliveryLegs.actorId, NIL_UUID),
        lte(deliveryLegs.systemEtaAt, triggerThreshold),
        eq(deliveries.status, 'pending'),
      ),
    )
    .limit(MAX_RESCUE_BATCH);

  let rescueCount = 0;
  for (const leg of missedLegs) {
    const jobId = `match-leg:${leg.id}`;
    const existingJob = await matchingQueue.getJob(jobId);
    if (existingJob) continue;

    await matchingQueue.add(
      'match-driver',
      {
        deliveryId: leg.deliveryId,
        legId: leg.id,
        legType: leg.legType as MatchDriverJobData['legType'],
        pickupLng: leg.pickupLng,
        pickupLat: leg.pickupLat,
        dropoffLng: leg.dropoffLng,
        dropoffLat: leg.dropoffLat,
        vehicleType: 'motorcycle', // default
        customerId: '', // will be resolved by the matching worker
      },
      {
        delay: 0,
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
    rescueCount++;
  }

  if (rescueCount > 0) {
    console.log(`[rescue-missed-matching] Rescued ${rescueCount} missed matching jobs`);
  }
}
