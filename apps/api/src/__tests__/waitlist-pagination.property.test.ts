// Feature: waitlist-admin, Property 2: Pagination metadata consistency
// Validates: Requirements 1.2, 9.6, 9.10
//
// For any total record count, page number, and page size, the pagination metadata
// SHALL satisfy: totalPages = ceil(total / pageSize), page <= totalPages (or page=1
// when total=0), and the number of returned records SHALL equal
// min(pageSize, max(0, total - (page - 1) * pageSize)).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Pagination Logic Under Test ─────────────────────────────────────────────

/**
 * Compute pagination metadata given total records, current page, and page size.
 * This is the logic that the API route handler (task 5.1) will use.
 */
function computePaginationMeta(total: number, page: number, pageSize: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const recordCount = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));

  return { total, page, pageSize, totalPages, recordCount };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Generate valid pagination tuples: total >= 0, pageSize in [1, 100], page in [1, totalPages]
const paginationTupleArb = fc
  .record({
    total: fc.integer({ min: 0, max: 10000 }),
    pageSize: fc.integer({ min: 1, max: 100 }),
  })
  .chain(({ total, pageSize }) => {
    const maxPage = total === 0 ? 1 : Math.ceil(total / pageSize);
    return fc.record({
      total: fc.constant(total),
      pageSize: fc.constant(pageSize),
      page: fc.integer({ min: 1, max: maxPage }),
    });
  });

// Generate tuples where page may exceed totalPages (for boundary testing)
const anyPaginationTupleArb = fc.record({
  total: fc.integer({ min: 0, max: 10000 }),
  pageSize: fc.integer({ min: 1, max: 100 }),
  page: fc.integer({ min: 1, max: 200 }),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Waitlist Pagination — Property Tests', () => {
  describe('Property 2: Pagination metadata consistency', () => {
    it('totalPages equals ceil(total / pageSize) when total > 0, and 0 when total = 0', () => {
      fc.assert(
        fc.property(paginationTupleArb, ({ total, page, pageSize }) => {
          const meta = computePaginationMeta(total, page, pageSize);

          if (total === 0) {
            expect(meta.totalPages).toBe(0);
          } else {
            expect(meta.totalPages).toBe(Math.ceil(total / pageSize));
          }
        }),
        { numRuns: 100 }
      );
    });

    it('record count for a valid page equals min(pageSize, total - (page-1) * pageSize)', () => {
      fc.assert(
        fc.property(paginationTupleArb, ({ total, page, pageSize }) => {
          const meta = computePaginationMeta(total, page, pageSize);
          const expected = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));

          expect(meta.recordCount).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });

    it('record count is always between 0 and pageSize inclusive', () => {
      fc.assert(
        fc.property(anyPaginationTupleArb, ({ total, page, pageSize }) => {
          const meta = computePaginationMeta(total, page, pageSize);

          expect(meta.recordCount).toBeGreaterThanOrEqual(0);
          expect(meta.recordCount).toBeLessThanOrEqual(pageSize);
        }),
        { numRuns: 100 }
      );
    });

    it('sum of record counts across all pages equals total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 500 }),
          fc.integer({ min: 1, max: 100 }),
          (total, pageSize) => {
            const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
            let sum = 0;

            for (let p = 1; p <= totalPages; p++) {
              const meta = computePaginationMeta(total, p, pageSize);
              sum += meta.recordCount;
            }

            expect(sum).toBe(total);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('last page record count equals total mod pageSize (or pageSize if evenly divisible)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 1, max: 100 }),
          (total, pageSize) => {
            const totalPages = Math.ceil(total / pageSize);
            const meta = computePaginationMeta(total, totalPages, pageSize);
            const remainder = total % pageSize;

            if (remainder === 0) {
              expect(meta.recordCount).toBe(pageSize);
            } else {
              expect(meta.recordCount).toBe(remainder);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('page beyond totalPages yields 0 records', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 1, max: 100 }),
          (total, pageSize) => {
            const totalPages = Math.ceil(total / pageSize);
            const beyondPage = totalPages + 1;
            const meta = computePaginationMeta(total, beyondPage, pageSize);

            expect(meta.recordCount).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('when total is 0, page is 1 and totalPages is 0 with 0 records', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (pageSize) => {
          const meta = computePaginationMeta(0, 1, pageSize);

          expect(meta.totalPages).toBe(0);
          expect(meta.recordCount).toBe(0);
          expect(meta.page).toBe(1);
        }),
        { numRuns: 100 }
      );
    });
  });
});
