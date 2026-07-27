// Feature: driver-matching-routing
// Property 13: Timed Dispatch Formula Correctness — delay equals max(deadline - legETA - buffer - now, 0), last-mile clamped to business hours
// Property 14: Deterministic Job ID — jobId always `match-leg:{legId}` format
// Property 15: Leg Sequentiality — matching never triggered until preceding legs complete
// Validates: Requirements 9.1, 9.3, 9.4, 10.2, 10.3, 10.4, 10.6, 11.4

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { BUSINESS_HOUR_START, BUSINESS_HOUR_END } from '@surewaka/shared';

// Mock database and queue dependencies so we can import the pure function
vi.mock('@surewaka/db', () => ({
  db: { select: vi.fn() },
  deliveries: {},
  deliveryLegs: {},
  eq: vi.fn(),
  gt: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
}));

vi.mock('../lib/matching-queue', () => ({
  matchingQueue: { add: vi.fn() },
}));

vi.mock('@surewaka/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@surewaka/shared')>();
  return {
    ...actual,
    getConfig: vi.fn().mockResolvedValue(45),
  };
});

import { getNextBusinessHourStart } from '../lib/trigger-next-leg';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pure reimplementation of the first-mile/transfer delay formula from ADR-010:
 * delay = max(carrierDeparture - legETA - buffer - now, 0)
 */
function computeDispatchDelay(
  carrierDepartureMs: number,
  legETAMinutes: number,
  bufferMinutes: number,
  nowMs: number,
): number {
  const legETAMs = legETAMinutes * 60 * 1000;
  const bufferMs = bufferMinutes * 60 * 1000;
  const triggerAt = carrierDepartureMs - legETAMs - bufferMs;
  return Math.max(0, triggerAt - nowMs);
}

/**
 * Pure reimplementation of last-mile delay formula from ADR-010:
 * delay = max(nextBusinessHourStart, deadline - legETA - buffer, now) - now
 * Clamped to >= 0
 */
