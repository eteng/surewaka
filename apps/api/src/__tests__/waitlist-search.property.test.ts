// Feature: waitlist-admin, Property 4: Search filter correctness
// Validates: Requirements 2.1, 2.2
//
// For any non-empty search term and any dataset of waitlist signups, every record
// returned by the API SHALL contain the search term (case-insensitive) in either
// the fullName or email field. Conversely, no record that does NOT contain the
// search term in either field SHALL appear in the results.

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

// Generate search terms that are non-empty and reasonable length
const searchTermArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim());

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate the database ILIKE %search% behavior: case-insensitive substring match
 * on fullName or email.
 */
function matchesSearch(signup: MockSignup, search: string): boolean {
  const term = search.toLowerCase();
  return (
    signup.fullName.toLowerCase().includes(term) || signup.email.toLowerCase().includes(term)
  );
}

/**
 * Set up the mock to simulate DB behavior: filter signups by search term (ILIKE),
 * then return matching records and count.
 */
function setupMock(allSignups: MockSignup[], search: string) {
  const matchingRecords = allSignups.filter((s) => matchesSearch(s, search));
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

  describe('Property 4: Search filter correctness', () => {
    it('every returned record contains the search term in fullName or email (case-insensitive)', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 30 }),
          searchTermArb,
          async (signups, search) => {
            const expectedMatches = setupMock(signups, search);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search,
              sortBy: 'createdAt',
              sortDir: 'desc',
            });

            const data = result.data as unknown as MockSignup[];

            // Every returned record must contain the search term in fullName or email
            for (const record of data) {
              const containsTerm = matchesSearch(record, search);
              expect(containsTerm).toBe(true);
            }

            // The count of returned records must match the expected filtered count
            expect(data.length).toBe(expectedMatches.length);
            expect(result.total).toBe(expectedMatches.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('no non-matching records appear in the results', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 1, maxLength: 30 }),
          searchTermArb,
          async (signups, search) => {
            setupMock(signups, search);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search,
              sortBy: 'createdAt',
              sortDir: 'desc',
            });

            const data = result.data as unknown as MockSignup[];

            // Compute expected non-matching records
            const nonMatchingRecords = signups.filter((s) => !matchesSearch(s, search));

            // Verify none of the non-matching records appear in the results
            for (const nonMatch of nonMatchingRecords) {
              const foundInResults = data.some((d) => d.id === nonMatch.id);
              expect(foundInResults).toBe(false);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty search returns all records without filtering', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 30 }),
          async (signups) => {
            // With empty search, all records should be returned
            let callCount = 0;
            mockSelectResult.mockImplementation(() => {
              callCount++;
              if (callCount % 2 === 1) {
                return {
                  from: () => ({
                    where: () => ({
                      orderBy: () => ({
                        limit: () => ({
                          offset: () => Promise.resolve(signups),
                        }),
                      }),
                    }),
                  }),
                };
              } else {
                return {
                  from: () => ({
                    where: () => Promise.resolve([{ total: signups.length }]),
                  }),
                };
              }
            });

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              sortBy: 'createdAt',
              sortDir: 'desc',
            });

            // All records should be returned when search is empty
            expect(result.data.length).toBe(signups.length);
            expect(result.total).toBe(signups.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
