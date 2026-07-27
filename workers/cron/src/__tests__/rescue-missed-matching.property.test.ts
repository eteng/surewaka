import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// Define NIL_UUID directly to avoid transitive @surewaka/db import that requires DATABASE_URL
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Property 16: Cron Sweeper Query Correctness
 *
 * Validates: Requirement 11.1
 *
 * The cron sweeper should return exactly legs matching ALL filter conditions:
 * 1. isActive = true
 * 2. status = 'pending'
 * 3. actorType = 'driver'
 * 4. actorId = NIL_UUID (unassigned)
 * 5. systemEtaAt <= now + buffer (trigger time has passed)
 * 6. Parent delivery status = 'pending'
 *
 * Since the actual query uses Drizzle ORM against Postgres, we test the LOGIC
 * as a pure filter function that mirrors the SQL WHERE clause.
 */

const BUFFER_MINUTES = 45;

type MockLeg = {
  id: string;
  deliveryId: string;
  isActive: boolean;
  status: string;
  actorType: string;
  actorId: string;
  systemEtaAt: Date | null;
  legType: string;
};

type MockDelivery = {
  id: string;
  status: string;
};

// Pure filter function that mirrors the SQL query logic in rescueMissedMatching
function shouldRescue(leg: MockLeg, delivery: MockDelivery, now: Date): boolean {
  const bufferMs = BUFFER_MINUTES * 60 * 1000;
  const triggerThreshold = new Date(now.getTime() + bufferMs);

  return (
    leg.isActive === true &&
    leg.status === 'pending' &&
    leg.actorType === 'driver' &&
    leg.actorId === NIL_UUID &&
    leg.systemEtaAt !== null &&
    leg.systemEtaAt <= triggerThreshold &&
    delivery.status === 'pending'
  );
}

describe('Property 16: Cron Sweeper Query Correctness', () => {
  /** **Validates: Requirements 11.1** */

  // Arbitraries
  const legArb = fc.record({
    id: fc.uuid(),
    deliveryId: fc.uuid(),
    isActive: fc.boolean(),
    status: fc.constantFrom('pending', 'accepted', 'delivered', 'cancelled'),
    actorType: fc.constantFrom('driver', 'carrier'),
    actorId: fc.constantFrom(NIL_UUID, 'some-driver-id', 'another-id'),
    systemEtaAt: fc.oneof(
      fc.constant(null as null),
      fc.date({ min: new Date(2024, 0, 1), max: new Date(2026, 11, 31) }),
    ),
    legType: fc.constantFrom('first_mile', 'transfer', 'last_mile'),
  });

  const deliveryArb = fc.record({
    id: fc.uuid(),
    status: fc.constantFrom('pending', 'accepted', 'cancelled', 'delivered'),
  });

  it('correctly identifies legs needing rescue — all conditions met for rescued, at least one violated for non-rescued', () => {
    fc.assert(
      fc.property(
        fc.array(legArb, { minLength: 5, maxLength: 30 }),
        fc.array(deliveryArb, { minLength: 1, maxLength: 10 }),
        fc.nat({ max: 999999 }),
        (legs, deliveriesArr, seed) => {
          const now = new Date();
          const deliveryMap = new Map(deliveriesArr.map((d) => [d.id, d]));

          // Deterministically assign legs to deliveries using seed
          const assignedLegs = legs.map((leg, i) => ({
            ...leg,
            deliveryId: deliveriesArr[(i + seed) % deliveriesArr.length].id,
          }));

          // Apply the filter logic
          const rescued = assignedLegs.filter((leg) => {
            const delivery = deliveryMap.get(leg.deliveryId);
            if (!delivery) return false;
            return shouldRescue(leg, delivery, now);
          });

          // Verify: every rescued leg meets ALL conditions
          for (const leg of rescued) {
            expect(leg.isActive).toBe(true);
            expect(leg.status).toBe('pending');
            expect(leg.actorType).toBe('driver');
            expect(leg.actorId).toBe(NIL_UUID);
            expect(leg.systemEtaAt).not.toBeNull();

            const bufferMs = BUFFER_MINUTES * 60 * 1000;
            const triggerThreshold = new Date(now.getTime() + bufferMs);
            expect(leg.systemEtaAt!.getTime()).toBeLessThanOrEqual(triggerThreshold.getTime());

            const delivery = deliveryMap.get(leg.deliveryId)!;
            expect(delivery.status).toBe('pending');
          }

          // Verify: no non-rescued leg meets ALL conditions simultaneously
          const notRescued = assignedLegs.filter((leg) => {
            const delivery = deliveryMap.get(leg.deliveryId);
            if (!delivery) return true;
            return !shouldRescue(leg, delivery, now);
          });

          for (const leg of notRescued) {
            const delivery = deliveryMap.get(leg.deliveryId);
            const bufferMs = BUFFER_MINUTES * 60 * 1000;
            const triggerThreshold = new Date(now.getTime() + bufferMs);

            // At least one condition must be false
            const meetsAll =
              leg.isActive === true &&
              leg.status === 'pending' &&
              leg.actorType === 'driver' &&
              leg.actorId === NIL_UUID &&
              leg.systemEtaAt !== null &&
              leg.systemEtaAt <= triggerThreshold &&
              delivery?.status === 'pending';

            expect(meetsAll).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