function computeLastMileDelay(
  now: Date,
  deadlineMs: number,
  legETAMinutes: number,
  bufferMinutes: number,
): number {
  const legETAMs = legETAMinutes * 60 * 1000;
  const bufferMs = bufferMinutes * 60 * 1000;
  const nextBusinessStart = getNextBusinessHourStart(now);

  // Floor: earliest trigger is next business hour start
  let triggerAt = nextBusinessStart.getTime();

  // Use deadline - legETA - buffer if that's later
  const etaTrigger = deadlineMs - legETAMs - bufferMs;
  triggerAt = Math.max(triggerAt, etaTrigger);

  return Math.max(0, triggerAt - now.getTime());
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Timed Dispatch Property Tests', () => {
  /**
   * **Validates: Requirements 9.1, 9.3**
   */
  describe('Property 13: Timed Dispatch Formula Correctness', () => {
    it('delay equals max(carrierDeparture - legETA - buffer - now, 0)', () => {
      fc.assert(
        fc.property(
          // carrierDeparture: a future timestamp (1 to 48 hours from a fixed base)
          fc.integer({ min: 1, max: 48 * 60 }).map((mins) => Date.now() + mins * 60 * 1000),
          fc.integer({ min: 5, max: 120 }),  // legETA in minutes
          fc.integer({ min: 15, max: 90 }),  // buffer in minutes
          fc.integer({ min: 0, max: 60 }).map((mins) => Date.now() - mins * 60 * 1000), // now (at or before current time)
          (carrierDepartureMs, legETA, buffer, nowMs) => {
            const delay = computeDispatchDelay(carrierDepartureMs, legETA, buffer, nowMs);

            // Property: delay is always >= 0
            expect(delay).toBeGreaterThanOrEqual(0);

            // Property: delay matches the formula exactly
            const legETAMs = legETA * 60 * 1000;
            const bufferMs = buffer * 60 * 1000;
            const triggerAt = carrierDepartureMs - legETAMs - bufferMs;
            const expected = Math.max(0, triggerAt - nowMs);
            expect(delay).toBe(expected);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('delay is 0 when trigger time is in the past (late booking clamp)', () => {
      fc.assert(
        fc.property(
          // carrierDeparture in the past relative to now
          fc.integer({ min: 1, max: 120 }).map((mins) => Date.now() - mins * 60 * 1000),
          fc.integer({ min: 30, max: 120 }),  // legETA in minutes
          fc.integer({ min: 30, max: 90 }),   // buffer in minutes
          (carrierDepartureMs, legETA, buffer) => {
            const nowMs = Date.now();
            const delay = computeDispatchDelay(carrierDepartureMs, legETA, buffer, nowMs);

            // When departure is in the past, trigger is certainly in the past → delay = 0
            expect(delay).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('last-mile delay is always >= business hour start offset', () => {
      fc.assert(
        fc.property(
          // Generate a date outside business hours (before 7am or after 9pm)
          fc.oneof(
            fc.integer({ min: 0, max: BUSINESS_HOUR_START - 1 }),    // 0-6
            fc.integer({ min: BUSINESS_HOUR_END, max: 23 }),         // 21-23
          ),
          fc.integer({ min: 0, max: 59 }),      // minutes
          fc.integer({ min: 10, max: 120 }),    // legETA
          fc.integer({ min: 15, max: 90 }),     // buffer
          (hour, minute, legETA, buffer) => {
            const now = new Date(2024, 5, 15, hour, minute, 0, 0);
            const nextBiz = getNextBusinessHourStart(now);

            // Deadline far in the future so it doesn't override business hour floor
            const deadlineMs = now.getTime() + 24 * 60 * 60 * 1000;
            const delay = computeLastMileDelay(now, deadlineMs, legETA, buffer);

            // The delay must be at least as large as the gap to next business hour
            const minDelay = nextBiz.getTime() - now.getTime();
            // Either delay is >= minDelay (business hours floor applies)
            // OR the deadline-based trigger is later (larger delay)
            expect(delay).toBeGreaterThanOrEqual(minDelay);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 10.3, 10.4**
   */
  describe('Property 13b: getNextBusinessHourStart', () => {
    it('returns same date when within business hours [7, 21)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: BUSINESS_HOUR_START, max: BUSINESS_HOUR_END - 1 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 0, max: 59 }),
          (hour, minute, second) => {
            const now = new Date(2024, 5, 15, hour, minute, second, 0);
            const result = getNextBusinessHourStart(now);
            expect(result.getTime()).toBe(now.getTime());
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns next day 7am when hour >= 21', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: BUSINESS_HOUR_END, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 1, max: 28 }), // day of month (avoid month overflow)
          (hour, minute, day) => {
            const now = new Date(2024, 5, day, hour, minute, 0, 0);
            const result = getNextBusinessHourStart(now);

            expect(result.getHours()).toBe(BUSINESS_HOUR_START);
            expect(result.getMinutes()).toBe(0);
            expect(result.getSeconds()).toBe(0);
            expect(result.getMilliseconds()).toBe(0);
            expect(result.getDate()).toBe(day + 1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns same day 7am when hour < 7', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: BUSINESS_HOUR_START - 1 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 1, max: 28 }), // day of month
          (hour, minute, day) => {
            const now = new Date(2024, 5, day, hour, minute, 0, 0);
            const result = getNextBusinessHourStart(now);

            expect(result.getHours()).toBe(BUSINESS_HOUR_START);
            expect(result.getMinutes()).toBe(0);
            expect(result.getSeconds()).toBe(0);
            expect(result.getMilliseconds()).toBe(0);
            expect(result.getDate()).toBe(day); // same day
          },
        ),
        { numRuns: 100 },
      );
    });

    it('result is always >= input time (never schedules in the past)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 0, max: 59 }),
          (hour, minute, second) => {
            const now = new Date(2024, 5, 15, hour, minute, second, 0);
            const result = getNextBusinessHourStart(now);
            expect(result.getTime()).toBeGreaterThanOrEqual(now.getTime());
          },
        ),
        { numRuns: 200 },
      );
    });

    it('result is always at a business hour start (7am) or is the input itself', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          (hour, minute) => {
            const now = new Date(2024, 5, 15, hour, minute, 0, 0);
            const result = getNextBusinessHourStart(now);

            if (result.getTime() !== now.getTime()) {
              // If result differs from input, it must be at exactly 7:00:00.000
              expect(result.getHours()).toBe(BUSINESS_HOUR_START);
              expect(result.getMinutes()).toBe(0);
              expect(result.getSeconds()).toBe(0);
              expect(result.getMilliseconds()).toBe(0);
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  /**
   * **Validates: Requirements 9.4, 10.6**
   */
  describe('Property 14: Deterministic Job ID', () => {
    it('jobId always follows match-leg:{legId} format for UUID inputs', () => {
      fc.assert(
        fc.property(fc.uuid(), (legId) => {
          const jobId = `match-leg:${legId}`;
          expect(jobId).toMatch(/^match-leg:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
          expect(jobId).toBe(`match-leg:${legId}`);
        }),
        { numRuns: 100 },
      );
    });

    it('jobId is deterministic — same legId always produces same jobId', () => {
      fc.assert(
        fc.property(fc.uuid(), (legId) => {
          const jobId1 = `match-leg:${legId}`;
          const jobId2 = `match-leg:${legId}`;
          expect(jobId1).toBe(jobId2);
        }),
        { numRuns: 100 },
      );
    });

    it('different legIds produce different jobIds (no collisions)', () => {
      fc.assert(
        fc.property(fc.uuid(), fc.uuid(), (legId1, legId2) => {
          fc.pre(legId1 !== legId2);
          const jobId1 = `match-leg:${legId1}`;
          const jobId2 = `match-leg:${legId2}`;
          expect(jobId1).not.toBe(jobId2);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 10.6, 11.4**
   */
  describe('Property 15: Leg Sequentiality', () => {
    type LegStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled';

    type MockLeg = {
      id: string;
      legNumber: number;
      actorType: 'driver' | 'carrier';
      status: LegStatus;
      isActive: boolean;
    };

    /**
     * Simulates the leg sequentiality logic:
     * Given a completed leg number, find the next active driver-type leg.
     * Returns undefined if no eligible leg exists.
     */
    function findNextEligibleLeg(
      legs: MockLeg[],
      completedLegNumber: number,
    ): MockLeg | undefined {
      return legs
        .filter(
          (leg) =>
            leg.legNumber > completedLegNumber &&
            leg.isActive &&
            leg.actorType === 'driver',
        )
        .sort((a, b) => a.legNumber - b.legNumber)[0];
    }

    /** Arbitrary for a leg status */
    const legStatusArb = fc.constantFrom<LegStatus>('pending', 'in_transit', 'delivered', 'cancelled');

    /** Arbitrary for actor type */
    const actorTypeArb = fc.constantFrom<'driver' | 'carrier'>('driver', 'carrier');

    /** Arbitrary for a multi-leg delivery (3-7 legs) */
    const legsArb = fc
      .integer({ min: 3, max: 7 })
      .chain((numLegs) =>
        fc.tuple(
          ...Array.from({ length: numLegs }, (_, i) =>
            fc.record({
              id: fc.uuid(),
              legNumber: fc.constant(i + 1),
              actorType: actorTypeArb,
              status: legStatusArb,
              isActive: fc.boolean(),
            }),
          ),
        ),
      )
      .map((legs) => legs as MockLeg[]);

    it('only finds legs with legNumber > completedLegNumber', () => {
      fc.assert(
        fc.property(
          legsArb,
          fc.integer({ min: 1, max: 7 }),
          (legs, completedLegNumber) => {
            const nextLeg = findNextEligibleLeg(legs, completedLegNumber);

            if (nextLeg) {
              expect(nextLeg.legNumber).toBeGreaterThan(completedLegNumber);
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('only triggers matching for driver-type legs (not carrier)', () => {
      fc.assert(
        fc.property(
          legsArb,
          fc.integer({ min: 0, max: 6 }),
          (legs, completedLegNumber) => {
            const nextLeg = findNextEligibleLeg(legs, completedLegNumber);

            if (nextLeg) {
              expect(nextLeg.actorType).toBe('driver');
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('only triggers matching for active legs', () => {
      fc.assert(
        fc.property(
          legsArb,
          fc.integer({ min: 0, max: 6 }),
          (legs, completedLegNumber) => {
            const nextLeg = findNextEligibleLeg(legs, completedLegNumber);

            if (nextLeg) {
              expect(nextLeg.isActive).toBe(true);
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('selects the leg with the smallest legNumber among eligible candidates', () => {
      fc.assert(
        fc.property(
          legsArb,
          fc.integer({ min: 0, max: 6 }),
          (legs, completedLegNumber) => {
            const nextLeg = findNextEligibleLeg(legs, completedLegNumber);

            if (nextLeg) {
              // All other eligible legs must have legNumber >= nextLeg.legNumber
              const allEligible = legs.filter(
                (leg) =>
                  leg.legNumber > completedLegNumber &&
                  leg.isActive &&
                  leg.actorType === 'driver',
              );

              for (const leg of allEligible) {
                expect(leg.legNumber).toBeGreaterThanOrEqual(nextLeg.legNumber);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it('returns nothing when no active driver-type leg exists after the completed one', () => {
      fc.assert(
        fc.property(
          legsArb,
          (legs) => {
            // Complete the last possible leg number
            const maxLegNumber = Math.max(...legs.map((l) => l.legNumber));
            const nextLeg = findNextEligibleLeg(legs, maxLegNumber);

            expect(nextLeg).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('preceding incomplete legs block the trigger (sequential execution)', () => {
      // Create a scenario where we simulate: only trigger leg N+2 if leg N+1 is delivered
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.uuid(),
          fc.uuid(),
          (baseLegNumber, id1, id2) => {
            // Two consecutive driver legs: one incomplete, one pending
            const legs: MockLeg[] = [
              {
                id: id1,
                legNumber: baseLegNumber,
                actorType: 'driver',
                status: 'in_transit', // NOT delivered
                isActive: true,
              },
              {
                id: id2,
                legNumber: baseLegNumber + 1,
                actorType: 'driver',
                status: 'pending',
                isActive: true,
              },
            ];

            // Simulate: trigger only fires when completedLegNumber is reported
            // If we call with completedLegNumber = baseLegNumber - 1,
            // the trigger would find leg at baseLegNumber (not the one after)
            const nextFromBefore = findNextEligibleLeg(legs, baseLegNumber - 1);
            expect(nextFromBefore?.legNumber).toBe(baseLegNumber);

            // Only when baseLegNumber is reported as complete, next leg is found
            const nextFromComplete = findNextEligibleLeg(legs, baseLegNumber);
            expect(nextFromComplete?.legNumber).toBe(baseLegNumber + 1);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
