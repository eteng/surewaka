import { matchDriverJobDataSchema } from '@surewaka/shared';
import { matchingQueue } from './matching-queue';

type EnqueueMatchDriverJobParams = {
  deliveryId: string;
  legId: string;
  legType: 'first_mile' | 'transfer' | 'last_mile';
  pickupLng: number;
  pickupLat: number;
  dropoffLng: number;
  dropoffLat: number;
  customerId: string;
  /** Delay before the job fires, in ms. Defaults to 0 (immediate dispatch). */
  delayMs?: number;
};

/**
 * Validates and enqueues a `match-driver` job on the shared matching queue.
 *
 * Single source of truth for the `matchDriverJobDataSchema.parse(...)` +
 * `matchingQueue.add(...)` pairing — previously duplicated across
 * booking-payment.ts's initial trigger and trigger-next-leg.ts's
 * sequential-leg trigger; factored out here rather than writing a third
 * copy for the retry-matching endpoint.
 *
 * Uses the deterministic jobId scheme `match-leg-{legId}` for deduplication
 * (Req 9.4, 4.4). Callers retrying a leg whose prior job still exists (e.g.
 * one that exhausted its retries) must remove it first — BullMQ rejects a
 * duplicate-jobId add outright rather than replacing it.
 */
export async function enqueueMatchDriverJob(params: EnqueueMatchDriverJobParams): Promise<void> {
  const jobData = matchDriverJobDataSchema.parse({
    deliveryId: params.deliveryId,
    legId: params.legId,
    legType: params.legType,
    pickupLng: params.pickupLng,
    pickupLat: params.pickupLat,
    dropoffLng: params.dropoffLng,
    dropoffLat: params.dropoffLat,
    vehicleType: 'motorcycle', // default — matches the fallback used elsewhere (trigger-next-leg.ts, compute-route.ts)
    customerId: params.customerId,
  });

  await matchingQueue.add('match-driver', jobData, {
    delay: params.delayMs ?? 0,
    jobId: `match-leg-${params.legId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
