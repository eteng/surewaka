// Feature: rbac-system
// Property 3: Scope Isolation — org-scoped users denied access to other carriers
// Validates: Requirements 3.1, 3.4, 5.4

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Hono } from 'hono';
import { USER_ROLES, type UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

// Mock the @surewaka/db module to control carrier_members query results
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock('@surewaka/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
  carrierMembers: {
    userId: 'user_id',
    carrierId: 'carrier_id',
    isActive: 'is_active',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arbitrary for a valid UUID v4 */
const uuidArb = fc.uuid().filter((u) => u.length === 36);

/** Two distinct UUIDs representing different carriers */
const distinctCarrierIdsArb = fc
  .tuple(uuidArb, uuidArb)
  .filter(([a, b]) => a !== b);

/** Org-scoped roles that require carrier membership */
const ORG_SCOPED_ROLES: UserRole[] = ['carrier_admin', 'carrier_driver'];

/** All roles except surewaka_admin */
const NON_ADMIN_ROLES = USER_ROLES.filter((r) => r !== 'surewaka_admin');

/** Arbitrary for org-scoped roles */
const orgScopedRoleArb = fc.constantFrom<UserRole>('carrier_admin', 'carrier_driver');

/** Arbitrary for non-admin roles (user's actual roles) */
const nonAdminRolesArb = fc
  .subarray([...NON_ADMIN_ROLES], { minLength: 1 })
  .map((arr) => arr as UserRole[]);

/**
 * Create a mock AuthUser with the given roles and optional carrier_id.
 */
function createMockUser(
  id: string,
  roles: UserRole[],
  carrierId?: string
): AuthUser {
  return {
    id,
    email: 'test@surewaka.com',
    user_metadata: { name: 'Test User' },
    app_metadata: {
      roles,
      primary_role: roles[0],
      carrier_id: carrierId,
    },
  };
}

/**
 * Create a Hono app with the carrier scope middleware and a test route.
 * Simulates the middleware chain: requireAuth → requireRole → requireCarrierScope.
 */
async function createTestApp(user: AuthUser, userRoles: UserRole[]) {
  // Dynamic import to get the mocked version
  const { requireCarrierScope } = await import('../middleware/carrier-scope');

  const app = new Hono();

  // Simulate requireAuth — sets user on context
  app.use('/carriers/:carrierId/*', async (c, next) => {
    c.set('user' as never, user);
    c.set('userRoles' as never, userRoles);
    await next();
  });

  // Apply carrier scope middleware
  app.use('/carriers/:carrierId/*', requireCarrierScope);

  // Test handler
  app.get('/carriers/:carrierId/drivers', (c) =>
    c.json({ data: 'ok', error: null, meta: null })
  );

  // Route without carrierId param (for missing param test)
  app.use('/no-carrier/*', async (c, next) => {
    c.set('user' as never, user);
    c.set('userRoles' as never, userRoles);
    await next();
  });
  app.use('/no-carrier/*', requireCarrierScope);
  app.get('/no-carrier/test', (c) =>
    c.json({ data: 'ok', error: null, meta: null })
  );

  return app;
}

/**
 * Configure mock DB to return membership results.
 */
function mockMembershipQuery(results: unknown[]) {
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue(results);
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Carrier Scope Middleware — Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Property 3: Scope Isolation — org-scoped users denied access to other carriers', () => {
    it('user who is a member of carrier A is denied access to carrier B', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          distinctCarrierIdsArb, // [memberCarrierId, requestedCarrierId]
          orgScopedRoleArb, // user's org-scoped role
          async (userId, [memberCarrierId, requestedCarrierId], role) => {
            // User belongs to carrier A but requests carrier B
            const user = createMockUser(userId, [role], memberCarrierId);
            const app = await createTestApp(user, [role]);

            // DB returns empty — user is NOT a member of the requested carrier
            mockMembershipQuery([]);

            const res = await app.request(`/carriers/${requestedCarrierId}/drivers`);

            // Should be denied access (403)
            expect(res.status).toBe(403);
            const body: { error: { code: string } } = await res.json();
            expect(body.error.code).toBe('FORBIDDEN');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('user who is a member of carrier A is granted access to carrier A', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          uuidArb, // carrierId (same for membership and request)
          orgScopedRoleArb, // user's org-scoped role
          async (userId, carrierId, role) => {
            const user = createMockUser(userId, [role], carrierId);
            const app = await createTestApp(user, [role]);

            // DB returns a membership record — user IS a member
            mockMembershipQuery([
              {
                id: '00000000-0000-4000-8000-000000000099',
                carrierId,
                userId,
                role,
                invitedBy: null,
                joinedAt: new Date(),
                leftAt: null,
                isActive: true,
              },
            ]);

            const res = await app.request(`/carriers/${carrierId}/drivers`);

            // Should be granted access (200)
            expect(res.status).toBe(200);
            const body: { data: string } = await res.json();
            expect(body.data).toBe('ok');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('surewaka_admin bypasses scope check for any carrier', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          uuidArb, // any carrierId
          async (userId, carrierId) => {
            const user = createMockUser(userId, ['surewaka_admin']);
            const app = await createTestApp(user, ['surewaka_admin']);

            // DB should NOT be queried for surewaka_admin
            mockMembershipQuery([]);

            const res = await app.request(`/carriers/${carrierId}/drivers`);

            // surewaka_admin always gets through
            expect(res.status).toBe(200);
            const body: { data: string } = await res.json();
            expect(body.data).toBe('ok');

            // Verify DB was never queried (bypass means no DB call)
            expect(mockFrom).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('non-member users with any non-admin role are denied access to any carrier', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          uuidArb, // carrierId
          nonAdminRolesArb, // user's roles (none is surewaka_admin)
          async (userId, carrierId, roles) => {
            const user = createMockUser(userId, roles);
            const app = await createTestApp(user, roles);

            // DB returns empty — user is NOT a member
            mockMembershipQuery([]);

            const res = await app.request(`/carriers/${carrierId}/drivers`);

            // Should be denied
            expect(res.status).toBe(403);
            const body: { error: { code: string; message: string } } = await res.json();
            expect(body.error.code).toBe('FORBIDDEN');
            expect(body.error.message).toBe('Not a member of this carrier');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('scope isolation holds regardless of how many carriers exist — membership in one never grants access to another', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          fc.array(uuidArb, { minLength: 2, maxLength: 5 }), // multiple carrier IDs
          orgScopedRoleArb,
          async (userId, carrierIds, role) => {
            // User is a member of the first carrier only
            const memberCarrierId = carrierIds[0];
            const otherCarrierIds = carrierIds.slice(1);

            // Precondition: all carrier IDs are distinct
            fc.pre(new Set(carrierIds).size === carrierIds.length);

            const user = createMockUser(userId, [role], memberCarrierId);

            // For each non-member carrier, access should be denied
            for (const otherCarrierId of otherCarrierIds) {
              const app = await createTestApp(user, [role]);
              mockMembershipQuery([]); // Not a member of this carrier

              const res = await app.request(`/carriers/${otherCarrierId}/drivers`);

              expect(res.status).toBe(403);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Scope Middleware — Error Handling', () => {
    it('returns 400 BAD_REQUEST when carrierId parameter is missing', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          nonAdminRolesArb, // non-admin roles
          async (userId, roles) => {
            const user = createMockUser(userId, roles);
            const app = await createTestApp(user, roles);

            // Request a route without carrierId param
            const res = await app.request('/no-carrier/test');

            expect(res.status).toBe(400);
            const body: { error: { code: string } } = await res.json();
            expect(body.error.code).toBe('BAD_REQUEST');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('403 response always includes structured error with FORBIDDEN code', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          nonAdminRolesArb,
          async (userId, carrierId, roles) => {
            const user = createMockUser(userId, roles);
            const app = await createTestApp(user, roles);
            mockMembershipQuery([]);

            const res = await app.request(`/carriers/${carrierId}/drivers`);

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body).toEqual({
              data: null,
              error: {
                code: 'FORBIDDEN',
                message: 'Not a member of this carrier',
              },
              meta: null,
            });
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
