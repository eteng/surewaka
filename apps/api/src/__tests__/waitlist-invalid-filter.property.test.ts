// Feature: waitlist-admin, Property 6: Invalid filter rejection
// Validates: Requirements 3.3
//
// For any string value that is NOT one of 'sender', 'business', or 'driver',
// when provided as the userType query parameter, the schema SHALL reject it
// with a validation error (success: false).
// Valid enum values ('sender', 'business', 'driver') SHALL be accepted.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { waitlistQuerySchema } from '@surewaka/shared';

const VALID_USER_TYPES = ['sender', 'business', 'driver'] as const;

describe('Waitlist Invalid Filter — Property Tests', () => {
  describe('Property 6: Invalid filter rejection', () => {
    it('random non-enum strings for userType are rejected with validation error', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter(
            (s) => !VALID_USER_TYPES.includes(s as (typeof VALID_USER_TYPES)[number]),
          ),
          (invalidUserType) => {
            const result = waitlistQuerySchema.safeParse({ userType: invalidUserType });

            expect(result.success).toBe(false);
            if (!result.success) {
              const userTypeErrors = result.error.issues.filter((issue) =>
                issue.path.includes('userType'),
              );
              expect(userTypeErrors.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid enum values (sender, business, driver) are accepted', () => {
      fc.assert(
        fc.property(fc.constantFrom(...VALID_USER_TYPES), (validUserType) => {
          const result = waitlistQuerySchema.safeParse({ userType: validUserType });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.userType).toBe(validUserType);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('undefined/omitted userType is accepted (field is optional)', () => {
      fc.assert(
        fc.property(fc.constant(undefined), () => {
          const result = waitlistQuerySchema.safeParse({});

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.userType).toBeUndefined();
          }
        }),
        { numRuns: 100 },
      );
    });

    it('empty string for userType is rejected', () => {
      const result = waitlistQuerySchema.safeParse({ userType: '' });

      expect(result.success).toBe(false);
      if (!result.success) {
        const userTypeErrors = result.error.issues.filter((issue) =>
          issue.path.includes('userType'),
        );
        expect(userTypeErrors.length).toBeGreaterThan(0);
      }
    });
  });
});
