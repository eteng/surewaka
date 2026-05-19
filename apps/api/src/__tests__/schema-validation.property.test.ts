// Feature: rbac-system
// Property 13: Schema Validation Rejects Invalid Input — invalid inputs rejected before DB writes
// **Validates: Requirements 4.5, 4.6, 5.5**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { USER_ROLES } from '@surewaka/shared';
import {
  assignRoleSchema,
  revokeRoleSchema,
  onboardCarrierDriverSchema,
} from '@surewaka/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arbitrary for valid UUIDs */
const uuidArb = fc.uuid();

/** Arbitrary for strings that are NOT valid UUIDs */
const invalidUuidArb = fc.oneof(
  fc.constant(''),
  fc.constant('not-a-uuid'),
  fc.constant('12345'),
  fc.constant('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'),
  fc.stringMatching(/^[a-z]{5,15}$/),
  fc.constant('123e4567-e89b-12d3-a456'), // truncated UUID
);

/** Arbitrary for invalid role values (strings not in USER_ROLES) */
const invalidRoleArb = fc.oneof(
  fc.constant('admin'),
  fc.constant('superuser'),
  fc.constant('moderator'),
  fc.constant(''),
  fc.constant('CUSTOMER'),
  fc.constant('Driver'),
  fc.stringMatching(/^[a-z]{6,20}$/).filter(
    (s) => !(USER_ROLES as readonly string[]).includes(s)
  ),
);

/** Arbitrary for valid roles */
const validRoleArb = fc.constantFrom(...USER_ROLES);

/** Arbitrary for org-scoped roles */
const orgScopedRoleArb = fc.constantFrom('carrier_admin' as const, 'carrier_driver' as const);

/** Arbitrary for global roles (not org-scoped) */
const globalRoleArb = fc.constantFrom(
  'customer' as const,
  'driver' as const,
  'support_agent' as const,
  'surewaka_admin' as const
);

/** Arbitrary for valid Nigerian phone numbers */
const validNigerianPhoneArb = fc
  .tuple(
    fc.constantFrom('7', '8', '9'),
    fc.stringMatching(/^\d{9}$/)
  )
  .map(([first, rest]) => `+234${first}${rest}`);

/** Arbitrary for invalid phone numbers (not matching +234XXXXXXXXXX) */
const invalidPhoneArb = fc.oneof(
  fc.constant(''),
  fc.constant('+1234567890'),
  fc.constant('08012345678'), // local format without +234
  fc.constant('+234123'), // too short
  fc.constant('+2341234567890123'), // too long
  fc.constant('+23412345678a'), // contains letter
  fc.constant('234' + '1234567890'), // missing +
  fc.constant('+235' + '1234567890'), // wrong country code
);

/** Arbitrary for valid full names (2-100 chars) */
const validNameArb = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z]{2,20}$/),
    fc.stringMatching(/^[A-Za-z]{2,20}$/)
  )
  .map(([first, last]) => `${first} ${last}`);

/** Arbitrary for names that are too short (< 2 chars) */
const tooShortNameArb = fc.constantFrom('', 'A', 'B', 'x');

