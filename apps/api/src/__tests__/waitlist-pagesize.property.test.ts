// Feature: waitlist-admin, Property 3: Page size bounds enforcement
// Validates: Requirements 1.3
//
// For any pageSize value greater than 100, the API SHALL reject it (Zod validation error).
// For any pageSize value less than 1, the API SHALL reject it (Zod validation error).
// For any missing/undefined pageSize, the API SHALL default to 20.
// For any valid pageSize (1–100), the value is accepted as-is.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { waitlistQuerySchema } from '@surewaka/shared';

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Waitlist Page Size — Property Tests', () => {
  describe('Property 3: Page size bounds enforcement', () => {
    it('valid page sizes (1–100) are accepted as-is', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (pageSize) => {
          const result = waitlistQuerySchema.safeParse({ pageSize });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.pageSize).toBe(pageSize);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('page sizes greater than 100 are rejected by validation', () => {
      fc.assert(
        fc.property(fc.integer({ min: 101, max: 100000 }), (pageSize) => {
          const result = waitlistQuerySchema.safeParse({ pageSize });

          expect(result.success).toBe(false);
          if (!result.success) {
            const pageSizeErrors = result.error.issues.filter(
              (issue) => issue.path.includes('pageSize')
            );
            expect(pageSizeErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('page sizes less than 1 are rejected by validation', () => {
      fc.assert(
        fc.property(fc.integer({ min: -10000, max: 0 }), (pageSize) => {
          const result = waitlistQuerySchema.safeParse({ pageSize });

          expect(result.success).toBe(false);
          if (!result.success) {
            const pageSizeErrors = result.error.issues.filter(
              (issue) => issue.path.includes('pageSize')
            );
            expect(pageSizeErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('missing/undefined pageSize defaults to 20', () => {
      fc.assert(
        fc.property(fc.constant(undefined), () => {
          const result = waitlistQuerySchema.safeParse({});

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.pageSize).toBe(20);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('string-coerced valid page sizes are accepted', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (pageSize) => {
          // Simulate query param strings (z.coerce.number() handles this)
          const result = waitlistQuerySchema.safeParse({ pageSize: String(pageSize) });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.pageSize).toBe(pageSize);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('non-integer page sizes are rejected by validation', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1.01, max: 99.99, noNaN: true, noDefaultInfinity: true }),
          (pageSize) => {
            // Only test values that are truly non-integer
            if (Number.isInteger(pageSize)) return;

            const result = waitlistQuerySchema.safeParse({ pageSize });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
