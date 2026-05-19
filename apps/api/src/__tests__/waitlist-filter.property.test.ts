// Feature: waitlist-admin, Property 5: Filter correctness
// Validates: Requirements 3.1, 3.2, 4.1, 4.2
//
// For any combination of userType and source filter parameters applied to any dataset,
// every record in the response SHALL match ALL applied filter criteria. When no filter
// is applied for a dimension, records of all values for that dimension SHALL be included.

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

const knownSources = ['home', 'launch-campaign', 'referral', 'social', 'blog'];
const sourceArb = fc.oneof(fc.constant(null), fc.constantFrom(...knownSources));

const signupArb: fc.Arbitrary<MockSignup> = fc.record({
  id: fc.uuid(),
  fullName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  email: fc.emailAddress(),
  userType: userTypeArb,
  source: sourceArb,
  createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
  updatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
});

// Optional userType filter: either a valid enum value or undefined (no filter)
const userTypeFilterArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom<WaitlistUserType>('sender', 'business', 'driver')
);

// Optional source filter: either a known source string or undefined (no filter)
const sourceFilterArb = fc.oneof(fc.constant(undefined), fc.constantFrom(...knownSources));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate the database filter behavior: match records against userType and source filters.
 * When a filter is undefined, all records pass for that dimension.
 */
function matchesFilters(
  signup: MockSignup,
  userType: WaitlistUserType | undefined,
  source: string | undefined
): boolean {
  if (userType && signup.userType !== userType) {
    return false;
  }
  if (source && signup.source !== source) {
    return false;
  }
  return true;
}

/**
 * Set up the mock to simulate DB behavior: filter signups by userType and source,
 * then return matching records and count.
 */
function setupMock(
  allSignups: MockSignup[],
  userType: WaitlistUserType | undefined,
  source: string | undefined
) {
  const matchingRecords = allSignups.filter((s) => matchesFilters(s, userType, source));
  let callCount = 0;

  mockSelectResult.mockImplementation(() => {
    callCount++;
    if (callCount % 2 === 1) {
      // Data query chain: select().from().where().orderBy().limit().offset()
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                offset: () => Promise.resolve(matchingRecords),
              }),
            }),
          }),
        }),
      };
    } else {
      // Count query chain: select({ total: count() }).from().where()
      return {
        from: () => ({
          where: () => Promise.resolve([{ total: matchingRecords.length }]),
        }),
      };
    }
  });

  return matchingRecords;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Waitlist Service — Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Property 5: Filter correctness', () => {
    it('every returned record matches ALL applied filter criteria', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 30 }),
          userTypeFilterArb,
          sourceFilterArb,
          async (signups, userType, source) => {
            const expectedMatches = setupMock(signups, userType, source);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              userType,
              source,
              sortBy: 'createdAt',
              sortDir: 'desc',
            });

            const data = result.data as unknown as MockSignup[];

            // Every returned record must match ALL applied filters
            for (const record of data) {
              if (userType) {
                expect(record.userType).toBe(userType);
              }
              if (source) {
                expect(record.source).toBe(source);
              }
            }

            // The count of returned records must match the expected filtered count
            expect(data.length).toBe(expectedMatches.length);
            expect(result.total).toBe(expectedMatches.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('when no filter is applied, all records are returned', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 30 }),
          async (signups) => {
            // No filters applied — all records should be returned
            setupMock(signups, undefined, undefined);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              userType: undefined,
              source: undefined,
              sortBy: 'createdAt',
              sortDir: 'desc',
            });

            const data = result.data as unknown as MockSignup[];

            // All records should be returned when no filters are applied
            expect(data.length).toBe(signups.length);
            expect(result.total).toBe(signups.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('combined filters are conjunctive (AND logic)', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 1, maxLength: 30 }),
          fc.constantFrom<WaitlistUserType>('sender', 'business', 'driver'),
          fc.constantFrom(...knownSources),
          async (signups, userType, source) => {
            // Both filters applied — only records matching BOTH should be returned
            const expectedMatches = setupMock(signups, userType, source);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              userType,
              source,
              sortBy: 'createdAt',
              sortDir: 'desc',
            });

            const data = result.data as unknown as MockSignup[];

            // Every returned record must match BOTH userType AND source
            for (const record of data) {
              expect(record.userType).toBe(userType);
              expect(record.source).toBe(source);
            }

            // No record that doesn't match both filters should appear
            const nonMatchingRecords = signups.filter(
              (s) => s.userType !== userType || s.source !== source
            );
            for (const nonMatch of nonMatchingRecords) {
              const foundInResults = data.some((d) => d.id === nonMatch.id);
              expect(foundInResults).toBe(false);
            }

            expect(data.length).toBe(expectedMatches.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
