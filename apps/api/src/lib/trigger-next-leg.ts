import { and, asc, eq, gt } from 'drizzle-orm';
import { db, deliveries, deliveryLegs } from '@surewaka/db';
import { getConfig, BUSINESS_HOUR_START, BUSINESS_HOUR_END, matchDriverJobDataSchema } from '@surewaka/shared';
import { matchingQueue } from './matching-queue';

/**
 * Compute the next business hour start from a given time.
 *
 * Business hours are 7am–9pm WAT. If the current time is within that window,
 * returns `now`. Otherwise, returns the next day's 7am (or today's 7am if
 * current time is before 7am).
 *
 * Validates: Requirements 10.3, 10.4
 */
export function getNextBusinessHourStart(now: Date): Date {
  const hour = now.getHours();

  // Within business hours — no delay needed
  if (hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END) {
    return now;
  }

  const next = new Date(now);

  if (hour >= BUSINESS_HOUR_END) {
    // After 9pm — next business start is tomorrow at 7am
    next.setDate(next.getDate() + 1);
  }

  // Before 7am or after 9pm (with date already bumped) — set to 7am
  next.setHours(BUSINESS_HOUR_START, 0, 0, 0);
  return next;
}

/**
 * Trigger matching for the next driver-type leg after a leg completes.
 *
 * Called from the delivery-legs route when a leg status is updated to 'delivered'.
 * Implements event-driven sequential dispatch for multi-leg surewaka_way deliveries.
 *
 * For transfer legs: delay = max(nextCarrierDeparture - legETA - buffer, now)
 * For last-mile legs: delay = max(nextBusinessHourStart, customerWindow - legETA - buffer, now)
 *
 * Uses deterministic jobId `match-leg:{legId}` for deduplication (Req 9.4).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export async function triggerNextLegMatching(
  deliveryId: string,
  completedLegNumber: number,
): Promise<void> {
  // Find the next active leg after the one just completed
  const [nextLeg] = await db
    .select()
    .from(deliveryLegs)
    .where(
      and(
        eq(deliveryLegs.deliveryId, deliveryId),
        gt(deliveryLegs.legNumber, completedLegNumber),
        eq(deliveryLegs.isActive, true),
      ),
    )
    .orderBy(asc(deliveryLegs.legNumber))
    .limit(1);

  if (!nextLeg) return; // No more legs

  // Only trigger matching for driver-type legs (Req 10.1)
  if (nextLeg.actorType !== 'driver') return;

  // Fetch delivery details for matching job payload
  const [delivery] = await db
    .select({
      customerId: deliveries.customerId,
    })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!delivery) return;

  // ADR-010: buffer is admin-configurable via system_config (default: 45 minutes)
  const buffer = await getConfig('matching.first_mile_dispatch_buffer_min');
  let delayMs = 0; // default: immediate dispatch

  if (nextLeg.legType === 'transfer' && nextLeg.systemEtaAt) {
    // ADR-010: max(nextCarrierDeparture - legETA - buffer, now)
    // systemEtaAt for transfer legs = nextCarrierDeparture
    // Use slaHours as proxy for legETA when legEtaMinutes isn't available
    const legETAMs = (nextLeg.slaHours ?? 0) * 60 * 60 * 1000;
    const bufferMs = buffer * 60 * 1000;
    const triggerAt = nextLeg.systemEtaAt.getTime() - legETAMs - bufferMs;
    delayMs = Math.max(0, triggerAt - Date.now());
  }

  if (nextLeg.legType === 'last_mile') {
    // ADR-010: max(nextBusinessHourStart, customerWindow - legETA - buffer, now)
    const legETAMs = (nextLeg.slaHours ?? 0) * 60 * 60 * 1000;
    const bufferMs = buffer * 60 * 1000;
    const now = new Date();
    const nextBusinessStart = getNextBusinessHourStart(now);

    // Floor: earliest trigger is next business hour start
    let triggerAt = nextBusinessStart.getTime();

    if (nextLeg.systemEtaAt) {
      // Use systemEtaAt as proxy deadline (carrier arrival or estimated delivery time)
      const etaTrigger = nextLeg.systemEtaAt.getTime() - legETAMs - bufferMs;
      triggerAt = Math.max(triggerAt, etaTrigger);
    }

    delayMs = Math.max(0, triggerAt - Date.now());
  }

  // Validate job data before enqueueing (Req 16.4)
  const jobData = matchDriverJobDataSchema.parse({
    deliveryId,
    legId: nextLeg.id,
    legType: nextLeg.legType as 'transfer' | 'last_mile',
    pickupLng: nextLeg.pickupLng,
    pickupLat: nextLeg.pickupLat,
    dropoffLng: nextLeg.dropoffLng,
    dropoffLat: nextLeg.dropoffLat,
    vehicleType: 'motorcycle', // default for surewaka_way
    customerId: delivery.customerId,
  });

  await matchingQueue.add(
    'match-driver',
    jobData,
    {
      delay: delayMs,
      jobId: `match-leg:${nextLeg.id}`, // deterministic — prevents duplicate enqueue (Req 9.4)
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}
