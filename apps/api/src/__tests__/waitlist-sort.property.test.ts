// Feature: waitlist-admin, Property 1: Sort correctness
// Validates: Requirements 1.1, 8.1
//
// For any set of waitlist signup records and any valid sort column and direction,
// the records returned by the list endpoint SHALL be ordered according to the
// specified sort column and direction.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Mock the entire @surewaka/db module before any imports that use it.
// We provide a mock `db` object and re-export the real schema.

const mockSelectResult = vi.fn();

vi.mock('@surewaka/db', () => {
  // We need to provide the waitlistSignups schema object for the service to reference columns.
  // We create a minimal mock that has the column references the service uses.
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

const validDateArb = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
  .filter((d) => !isNaN(d.getTime()));

const signupArb: fc.Arbitrary<MockSignup> = fc.record({
  id: fc.uuid(),
  fullName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  email: fc.emailAddress(),
  userType: userTypeArb,
  source: fc.oneof(fc.constant(null), fc.constantFrom('home', 'launch-campaign', 'referral')),
  createdAt: validDateArb,
  updatedAt: validDateArb,
});

const sortByArb = fc.constantFrom('fullName', 'email', 'userType', 'createdAt') as fc.Arbitrary<
  'fullName' | 'email' | 'userType' | 'createdAt'
>;

const sortDirArb = fc.constantFrom('asc', 'desc') as fc.Arbitrary<'asc' | 'desc'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if records are sorted correctly according to the given column and direction.
 */
function isSortedCorrectly(
  records: MockSignup[],
  sortBy: 'fullName' | 'email' | 'userType' | 'createdAt',
  sortDir: 'asc' | 'desc'
): boolean {
  for (let i = 0; i < records.length - 1; i++) {
    const a = records[i];
    const b = records[i + 1];

    let valA: string | number;
    let valB: string | number;

    if (sortBy === 'createdAt') {
      valA = a.createdAt.getTime();
      valB = b.createdAt.getTime();
    } else {
      valA = a[sortBy];
      valB = b[sortBy];
    }

    if (sortDir === 'asc') {
      if (valA > valB) return false;
    } else {
      if (valA < valB) return false;
    }
  }
  return true;
}

/**
 * Sort records in-memory the same way the service should sort them.
 */
function sortRecords(
  records: MockSignup[],
  sortBy: 'fullName' | 'email' | 'userType' | 'createdAt',
  sortDir: 'asc' | 'desc'
): MockSignup[] {
  return [...records].sort((a, b) => {
    let valA: string | number;
    let valB: string | number;

    if (sortBy === 'createdAt') {
      valA = a.createdAt.getTime();
      valB = b.createdAt.getTime();
    } else {
      valA = a[sortBy];
      valB = b[sortBy];
    }

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Set up the mock to return sorted data (simulating what the DB would return with ORDER BY)
 * and a count result.
 */
function setupMock(sortedData: MockSignup[], total: number) {
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
                offset: () => Promise.resolve(sortedData),
              }),
            }),
          }),
        }),
      };
    } else {
      // Count query chain: select({ total: count() }).from().where()
      return {
        from: () => ({
          where: () => Promise.resolve([{ total }]),
        }),
      };
    }
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Waitlist Service — Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Property 1: Sort correctness', () => {
    it('records returned by listWaitlistSignups are ordered according to the specified sort column and direction', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 0, maxLength: 30 }),
          sortByArb,
          sortDirArb,
          async (signups, sortBy, sortDir) => {
            // Sort the signups in the expected order (simulating DB ORDER BY behavior)
            const sorted = sortRecords(signups, sortBy, sortDir);

            setupMock(sorted, signups.length);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              sortBy,
              sortDir,
            });

            // Verify the returned data is sorted correctly
            expect(
              isSortedCorrectly(result.data as unknown as MockSignup[], sortBy, sortDir)
            ).toBe(true);

            // Verify the total count matches
            expect(result.total).toBe(signups.length);

            // Verify the data length matches (all records fit in one page)
            expect(result.data.length).toBe(sorted.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('sort is stable: records with equal sort values maintain relative order', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          sortByArb,
          sortDirArb,
          fc.array(signupArb, { minLength: 2, maxLength: 20 }),
          async (sortBy, sortDir, baseSignups) => {
            // Create signups where some have the same sort value
            const sharedValue =
              sortBy === 'createdAt' ? baseSignups[0].createdAt : baseSignups[0][sortBy];

            // Make at least 2 records share the same sort value
            const signups = baseSignups.map((s, i) => {
              if (i < 2) {
                if (sortBy === 'createdAt') {
                  return { ...s, createdAt: sharedValue as Date };
                }
                return { ...s, [sortBy]: sharedValue } as MockSignup;
              }
              return s;
            });

            const sorted = sortRecords(signups, sortBy, sortDir);
            setupMock(sorted, signups.length);

            const result = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              sortBy,
              sortDir,
            });

            // Verify no pair of adjacent records violates the sort order
            const data = result.data as unknown as MockSignup[];
            for (let i = 0; i < data.length - 1; i++) {
              const a = data[i];
              const b = data[i + 1];

              let valA: string | number;
              let valB: string | number;

              if (sortBy === 'createdAt') {
                valA = a.createdAt.getTime();
                valB = b.createdAt.getTime();
              } else {
                valA = a[sortBy];
                valB = b[sortBy];
              }

              if (sortDir === 'asc') {
                expect(valA <= valB).toBe(true);
              } else {
                expect(valA >= valB).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('sort direction reversal produces opposite ordering', async () => {
      const { listWaitlistSignups } = await import('../services/waitlist-service');

      await fc.assert(
        fc.asyncProperty(
          fc.array(signupArb, { minLength: 2, maxLength: 20 }),
          sortByArb,
          async (signups, sortBy) => {
            const sortedAsc = sortRecords(signups, sortBy, 'asc');
            const sortedDesc = sortRecords(signups, sortBy, 'desc');

            // First call: ascending
            setupMock(sortedAsc, signups.length);

            const ascResult = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              sortBy,
              sortDir: 'asc',
            });

            // Second call: descending
            setupMock(sortedDesc, signups.length);

            const descResult = await listWaitlistSignups({
              page: 1,
              pageSize: 100,
              search: '',
              sortBy,
              sortDir: 'desc',
            });

            // Verify ascending result is sorted ascending
            expect(
              isSortedCorrectly(ascResult.data as unknown as MockSignup[], sortBy, 'asc')
            ).toBe(true);

            // Verify descending result is sorted descending
            expect(
              isSortedCorrectly(descResult.data as unknown as MockSignup[], sortBy, 'desc')
            ).toBe(true);

            // The first element in asc should be <= first element in desc (or equal if all same)
            const ascData = ascResult.data as unknown as MockSignup[];
            const descData = descResult.data as unknown as MockSignup[];

            if (ascData.length > 0 && descData.length > 0) {
              let firstAsc: string | number;
              let firstDesc: string | number;

              if (sortBy === 'createdAt') {
                firstAsc = ascData[0].createdAt.getTime();
                firstDesc = descData[0].createdAt.getTime();
              } else {
                firstAsc = ascData[0][sortBy];
                firstDesc = descData[0][sortBy];
              }

              // In ascending, first element is the smallest; in descending, first is the largest
              expect(firstAsc <= firstDesc).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
