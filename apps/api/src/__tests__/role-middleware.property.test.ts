// Feature: rbac-system
// Property 1: Role Hierarchy Bypass — surewaka_admin always passes any role check
// Property 12: Access Denial Without Required Roles — users without required roles get 403
// Validates: Requirements 2.3, 2.4, 8.4, 8.5

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Hono } from 'hono';
import { USER_ROLES, type UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { requireRole } from '../middleware/role';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** All roles except surewaka_admin */
const NON_ADMIN_ROLES = USER_ROLES.filter((r) => r !== 'surewaka_admin');

/** Arbitrary for a non-empty subset of roles (used as required roles for the middleware) */
const requiredRolesArb = fc
  .subarray([...USER_ROLES], { minLength: 1 })
  .map((arr) => arr as UserRole[]);

/** Arbitrary for a non-empty subset of non-admin roles (user's actual roles) */
const nonAdminRolesArb = fc
  .subarray([...NON_ADMIN_ROLES], { minLength: 1 })
  .map((arr) => arr as UserRole[]);

/**
 * Create a mock AuthUser with the given roles in app_metadata.
 */
function createMockUser(roles: UserRole[] | undefined): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test@surewaka.com',
    user_metadata: { name: 'Test User' },
    app_metadata: {
      roles,
      primary_role: roles?.[0],
    },
  };
}

/**
 * Create a Hono app with requireRole middleware and a test route.
 * The `setUser` middleware simulates requireAuth by setting the user on context.
 */
function createTestApp(requiredRoles: UserRole[], user: AuthUser) {
  const app = new Hono();

  // Simulate requireAuth — sets user on context
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });

  // Apply role middleware
  app.use('*', requireRole(...requiredRoles));

  // Test handler
  app.get('/test', (c) => c.json({ data: 'ok', error: null, meta: null }));

  return app;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Role Middleware — Property Tests', () => {
  describe('Property 1: Role Hierarchy Bypass — surewaka_admin always passes any role check', () => {
    it('surewaka_admin is granted access regardless of which roles are required', async () => {
      await fc.assert(
        fc.asyncProperty(requiredRolesArb, async (requiredRoles) => {
          // User has surewaka_admin role
          const user = createMockUser(['surewaka_admin']);
          const app = createTestApp(requiredRoles, user);

          const res = await app.request('/test');

          // surewaka_admin always gets 200, never 403
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.data).toBe('ok');
        }),
        { numRuns: 100 },
      );
    });

    it('surewaka_admin with additional roles still bypasses all checks', async () => {
      await fc.assert(
        fc.asyncProperty(
          requiredRolesArb,
          nonAdminRolesArb,
          async (requiredRoles, additionalRoles) => {
            // User has surewaka_admin plus other roles
            const userRoles: UserRole[] = ['surewaka_admin', ...additionalRoles];
            const user = createMockUser(userRoles);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            expect(res.status).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('surewaka_admin bypasses even when required roles are roles they would not normally have', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray([...NON_ADMIN_ROLES], { minLength: 1 }).map((arr) => arr as UserRole[]),
          async (requiredRoles) => {
            // User ONLY has surewaka_admin — none of the required roles directly
            const user = createMockUser(['surewaka_admin']);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            expect(res.status).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 12: Access Denial Without Required Roles — users without required roles get 403', () => {
    it('users without any of the required roles receive 403 FORBIDDEN', async () => {
      await fc.assert(
        fc.asyncProperty(
          requiredRolesArb,
          nonAdminRolesArb,
          async (requiredRoles, userRoles) => {
            // Precondition: user does NOT hold any of the required roles
            fc.pre(!requiredRoles.some((r) => userRoles.includes(r)));

            const user = createMockUser(userRoles);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.code).toBe('FORBIDDEN');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('users with at least one of the required roles receive 200', async () => {
      await fc.assert(
        fc.asyncProperty(
          requiredRolesArb,
          nonAdminRolesArb,
          async (requiredRoles, extraRoles) => {
            // Ensure user has at least one of the required roles
            const grantedRole = requiredRoles[0];
            // Skip if the granted role is surewaka_admin (tested in Property 1)
            fc.pre(grantedRole !== 'surewaka_admin');

            const userRoles: UserRole[] = [...new Set([grantedRole, ...extraRoles])];
            const user = createMockUser(userRoles);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            expect(res.status).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('users with missing/empty roles default to customer and get 403 for non-customer routes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray([...NON_ADMIN_ROLES.filter((r) => r !== 'customer')], { minLength: 1 }).map(
            (arr) => arr as UserRole[],
          ),
          fc.constantFrom(undefined, [] as UserRole[]),
          async (requiredRoles, emptyRoles) => {
            // User has no roles or empty roles array — should default to ['customer']
            const user = createMockUser(emptyRoles);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            // Since required roles don't include 'customer', user should get 403
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.code).toBe('FORBIDDEN');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('users with missing/empty roles default to customer and get 200 for customer routes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(undefined, [] as UserRole[]),
          nonAdminRolesArb,
          async (emptyRoles, additionalRequired) => {
            // Required roles include 'customer'
            const requiredRoles: UserRole[] = ['customer', ...additionalRequired];
            const user = createMockUser(emptyRoles);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            // Default role is 'customer', which is in the required set
            expect(res.status).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('403 response always includes error code FORBIDDEN and descriptive message', async () => {
      await fc.assert(
        fc.asyncProperty(
          requiredRolesArb,
          nonAdminRolesArb,
          async (requiredRoles, userRoles) => {
            // Precondition: user does NOT hold any of the required roles
            fc.pre(!requiredRoles.some((r) => userRoles.includes(r)));

            const user = createMockUser(userRoles);
            const app = createTestApp(requiredRoles, user);

            const res = await app.request('/test');

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body).toEqual({
              data: null,
              error: {
                code: 'FORBIDDEN',
                message: expect.stringContaining('Requires one of:'),
              },
              meta: null,
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
