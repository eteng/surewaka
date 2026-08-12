// Feature: rbac-system
// Property 4: Sync Consistency — after sync, app_metadata.roles matches active DB roles
// Validates: Requirements 1.3, 6.1, 6.3, 6.4, 9.5

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { UserRole } from '@surewaka/shared';
import { USER_ROLES } from '@surewaka/shared';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

let mockActiveRoles: Array<{ role: string; scopeId: string | null }> = [];
/** clerkId that the mocked `users` lookup resolves the internal userId to. */
let mockClerkId: string | null = 'user_clerk_test123';
let lastUpdateCall: { userId: string; publicMetadata: unknown } | null = null;

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  and: (...conditions: unknown[]) => ({ conditions, op: 'and' }),
}));

vi.mock('@surewaka/db', () => {
  const userRolesTable = {
    userId: 'userId',
    role: 'role',
    isActive: 'isActive',
    scopeId: 'scopeId',
  };
  const usersTable = { id: 'id', clerkId: 'clerkId' };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          // Distinguish the `users.clerkId` lookup from the `userRoles` query
          // by table identity, same as the real drizzle query builder would
          // by table shape.
          if (table === usersTable) {
            const rows = mockClerkId ? [{ clerkId: mockClerkId }] : [];
            return {
              where: () => ({
                limit: () => Promise.resolve(rows),
              }),
            };
          }
          return { where: () => Promise.resolve(mockActiveRoles) };
        },
      }),
    },
    userRoles: userRolesTable,
    users: usersTable,
  };
});

vi.mock('@surewaka/auth', () => ({
  getClerkClient: () => ({
    users: {
      updateUserMetadata: async (userId: string, data: { publicMetadata: unknown }) => {
        lastUpdateCall = { userId, publicMetadata: data.publicMetadata };
      },
    },
  }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { syncRolesToAuth } from '../services/role-service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORG_SCOPED_ROLES: UserRole[] = ['carrier_admin', 'carrier_driver'];

/** Arbitrary for a valid UUID */
const uuidArb = fc.uuid();

/** Arbitrary for a non-empty set of active roles with optional scope */
const activeRolesArb = fc
  .array(
    fc.record({
      role: fc.constantFrom(...USER_ROLES),
      scopeId: fc.oneof(
        fc.constant(null),
        fc.uuid()
      ),
    }),
    { minLength: 0, maxLength: 6 }
  );

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Role Sync — Property Tests', () => {
  beforeEach(() => {
    mockActiveRoles = [];
    mockClerkId = 'user_clerk_test123';
    lastUpdateCall = null;
  });

  describe('Property 4: Sync Consistency — after sync, app_metadata.roles matches active DB roles', () => {
    it('synced roles array contains exactly the unique roles from active DB records', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          activeRolesArb,
          async (userId, activeRoles) => {
            mockActiveRoles = activeRoles;
            lastUpdateCall = null;

            await syncRolesToAuth(userId);

            expect(lastUpdateCall).not.toBeNull();

            // Regression guard: Clerk must be updated using the resolved
            // clerkId, never the internal DB userId directly.
            expect(lastUpdateCall!.userId).toBe(mockClerkId);
            expect(lastUpdateCall!.userId).not.toBe(userId);

            const metadata = lastUpdateCall!.publicMetadata as {
              roles: UserRole[];
              primary_role: UserRole;
              carrier_id?: string;
            };

            if (activeRoles.length === 0) {
              // Default to ['customer'] when no active roles
              expect(metadata.roles).toEqual(['customer']);
              expect(metadata.primary_role).toBe('customer');
            } else {
              // Roles should be the unique set of active roles
              const expectedRoles = [...new Set(activeRoles.map((r) => r.role))];
              expect(metadata.roles).toEqual(expectedRoles);
              expect(metadata.primary_role).toBe(expectedRoles[0]);
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it('carrier_id is set when user has an org-scoped role', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          fc.constantFrom(...ORG_SCOPED_ROLES),
          async (userId, carrierId, orgRole) => {
            mockActiveRoles = [{ role: orgRole, scopeId: carrierId }];
            lastUpdateCall = null;

            await syncRolesToAuth(userId);

            expect(lastUpdateCall).not.toBeNull();

            const metadata = lastUpdateCall!.publicMetadata as {
              roles: UserRole[];
              primary_role: UserRole;
              carrier_id?: string;
            };

            expect(metadata.carrier_id).toBe(carrierId);
          }
        ),
        { numRuns: 50 },
      );
    });

    it('carrier_id is not set when user has only global roles', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.subarray(
            ['customer', 'driver', 'support_agent', 'surewaka_admin'] as UserRole[],
            { minLength: 1 }
          ),
          async (userId, globalRoles) => {
            mockActiveRoles = globalRoles.map((role) => ({ role, scopeId: null }));
            lastUpdateCall = null;

            await syncRolesToAuth(userId);

            expect(lastUpdateCall).not.toBeNull();

            const metadata = lastUpdateCall!.publicMetadata as {
              roles: UserRole[];
              primary_role: UserRole;
              carrier_id?: string;
            };

            expect(metadata.carrier_id).toBeUndefined();
          }
        ),
        { numRuns: 50 },
      );
    });

    it('defaults to customer when no active roles exist', async () => {
      await fc.assert(
        fc.asyncProperty(uuidArb, async (userId) => {
          mockActiveRoles = [];
          lastUpdateCall = null;

          await syncRolesToAuth(userId);

          expect(lastUpdateCall).not.toBeNull();

          const metadata = lastUpdateCall!.publicMetadata as {
            roles: UserRole[];
            primary_role: UserRole;
          };

          expect(metadata.roles).toEqual(['customer']);
          expect(metadata.primary_role).toBe('customer');
        }),
        { numRuns: 50 },
      );
    });

    it('does not call Clerk and does not throw when the user has no clerkId', async () => {
      await fc.assert(
        fc.asyncProperty(uuidArb, async (userId) => {
          mockActiveRoles = [{ role: 'customer', scopeId: null }];
          mockClerkId = null;
          lastUpdateCall = null;

          await expect(syncRolesToAuth(userId)).resolves.toBeUndefined();

          expect(lastUpdateCall).toBeNull();
        }),
        { numRuns: 20 },
      );
    });

    it('sync failure does not throw (logs error instead)', async () => {
      // Simulate Clerk metadata update failure
      vi.doMock('@surewaka/auth', () => ({
        getClerkClient: () => ({
          users: {
            updateUserMetadata: async () => {
              throw new Error('Network error');
            },
          },
        }),
      }));

      await fc.assert(
        fc.asyncProperty(uuidArb, async (userId) => {
          mockActiveRoles = [{ role: 'customer', scopeId: null }];

          // Should not throw
          await expect(syncRolesToAuth(userId)).resolves.toBeUndefined();
        }),
        { numRuns: 10 },
      );
    });
  });
});
