// Feature: admin-user-management
// Property 3: Invitation validation rejects invalid inputs
//
// For any invitation request where email is invalid, fullName is outside 2-100 chars,
// role is not a valid enum value, or an org-scoped role is missing scopeType/scopeId,
// the schema SHALL reject the request.
//
// **Validates: Requirements 1.5, 1.6**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { inviteEmployeeSchema } from '../validators';
import { USER_ROLES } from '../constants';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ROLES = [...USER_ROLES] as string[];
const ORG_SCOPED_ROLES = ['carrier_admin', 'carrier_driver'] as const;
const NON_ORG_SCOPED_ROLES = VALID_ROLES.filter(
  (r) => r !== 'carrier_admin' && r !== 'carrier_driver',
);

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Valid email arbitrary that generates emails Zod's .email() validator accepts.
 * Zod uses stricter validation than RFC 5322 — we generate simple alphanumeric emails.
 */
const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,14}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
    fc.constantFrom('com', 'org', 'net', 'io', 'co', 'dev'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Valid fullName: 2-100 characters (letters and spaces) */
const validFullNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z ]{1,99}$/);

/** Valid non-org-scoped role */
const nonOrgScopedRoleArb = fc.constantFrom(...NON_ORG_SCOPED_ROLES);

/** Valid org-scoped role */
const orgScopedRoleArb = fc.constantFrom(...ORG_SCOPED_ROLES);

/** Valid UUID */
const validUuidArb = fc.uuid();

/** A valid invitation input (non-org-scoped) */
const validNonOrgInvitationArb = fc.record({
  email: validEmailArb,
  fullName: validFullNameArb,
  role: nonOrgScopedRoleArb,
});

/** A valid invitation input (org-scoped) */
const validOrgInvitationArb = fc.record({
  email: validEmailArb,
  fullName: validFullNameArb,
  role: orgScopedRoleArb,
  scopeType: fc.constant('carrier' as const),
  scopeId: validUuidArb,
});

// ─── Invalid Email Arbitraries ────────────────────────────────────────────────

/** Strings missing @ symbol */
const emailMissingAtArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !s.includes('@'));

/** Strings with @ but invalid domain (no valid TLD) */
const emailInvalidDomainArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,10}$/),
    fc.constantFrom('', 'nodot', '.startdot', 'enddot.', '..'),
  )
  .map(([local, domain]) => `${local}@${domain}`);

/** Empty string email */
const emptyEmailArb = fc.constant('');

// ─── Invalid FullName Arbitraries ─────────────────────────────────────────────

/** Name too short (0-1 chars) */
const nameTooShortArb = fc.string({ minLength: 0, maxLength: 1 });

/** Name too long (101+ chars) */
const nameTooLongArb = fc.stringMatching(/^[a-zA-Z]{101,200}$/);

// ─── Invalid Role Arbitraries ─────────────────────────────────────────────────

/** Random string that is not a valid role */
const invalidRoleArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !VALID_ROLES.includes(s));

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Invite Employee Validator — Property Tests', () => {
  describe('Property 3: Invitation validation rejects invalid inputs', () => {
    // **Validates: Requirements 1.5, 1.6**

    it('rejects invalid emails (missing @ symbol)', () => {
      fc.assert(
        fc.property(emailMissingAtArb, validFullNameArb, nonOrgScopedRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
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

    it('rejects invalid emails (missing valid domain)', () => {
      fc.assert(
        fc.property(emailInvalidDomainArb, validFullNameArb, nonOrgScopedRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
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

    it('rejects empty email', () => {
      fc.assert(
        fc.property(emptyEmailArb, validFullNameArb, nonOrgScopedRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
          expect(result.success).toBe(false);
        }),
        { numRuns: 1 },
      );
    });

    it('rejects fullName shorter than 2 characters', () => {
      fc.assert(
        fc.property(validEmailArb, nameTooShortArb, nonOrgScopedRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
          expect(result.success).toBe(false);
          if (!result.success) {
            const nameErrors = result.error.issues.filter((issue) =>
              issue.path.includes('fullName'),
            );
            expect(nameErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('rejects fullName longer than 100 characters', () => {
      fc.assert(
        fc.property(validEmailArb, nameTooLongArb, nonOrgScopedRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
          expect(result.success).toBe(false);
          if (!result.success) {
            const nameErrors = result.error.issues.filter((issue) =>
              issue.path.includes('fullName'),
            );
            expect(nameErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('rejects invalid role values', () => {
      fc.assert(
        fc.property(validEmailArb, validFullNameArb, invalidRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
          expect(result.success).toBe(false);
          if (!result.success) {
            const roleErrors = result.error.issues.filter((issue) =>
              issue.path.includes('role'),
            );
            expect(roleErrors.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('rejects org-scoped roles without scopeType and scopeId', () => {
      fc.assert(
        fc.property(validEmailArb, validFullNameArb, orgScopedRoleArb, (email, fullName, role) => {
          // No scopeType or scopeId provided
          const result = inviteEmployeeSchema.safeParse({ email, fullName, role });
          expect(result.success).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('rejects org-scoped roles with scopeType but missing scopeId', () => {
      fc.assert(
        fc.property(validEmailArb, validFullNameArb, orgScopedRoleArb, (email, fullName, role) => {
          const result = inviteEmployeeSchema.safeParse({
            email,
            fullName,
            role,
            scopeType: 'carrier',
            scopeId: null,
          });
          expect(result.success).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('rejects org-scoped roles with scopeId but missing scopeType', () => {
      fc.assert(
        fc.property(validEmailArb, validFullNameArb, orgScopedRoleArb, validUuidArb, (email, fullName, role, scopeId) => {
          const result = inviteEmployeeSchema.safeParse({
            email,
            fullName,
            role,
            scopeType: null,
            scopeId,
          });
          expect(result.success).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('accepts valid non-org-scoped invitations (positive property)', () => {
      fc.assert(
        fc.property(validNonOrgInvitationArb, (input) => {
          const result = inviteEmployeeSchema.safeParse(input);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('accepts valid org-scoped invitations with correct scopeType and scopeId (positive property)', () => {
      fc.assert(
        fc.property(validOrgInvitationArb, (input) => {
          const result = inviteEmployeeSchema.safeParse(input);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
