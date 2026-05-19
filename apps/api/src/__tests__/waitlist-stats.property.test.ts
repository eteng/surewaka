// Feature: waitlist-admin, Property 7: Stats aggregation correctness
// Validates: Requirements 6.1, 6.3
//
// For any dataset of waitlist signups, the stats endpoint SHALL return counts where:
// `total = bySender + byBusiness + byDriver`, each per-type count equals the number
// of records with that userType, and `last7Days` equals the number of records with
// `createdAt` within the last 7 days.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockSelectResult = vi.fn();

vi.mock('@surewaka/db', () => {
  const waitlistSignups = {
    fullName: { name: 'full_name' },
    email: { name: 'email' },
    userType: { name: 'user_type' },
    source: { name: 'source' },
    createdAt: { name: 'created_at' },
    updatedAt: { name: 'updated_at' },
    id: { name: 'id' },
  };

  return {
    db: {
      select: (...args: unknown[]) => mockSelectResult(...args),
    },
    waitlistSignups,
  };
});

// ─── Types ───────────────────────────────────────────────────────────────────

type WaitlistUserType = 'sender' | 'business' | 'driver';

type MockSignup = {
  id: string;
  fullName: string;
  email: string;
  userType: WaitlistUserType;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const userTypeArb = fc.constantFrom<WaitlistUserType>('sender', 'business', 'driver');

const signupArb: fc.Arbitrary<MockSignup> = fc.record({
  id: fc.uuid(),
  fullName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  email: fc.emailAddress(),
  userType: userTypeArb,
  source: fc.oneof(fc.constant(null), fc.constantFrom('home', 'launch-campaign', 'referral')),
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  updatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute expected stats from a set of signups.
 * Counts per userType and counts records within 7 days of "now".
 */
function computeExpectedStats(
  signups: MockSignup[],
  now: Date
): { total: number; bySender: number; byBusiness: number; byDriver: number; last7Days: number } {
  let bySender = 0;
  let byBusiness = 0;
  let byDriver = 0;
  let last7Days = 0;

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const signup of signups) {
    switch (signup.userType) {
      case 'sender':
        bySender++;
        break;
      case 'business':
        byBusiness++;
        break;
      case 'driver':
        byDriver++;
        break;
    }

    if (signup.createdAt >= sevenDaysAgo) {
      last7Days++;
    }
  }

  return {
    total: bySender + byBusiness + byDriver,
    bySender,
    byBusiness,
    byDriver,
    last7Days,
  };
}

/**
 * Build the grouped type counts array that the DB would return from GROUP BY user_type.
 */
function buildGroupedCounts(signups: MockSignup[]): { userType: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const signup of signups) {
    counts[signup.userType] = (counts[signup.userType] || 0) + 1;
  }
  return Object.entries(counts).map(([userType, count]) => ({ userType, count }));
}

/**
 * Set up the mock to handle the two sequential DB calls made by getWaitlistStats():
 * 1. GROUP BY userType query → returns array of { userType, count }
 * 2. WHERE createdAt >= 7 days ago → returns [{ count: N }]
 */
function setupStatsMock(signups: MockSignup[], now: Date) {
  const groupedCounts = buildGroupedCounts(signups);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentCount = signups.filter((s) => s.createdAt >= sevenDaysAgo).length;

  let callCount = 0;

  mockSelectResult.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // First call: GROUP BY userType query
      // Chain: select({ userType, count }).from(waitlistSignups).groupBy(userType)
      return {
        from: () => ({
          groupBy: () => Promise.resolve(groupedCounts),
        }),
      };
    } else {
      // Second call: recent signups count query
      // Chain: select({ count }).from(waitlistSignups).where(gte(...))
      return {
        from: () => ({
          where: () => Promise.resolve([{ count: recentCount }]),
        }),
      };
    }
  });

  return { groupedCounts, recentCount };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Waitlist Service — Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Property 7: Stats aggregation correctness', () => {
    it('total equals bySender + byBusiness + byDriver for any dataset', async () => {
      const { getWaitlistStats } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 50 }),
          async (signups) => {
            const now = new Date();
            setupStatsMock(signups, now);

            const stats = await getWaitlistStats();

            // **Validates: Requirements 6.1**
            // total must equal the sum of per-type counts
            expect(stats.total).toBe(stats.bySender + stats.byBusiness + stats.byDriver);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('per-type counts match actual count of records with that userType', async () => {
      const { getWaitlistStats } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 50 }),
          async (signups) => {
            const now = new Date();
            const expected = computeExpectedStats(signups, now);
            setupStatsMock(signups, now);

            const stats = await getWaitlistStats();

            // **Validates: Requirements 6.1**
            // Each per-type count must match the actual number of records with that type
            expect(stats.bySender).toBe(expected.bySender);
            expect(stats.byBusiness).toBe(expected.byBusiness);
            expect(stats.byDriver).toBe(expected.byDriver);
            expect(stats.total).toBe(expected.total);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('last7Days matches records with createdAt within 7-day window', async () => {
      const { getWaitlistStats } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 50 }),
          async (signups) => {
            const now = new Date();
            const expected = computeExpectedStats(signups, now);
            setupStatsMock(signups, now);

            const stats = await getWaitlistStats();

            // **Validates: Requirements 6.3**
            // last7Days must match the count of records within the 7-day window
            expect(stats.last7Days).toBe(expected.last7Days);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('stats are consistent across varying distributions of userTypes', async () => {
      const { getWaitlistStats } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          // Generate counts for each type directly to test edge distributions
          fc.nat({ max: 30 }),
          fc.nat({ max: 30 }),
          fc.nat({ max: 30 }),
          fc.nat({ max: 20 }),
          async (senderCount, businessCount, driverCount, recentCount) => {
            // Ensure recentCount doesn't exceed total
            const total = senderCount + businessCount + driverCount;
            const effectiveRecent = Math.min(recentCount, total);

            const groupedCounts: { userType: string; count: number }[] = [];
            if (senderCount > 0) groupedCounts.push({ userType: 'sender', count: senderCount });
            if (businessCount > 0)
              groupedCounts.push({ userType: 'business', count: businessCount });
            if (driverCount > 0) groupedCounts.push({ userType: 'driver', count: driverCount });

            let callCount = 0;
            mockSelectResult.mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                return {
                  from: () => ({
                    groupBy: () => Promise.resolve(groupedCounts),
                  }),
                };
              } else {
                return {
                  from: () => ({
                    where: () => Promise.resolve([{ count: effectiveRecent }]),
                  }),
                };
              }
            });

            const stats = await getWaitlistStats();

            // Verify the fundamental invariant: total = sum of parts
            expect(stats.total).toBe(senderCount + businessCount + driverCount);
            expect(stats.bySender).toBe(senderCount);
            expect(stats.byBusiness).toBe(businessCount);
            expect(stats.byDriver).toBe(driverCount);
            expect(stats.last7Days).toBe(effectiveRecent);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
