// Feature: surewaka-landing-page
// Property 2: Invalid email rejection
// Property 3: Missing required fields produce per-field errors

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { waitlistSignupSchema } from '../validators';

describe('Waitlist Validation Schema — Property Tests', () => {
  // Property 2: Invalid email rejection
  // For any string that does not conform to a valid email format,
  // submitting the waitlist form SHALL be rejected with a validation error
  // specifically indicating the email field is invalid.
  // Validates: Requirements 5.4
  describe('Property 2: Invalid email rejection', () => {
    const validBase = {
      fullName: 'Test User',
      userType: 'sender' as const,
      source: 'home',
    };

    // Arbitrary that generates strings missing the @ symbol
    const emailMissingAt = fc.string({ minLength: 1 }).filter((s) => !s.includes('@'));

    // Arbitrary that generates strings with @ but missing domain (nothing after @, or no dot in domain)
    const emailMissingDomain = fc
      .tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 0, maxLength: 20 }))
      .map(([local, afterAt]) => `${local}@${afterAt}`)
      .filter((s) => {
        const parts = s.split('@');
        const domain = parts[parts.length - 1];
        // No dot in domain part, or domain is empty
        return !domain.includes('.') || domain.endsWith('.') || domain.startsWith('.');
      });

    // Arbitrary that generates emails with consecutive dots
    const emailConsecutiveDots = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.length > 0),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.length > 0),
        fc.string({ minLength: 2, maxLength: 5 }).filter((s) => /^[a-z]+$/.test(s)),
      )
      .map(([local, domain, tld]) => `${local}@${domain}..${tld}`);

    // Arbitrary that generates emails with trailing dot in domain
    const emailTrailingDot = fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{2,4}$/),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}.`);

    it('rejects strings missing @ symbol', () => {
      fc.assert(
        fc.property(emailMissingAt, (invalidEmail) => {
          const result = waitlistSignupSchema.safeParse({
            ...validBase,
            email: invalidEmail,
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            const emailErrors = result.error.issues.filter((issue) =>
              issue.path.includes('email'),
            );
            expect(emailErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('rejects strings with @ but missing valid domain', () => {
      fc.assert(
        fc.property(emailMissingDomain, (invalidEmail) => {
          const result = waitlistSignupSchema.safeParse({
            ...validBase,
            email: invalidEmail,
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            const emailErrors = result.error.issues.filter((issue) =>
              issue.path.includes('email'),
            );
            expect(emailErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('rejects emails with consecutive dots in domain', () => {
      fc.assert(
        fc.property(emailConsecutiveDots, (invalidEmail) => {
          const result = waitlistSignupSchema.safeParse({
            ...validBase,
            email: invalidEmail,
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            const emailErrors = result.error.issues.filter((issue) =>
              issue.path.includes('email'),
            );
            expect(emailErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('rejects emails with trailing dot in domain', () => {
      fc.assert(
        fc.property(emailTrailingDot, (invalidEmail) => {
          const result = waitlistSignupSchema.safeParse({
            ...validBase,
            email: invalidEmail,
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            const emailErrors = result.error.issues.filter((issue) =>
              issue.path.includes('email'),
            );
            expect(emailErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Property 3: Missing required fields produce per-field errors
  // For any subset of required fields (fullName, email, userType) that are omitted,
  // validating the waitlist form SHALL produce an error message for each missing field,
  // and the set of error field names SHALL exactly equal the set of missing field names.
  // Validates: Requirements 5.5
  describe('Property 3: Missing required fields produce per-field errors', () => {
    const requiredFields = ['fullName', 'email', 'userType'] as const;

    const validData = {
      fullName: 'Test User',
      email: 'test@example.com',
      userType: 'sender' as const,
      source: 'home',
    };

    // Generate non-empty subsets of required fields to omit
    const omittedFieldsArb = fc
      .subarray([...requiredFields], { minLength: 1, maxLength: 3 })
      .filter((arr) => arr.length > 0);

    it('produces errors exactly matching omitted required fields', () => {
      fc.assert(
        fc.property(omittedFieldsArb, (fieldsToOmit) => {
          // Build input with specified fields omitted
          const input: Record<string, unknown> = { ...validData };
          for (const field of fieldsToOmit) {
            delete input[field];
          }

          const result = waitlistSignupSchema.safeParse(input);

          // Should fail validation
          expect(result.success).toBe(false);

          if (!result.success) {
            // Collect the field names that have errors
            const errorFieldNames = new Set(
              result.error.issues.map((issue) => issue.path[0] as string),
            );

            // The set of error field names should exactly match the omitted fields
            const omittedSet = new Set(fieldsToOmit);
            expect(errorFieldNames).toEqual(omittedSet);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('produces at least one error per omitted field', () => {
      fc.assert(
        fc.property(omittedFieldsArb, (fieldsToOmit) => {
          const input: Record<string, unknown> = { ...validData };
          for (const field of fieldsToOmit) {
            delete input[field];
          }

          const result = waitlistSignupSchema.safeParse(input);
          expect(result.success).toBe(false);

          if (!result.success) {
            for (const field of fieldsToOmit) {
              const fieldErrors = result.error.issues.filter(
                (issue) => issue.path[0] === field,
              );
              expect(fieldErrors.length).toBeGreaterThanOrEqual(1);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
