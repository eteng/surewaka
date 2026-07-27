import { matchDriverJobDataSchema } from '@surewaka/shared';
import { getConfig } from '@surewaka/shared/server';
import { matchingQueue } from '../queue';

/**
 * Delivery shape needed for scheduling first-mile matching.
 * Uses a minimal interface to avoid coupling to the full Drizzle row type.
 */
type Delivery = {
  id: string;
  customerId: string;
  vehicleMode?: string | null;
};

/**
 * Delivery leg shape needed for scheduling first-mile matching.
 */
type DeliveryLeg = {
  id: string;
  pickupLng: number;
  pickupLat: number;
  dropoffLng: number;
  dropoffLat: number;
};

/**
 * Schedule first-mile driver matching as a delayed BullMQ job.
 *
 * ADR-010 formula: triggerAt = max(carrierDeparture - legETA - buffer, now)
 * - buffer is admin-configurable via system_config (default: 45 minutes)
 * - legETA is the estimated travel time in minutes for the first-mile leg
 * - carrierDeparture is when the carrier departs from the origin park
 *
 * Uses deterministic jobId `match-leg:{legId}` to prevent duplicate enqueue (Req 9.4).
 * Configured with 3 attempts and exponential backoff from 5s for resilience.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4
 */
export async function scheduleFirstMileMatching(
  delivery: Delivery,
  firstMileLeg: DeliveryLeg,
  carrierDeparture: Date,
  legETA: number, // minutes
): Promise<void> {
  // ADR-010: buffer is admin-configurable via system_config (Req 9.2)
  const buffer = await getConfig('matching.first_mile_dispatch_buffer_min'); // default: 45
  const bufferMs = buffer * 60 * 1000;
  const legETAMs = legETA * 60 * 1000;

  // ADR-010 formula: max(carrierDeparture - legETA - buffer, now) (Req 9.3)
  const triggerAt = new Date(carrierDeparture.getTime() - legETAMs - bufferMs);
  const delayMs = Math.max(0, triggerAt.getTime() - Date.now());

  // Validate job data before enqueueing (Req 16.4)
  const jobData = matchDriverJobDataSchema.parse({
    deliveryId: delivery.id,
    legId: firstMileLeg.id,
    legType: 'first_mile',
    pickupLng: firstMileLeg.pickupLng,
    pickupLat: firstMileLeg.pickupLat,
    dropoffLng: firstMileLeg.dropoffLng,
    dropoffLat: firstMileLeg.dropoffLat,
    vehicleType: (delivery.vehicleMode as 'motorcycle' | 'car' | 'van' | 'truck') ?? 'motorcycle',
    customerId: delivery.customerId,
  });

  await matchingQueue.add(
    'match-driver',
    jobData,
    {
      delay: delayMs,
      jobId: `match-leg:${firstMileLeg.id}`, // deterministic — prevents duplicate enqueue (Req 9.4)
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}