/** Arbitrary for names that are too long (> 100 chars) */
const tooLongNameArb = fc.stringMatching(/^[A-Za-z]{101,120}$/);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 13: Schema Validation Rejects Invalid Input — invalid inputs rejected before DB writes', () => {
  describe('assignRoleSchema', () => {
    it('rejects invalid role values (not in USER_ROLES)', () => {
      fc.assert(
        fc.property(
          uuidArb,
          invalidRoleArb,
          (userId, invalidRole) => {
            const result = assignRoleSchema.safeParse({
              userId,
              role: invalidRole,
              scopeType: null,
              scopeId: null,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects org-scoped roles (carrier_admin, carrier_driver) without scopeType and scopeId', () => {
      fc.assert(
        fc.property(
          uuidArb,
          orgScopedRoleArb,
          fc.constantFrom(
            { scopeType: null, scopeId: null },
            { scopeType: null, scopeId: crypto.randomUUID() },
            { scopeType: undefined, scopeId: undefined },
          ),
          (userId, role, scopeFields) => {
            const result = assignRoleSchema.safeParse({
              userId,
              role,
              ...scopeFields,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects invalid UUIDs for userId', () => {
      fc.assert(
        fc.property(
          invalidUuidArb,
          globalRoleArb,
          (invalidUserId, role) => {
            const result = assignRoleSchema.safeParse({
              userId: invalidUserId,
              role,
              scopeType: null,
              scopeId: null,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects invalid UUIDs for scopeId when provided', () => {
      fc.assert(
        fc.property(
          uuidArb,
          orgScopedRoleArb,
          invalidUuidArb.filter((s) => s !== ''), // non-empty invalid UUIDs
          (userId, role, invalidScopeId) => {
            const result = assignRoleSchema.safeParse({
              userId,
              role,
              scopeType: 'carrier',
              scopeId: invalidScopeId,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('accepts valid inputs for global roles', () => {
      fc.assert(
        fc.property(
          uuidArb,
          globalRoleArb,
          (userId, role) => {
            const result = assignRoleSchema.safeParse({
              userId,
              role,
              scopeType: null,
              scopeId: null,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('accepts valid inputs for org-scoped roles with scopeType and scopeId', () => {
      fc.assert(
        fc.property(
          uuidArb,
          uuidArb,
          orgScopedRoleArb,
          (userId, scopeId, role) => {
            const result = assignRoleSchema.safeParse({
              userId,
              role,
              scopeType: 'carrier',
              scopeId,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('revokeRoleSchema', () => {
    it('rejects missing reason field', () => {
      fc.assert(
        fc.property(
          uuidArb,
          validRoleArb,
          (userId, role) => {
            const result = revokeRoleSchema.safeParse({
              userId,
              role,
              // reason is missing
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects reason shorter than 3 chars', () => {
      fc.assert(
        fc.property(
          uuidArb,
          validRoleArb,
          fc.constantFrom('', 'a', 'ab'),
          (userId, role, shortReason) => {
            const result = revokeRoleSchema.safeParse({
              userId,
              role,
              reason: shortReason,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects invalid role values', () => {
      fc.assert(
        fc.property(
          uuidArb,
          invalidRoleArb,
          fc.string({ minLength: 3, maxLength: 100 }),
          (userId, invalidRole, reason) => {
            const result = revokeRoleSchema.safeParse({
              userId,
              role: invalidRole,
              reason,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects invalid UUIDs for userId', () => {
      fc.assert(
        fc.property(
          invalidUuidArb,
          validRoleArb,
          fc.string({ minLength: 3, maxLength: 100 }),
          (invalidUserId, role, reason) => {
            const result = revokeRoleSchema.safeParse({
              userId: invalidUserId,
              role,
              reason,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('accepts valid revocation inputs', () => {
      fc.assert(
        fc.property(
          uuidArb,
          validRoleArb,
          fc.string({ minLength: 3, maxLength: 500 }),
          (userId, role, reason) => {
            const result = revokeRoleSchema.safeParse({
              userId,
              role,
              reason,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('onboardCarrierDriverSchema', () => {
    it('rejects invalid phone numbers (not matching +234XXXXXXXXXX pattern)', () => {
      fc.assert(
        fc.property(
          invalidPhoneArb,
          validNameArb,
          (invalidPhone, fullName) => {
            const result = onboardCarrierDriverSchema.safeParse({
              phone: invalidPhone,
              fullName,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects names shorter than 2 chars', () => {
      fc.assert(
        fc.property(
          validNigerianPhoneArb,
          tooShortNameArb,
          (phone, shortName) => {
            const result = onboardCarrierDriverSchema.safeParse({
              phone,
              fullName: shortName,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects names longer than 100 chars', () => {
      fc.assert(
        fc.property(
          validNigerianPhoneArb,
          tooLongNameArb,
          (phone, longName) => {
            const result = onboardCarrierDriverSchema.safeParse({
              phone,
              fullName: longName,
            });

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects empty strings for phone and name', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            { phone: '', fullName: 'Valid Name' },
            { phone: '+2341234567890', fullName: '' },
            { phone: '', fullName: '' },
          ),
          (input) => {
            const result = onboardCarrierDriverSchema.safeParse(input);

            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 50 },
      );
    });

    it('accepts valid Nigerian phone numbers and names', () => {
      fc.assert(
        fc.property(
          validNigerianPhoneArb,
          validNameArb,
          (phone, fullName) => {
            const result = onboardCarrierDriverSchema.safeParse({
              phone,
              fullName,
            });

            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 },
      );
    });
  });
});
