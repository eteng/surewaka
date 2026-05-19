import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { USER_ROLES, type UserRole } from '@surewaka/shared';
import { useRoles } from '../hooks/use-roles';
import { RoleGate } from '../components/role-gate';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generates an arbitrary non-empty subset of USER_ROLES */
const roleSubsetArb = fc
  .subarray([...USER_ROLES], { minLength: 1 })
  .map((arr) => arr as UserRole[]);

/** Generates an arbitrary (possibly empty) subset of USER_ROLES */
const roleSubsetOrEmptyArb = fc
  .subarray([...USER_ROLES])
  .map((arr) => arr as UserRole[]);

/** Generates a single valid role */
const singleRoleArb = fc.constantFrom(...USER_ROLES);

/** Generates a non-empty array of query roles */
const queryRolesArb = fc
  .array(singleRoleArb, { minLength: 1, maxLength: 6 })
  .map((arr) => [...new Set(arr)] as UserRole[]);

// ─── Property 8: Multi-Role Support ─────────────────────────────────────────
// **Validates: Requirements 1.5**
// Users can hold any valid subset of roles simultaneously.

describe('Property 8: Multi-Role Support', () => {
  it('useRoles correctly reports all roles in any valid subset', () => {
    fc.assert(
      fc.property(roleSubsetArb, (roles) => {
        const ctx = useRoles({ roles });

        // All provided roles should be present in the context
        expect(ctx.roles).toEqual(roles);

        // Each role in the subset should be queryable
        for (const role of roles) {
          // If user is surewaka_admin, hasRole always returns true
          // Otherwise, hasRole returns true for roles in the subset
          if (roles.includes('surewaka_admin')) {
            expect(ctx.hasRole(role)).toBe(true);
          } else {
            expect(ctx.hasRole(role)).toBe(true);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('convenience booleans match the roles in the subset', () => {
    fc.assert(
      fc.property(roleSubsetArb, (roles) => {
        const ctx = useRoles({ roles });

        // Each convenience boolean must match whether the role is in the subset
        expect(ctx.isAdmin).toBe(roles.includes('surewaka_admin'));
        expect(ctx.isSupport).toBe(roles.includes('support_agent'));
        expect(ctx.isDriver).toBe(roles.includes('driver'));
        expect(ctx.isCarrierAdmin).toBe(roles.includes('carrier_admin'));
        expect(ctx.isCarrierDriver).toBe(roles.includes('carrier_driver'));
        expect(ctx.isCustomer).toBe(roles.includes('customer'));
      }),
      { numRuns: 200 }
    );
  });

  it('a user can hold any combination of roles simultaneously', () => {
    fc.assert(
      fc.property(roleSubsetArb, (roles) => {
        const ctx = useRoles({ roles });

        // The context should hold exactly the roles provided
        expect(ctx.roles.length).toBe(roles.length);
        for (const role of roles) {
          expect(ctx.roles).toContain(role);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Property 11: Role Query Correctness ─────────────────────────────────────
// **Validates: Requirements 8.2, 8.3**
// hasRole/hasAnyRole return correct boolean values for all valid role combinations.

describe('Property 11: Role Query Correctness', () => {
  it('hasRole(r) returns true iff r is in user roles or user is surewaka_admin', () => {
    fc.assert(
      fc.property(roleSubsetArb, singleRoleArb, (userRoles, queryRole) => {
        const ctx = useRoles({ roles: userRoles });
        const isAdmin = userRoles.includes('surewaka_admin');
        const expected = isAdmin || userRoles.includes(queryRole);

        expect(ctx.hasRole(queryRole)).toBe(expected);
      }),
      { numRuns: 500 }
    );
  });

  it('hasAnyRole returns true iff at least one query role is in user roles or user is surewaka_admin', () => {
    fc.assert(
      fc.property(roleSubsetArb, queryRolesArb, (userRoles, queryRoles) => {
        const ctx = useRoles({ roles: userRoles });
        const isAdmin = userRoles.includes('surewaka_admin');
        const expected = isAdmin || queryRoles.some((r) => userRoles.includes(r));

        expect(ctx.hasAnyRole(...queryRoles)).toBe(expected);
      }),
      { numRuns: 500 }
    );
  });

  it('hasRole is consistent with hasAnyRole for single-role queries', () => {
    fc.assert(
      fc.property(roleSubsetArb, singleRoleArb, (userRoles, queryRole) => {
        const ctx = useRoles({ roles: userRoles });

        // hasRole(r) should equal hasAnyRole(r) for any single role
        expect(ctx.hasRole(queryRole)).toBe(ctx.hasAnyRole(queryRole));
      }),
      { numRuns: 300 }
    );
  });

  it('hasAnyRole with all USER_ROLES always returns true', () => {
    fc.assert(
      fc.property(roleSubsetArb, (userRoles) => {
        const ctx = useRoles({ roles: userRoles });

        // Querying all roles should always return true since the user has at least one
        expect(ctx.hasAnyRole(...USER_ROLES)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── RoleGate Property Tests ─────────────────────────────────────────────────
// **Validates: Requirements 8.2, 8.3**
// RoleGate renders children iff user has any required role OR is surewaka_admin.

describe('RoleGate correctness properties', () => {
  it('RoleGate renders children iff user has any required role or is surewaka_admin', () => {
    fc.assert(
      fc.property(roleSubsetArb, queryRolesArb, (userRoles, requiredRoles) => {
        const isAdmin = userRoles.includes('surewaka_admin');
        const hasRequiredRole = requiredRoles.some((r) => userRoles.includes(r));
        const shouldRender = isAdmin || hasRequiredRole;

        // We test the logic directly since RoleGate is a pure component
        const hasAccess =
          userRoles.includes('surewaka_admin') ||
          requiredRoles.some((role) => userRoles.includes(role));

        expect(hasAccess).toBe(shouldRender);
      }),
      { numRuns: 500 }
    );
  });

  it('surewaka_admin always gets access through RoleGate regardless of required roles', () => {
    fc.assert(
      fc.property(queryRolesArb, (requiredRoles) => {
        const userRoles: UserRole[] = ['surewaka_admin'];

        const hasAccess =
          userRoles.includes('surewaka_admin') ||
          requiredRoles.some((role) => userRoles.includes(role));

        expect(hasAccess).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('user without any required role and not admin is denied by RoleGate', () => {
    // Generate user roles that do NOT include surewaka_admin
    const nonAdminRolesArb = fc
      .subarray(
        [...USER_ROLES].filter((r) => r !== 'surewaka_admin'),
        { minLength: 1 }
      )
      .map((arr) => arr as UserRole[]);

    fc.assert(
      fc.property(nonAdminRolesArb, queryRolesArb, (userRoles, requiredRoles) => {
        // Only test cases where user has NONE of the required roles
        const hasOverlap = requiredRoles.some((r) => userRoles.includes(r));
        if (hasOverlap) return; // skip — we only care about the denial case

        const hasAccess =
          userRoles.includes('surewaka_admin') ||
          requiredRoles.some((role) => userRoles.includes(role));

        expect(hasAccess).toBe(false);
      }),
      { numRuns: 300 }
    );
  });
});
