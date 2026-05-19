// Feature: admin-user-management
// Property 6: Pagination respects page size bounds
//
// For any page and pageSize parameters (1 ≤ pageSize ≤ 100), the schema SHALL accept;
// values outside bounds SHALL be rejected; default pageSize SHALL be 20.
//
// **Validates: Requirements 2.4, 6.4**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { employeeListQuerySchema, auditLogQuerySchema } from '../validators';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Valid page number (≥ 1) */
const validPageArb = fc.integer({ min: 1, max: 10000 });

/** Valid pageSize (1-100) */
const validPageSizeArb = fc.integer({ min: 1, max: 100 });

/** Invalid pageSize below minimum (< 1) */
const pageSizeTooSmallArb = fc.integer({ min: -1000, max: 0 });

/** Invalid pageSize above maximum (> 100) */
const pageSizeTooLargeArb = fc.integer({ min: 101, max: 10000 });

/** Invalid page number (< 1) */
const invalidPageArb = fc.integer({ min: -1000, max: 0 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Pagination Validator — Property Tests', () => {
  describe('Property 6: Pagination respects page size bounds', () => {
    // **Validates: Requirements 2.4, 6.4**

    describe('employeeListQuerySchema', () => {
      it('accepts valid page (≥1) and pageSize (1-100)', () => {
        fc.assert(
          fc.property(validPageArb, validPageSizeArb, (page, pageSize) => {
            const result = employeeListQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.page).toBe(page);
              expect(result.data.pageSize).toBe(pageSize);
            }
          }),
          { numRuns: 100 },
        );
      });

      it('rejects pageSize < 1', () => {
        fc.assert(
          fc.property(validPageArb, pageSizeTooSmallArb, (page, pageSize) => {
            const result = employeeListQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(false);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects pageSize > 100', () => {
        fc.assert(
          fc.property(validPageArb, pageSizeTooLargeArb, (page, pageSize) => {
            const result = employeeListQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(false);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects page < 1', () => {
        fc.assert(
          fc.property(invalidPageArb, validPageSizeArb, (page, pageSize) => {
            const result = employeeListQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(false);
          }),
          { numRuns: 100 },
        );
      });

      it('defaults pageSize to 20 when not specified', () => {
        fc.assert(
          fc.property(validPageArb, (page) => {
            const result = employeeListQuerySchema.safeParse({ page });
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.pageSize).toBe(20);
            }
          }),
          { numRuns: 100 },
        );
      });

      it('defaults page to 1 when not specified', () => {
        fc.assert(
          fc.property(validPageSizeArb, (pageSize) => {
            const result = employeeListQuerySchema.safeParse({ pageSize });
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.page).toBe(1);
            }
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('auditLogQuerySchema', () => {
      it('accepts valid page (≥1) and pageSize (1-100)', () => {
        fc.assert(
          fc.property(validPageArb, validPageSizeArb, (page, pageSize) => {
            const result = auditLogQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.page).toBe(page);
              expect(result.data.pageSize).toBe(pageSize);
            }
          }),
          { numRuns: 100 },
        );
      });

      it('rejects pageSize < 1', () => {
        fc.assert(
          fc.property(validPageArb, pageSizeTooSmallArb, (page, pageSize) => {
            const result = auditLogQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(false);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects pageSize > 100', () => {
        fc.assert(
          fc.property(validPageArb, pageSizeTooLargeArb, (page, pageSize) => {
            const result = auditLogQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(false);
          }),
          { numRuns: 100 },
        );
      });

      it('rejects page < 1', () => {
        fc.assert(
          fc.property(invalidPageArb, validPageSizeArb, (page, pageSize) => {
            const result = auditLogQuerySchema.safeParse({ page, pageSize });
            expect(result.success).toBe(false);
          }),
          { numRuns: 100 },
        );
      });

      it('defaults pageSize to 20 when not specified', () => {
        fc.assert(
          fc.property(validPageArb, (page) => {
            const result = auditLogQuerySchema.safeParse({ page });
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.pageSize).toBe(20);
            }
          }),
          { numRuns: 100 },
        );
      });

      it('defaults page to 1 when not specified', () => {
        fc.assert(
          fc.property(validPageSizeArb, (pageSize) => {
            const result = auditLogQuerySchema.safeParse({ pageSize });
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.page).toBe(1);
            }
          }),
          { numRuns: 100 },
        );
      });
    });

    describe('Both schemas respect the same bounds', () => {
      it('both schemas accept the same valid page/pageSize combinations', () => {
        fc.assert(
          fc.property(validPageArb, validPageSizeArb, (page, pageSize) => {
            const employeeResult = employeeListQuerySchema.safeParse({ page, pageSize });
            const auditResult = auditLogQuerySchema.safeParse({ page, pageSize });
            expect(employeeResult.success).toBe(true);
            expect(auditResult.success).toBe(true);
            if (employeeResult.success && auditResult.success) {
              expect(employeeResult.data.page).toBe(auditResult.data.page);
              expect(employeeResult.data.pageSize).toBe(auditResult.data.pageSize);
            }
          }),
          { numRuns: 100 },
        );
      });

      it('both schemas reject the same invalid pageSize values', () => {
        fc.assert(
          fc.property(
            validPageArb,
            fc.oneof(pageSizeTooSmallArb, pageSizeTooLargeArb),
            (page, pageSize) => {
              const employeeResult = employeeListQuerySchema.safeParse({ page, pageSize });
              const auditResult = auditLogQuerySchema.safeParse({ page, pageSize });
              expect(employeeResult.success).toBe(false);
              expect(auditResult.success).toBe(false);
            },
          ),
          { numRuns: 100 },
        );
      });
    });
  });
});
