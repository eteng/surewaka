// Feature: rbac-system
// Property 2: No Self-Elevation — non-admins cannot assign surewaka_admin/support_agent
// Property 5: Unique Active Roles — duplicate active role → 409 Conflict
// Property 6: Audit Completeness — every mutation produces exactly one audit entry
// Property 7: Org-Scoped Role Validation — org roles rejected without scope fields
// Validates: Requirements 4.3, 4.4, 4.7, 7.6, 1.7, 1.8

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { UserRole } from '@surewaka/shared';
import { USER_ROLES } from '@surewaka/shared';

// ─── Mock State ──────────────────────────────────────────────────────────────

let dbSelectResult: unknown[] = [];
let dbInsertResult: unknown[] = [];
let dbUpdateResult: unknown[] = [];
let auditInsertCalls: unknown[] = [];
let roleInsertCalls: unknown[] = [];
let syncSelectResult: unknown[] = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

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
    scopeType: 'scopeType',
  };
  const roleAuditLogTable = { __table: 'roleAuditLog' };

  return {
    db: {
      select: (fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (...args: unknown[]) => {
            // If fields are specified (like in syncRolesToAuth), return syncSelectResult
            if (fields) {
              return Promise.resolve(syncSelectResult);
            }
            // Otherwise return the standard select result (for duplicate checks)
            return {
              limit: (n: number) => Promise.resolve(dbSelectResult),
            };
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (data: unknown) => {
          if (table === roleAuditLogTable) {
            auditInsertCalls.push(data);
          } else {
            roleInsertCalls.push(data);
          }
          return {
            returning: () => {
              if (table === roleAuditLogTable) {
                return Promise.resolve([{
                  id: crypto.randomUUID(),
                  ...(data as object),
                  createdAt: new Date(),
                }]);
              }
              return Promise.resolve(dbInsertResult);
            },
          };
        },
      }),
      update: (table: unknown) => ({
        set: (data: unknown) => ({
          where: (...args: unknown[]) => ({
            returning: () => Promise.resolve(dbUpdateResult),
          }),
        }),
      }),
    },
    userRoles: userRolesTable,
    roleAuditLog: roleAuditLogTable,
  };
});

vi.mock('@surewaka/auth', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        updateUserById: () => Promise.resolve({ error: null }),
      },
    },
  }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  assignRole,
  revokeRole,
  upgradeRole,
  type AssignRoleParams,
  type UpgradeRoleParams,
} from '../services/role-service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NON_ADMIN_ROLES = USER_ROLES.filter(
  (r) => r !== 'surewaka_admin'
) as UserRole[];

const ORG_SCOPED_ROLES: UserRole[] = ['carrier_admin', 'carrier_driver'];
const GLOBAL_ROLES: UserRole[] = ['customer', 'driver', 'support_agent', 'surewaka_admin'];

/** Arbitrary for a valid UUID */
const uuidArb = fc.uuid();

/** Arbitrary for non-admin roles (roles that non-admins hold) */
const nonAdminRoleArb = fc.constantFrom(...NON_ADMIN_ROLES);

/** Arbitrary for roles that require admin to assign */
const adminOnlyRoleArb = fc.constantFrom('surewaka_admin' as UserRole, 'support_agent' as UserRole);

/** Arbitrary for org-scoped roles */
const orgScopedRoleArb = fc.constantFrom(...ORG_SCOPED_ROLES);

/** Arbitrary for global roles */
const globalRoleArb = fc.constantFrom(...GLOBAL_ROLES);

/** Arbitrary for any valid role */
const anyRoleArb = fc.constantFrom(...USER_ROLES);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Role Service — Property Tests', () => {
  beforeEach(() => {
    dbSelectResult = [];
    dbInsertResult = [];
    dbUpdateResult = [];
    auditInsertCalls = [];
    roleInsertCalls = [];
    syncSelectResult = [];
  });

  describe('Property 2: No Self-Elevation — non-admins cannot assign surewaka_admin/support_agent', () => {
    it('non-admin users are rejected when assigning admin-only roles', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          adminOnlyRoleArb,
          fc.subarray([...NON_ADMIN_ROLES], { minLength: 1 }).map((arr) => arr as UserRole[]),
          async (userId, assignedBy, targetRole, assignerRoles) => {
            // Precondition: assigner does NOT have surewaka_admin
            fc.pre(!assignerRoles.includes('surewaka_admin'));

            const result = await assignRole({
              userId,
              role: targetRole,
              assignedBy,
              assignedByRoles: assignerRoles,
              scopeType: null,
              scopeId: null,
            });

            // Must be rejected with FORBIDDEN
            expect(result.error).not.toBeNull();
            expect(result.error?.code).toBe('FORBIDDEN');
            expect(result.data).toBeNull();
          }
        ),
        { numRuns: 100 },
      );
    });

    it('surewaka_admin can assign admin-only roles', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          adminOnlyRoleArb,
          async (userId, assignedBy, targetRole) => {
            dbSelectResult = []; // No existing role
            syncSelectResult = []; // No active roles for sync
            dbInsertResult = [{
              id: crypto.randomUUID(),
              userId,
              role: targetRole,
              scopeType: null,
              scopeId: null,
              assignedBy,
              assignedAt: new Date(),
              revokedAt: null,
              isActive: true,
            }];

            const result = await assignRole({
              userId,
              role: targetRole,
              assignedBy,
              assignedByRoles: ['surewaka_admin'],
              scopeType: null,
              scopeId: null,
            });

            // Must succeed
            expect(result.error).toBeNull();
            expect(result.data).not.toBeNull();
            expect(result.data?.role).toBe(targetRole);
          }
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('Property 5: Unique Active Roles — duplicate active role → 409 Conflict', () => {
    it('assigning a role that is already active returns 409 Conflict', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          anyRoleArb,
          async (userId, assignedBy, role) => {
            // Simulate existing active role
            dbSelectResult = [{
              id: crypto.randomUUID(),
              userId,
              role,
              scopeType: null,
              scopeId: null,
              assignedBy,
              assignedAt: new Date(),
              revokedAt: null,
              isActive: true,
            }];

            const params: AssignRoleParams = {
              userId,
              role,
              assignedBy,
              assignedByRoles: ['surewaka_admin'], // Use admin to bypass permission check
              scopeType: ORG_SCOPED_ROLES.includes(role) ? 'carrier' : null,
              scopeId: ORG_SCOPED_ROLES.includes(role) ? crypto.randomUUID() : null,
            };

            const result = await assignRole(params);

            expect(result.error).not.toBeNull();
            expect(result.error?.code).toBe('CONFLICT');
            expect(result.data).toBeNull();
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 6: Audit Completeness — every mutation produces exactly one audit entry', () => {
    it('assignRole produces exactly one audit log entry on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          globalRoleArb,
          async (userId, assignedBy, role) => {
            // Skip admin-only roles for simplicity
            fc.pre(!['surewaka_admin', 'support_agent'].includes(role));

            dbSelectResult = []; // No existing role
            syncSelectResult = [];
            auditInsertCalls = [];
            roleInsertCalls = [];
            dbInsertResult = [{
              id: crypto.randomUUID(),
              userId,
              role,
              scopeType: null,
              scopeId: null,
              assignedBy,
              assignedAt: new Date(),
              revokedAt: null,
              isActive: true,
            }];

            await assignRole({
              userId,
              role,
              assignedBy,
              assignedByRoles: ['surewaka_admin'],
              scopeType: null,
              scopeId: null,
            });

            // Exactly one audit entry should be created
            expect(auditInsertCalls.length).toBe(1);
          }
        ),
        { numRuns: 50 },
      );
    });

    it('revokeRole produces exactly one audit log entry on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          anyRoleArb,
          fc.string({ minLength: 3, maxLength: 100 }),
          async (userId, revokedBy, role, reason) => {
            // Simulate existing active role that can be revoked
            dbUpdateResult = [{
              id: crypto.randomUUID(),
              userId,
              role,
              scopeType: null,
              scopeId: null,
              assignedBy: revokedBy,
              assignedAt: new Date(),
              revokedAt: new Date(),
              isActive: false,
            }];
            syncSelectResult = [];
            auditInsertCalls = [];

            await revokeRole({
              userId,
              role,
              revokedBy,
              reason,
            });

            // Exactly one audit entry should be created
            expect(auditInsertCalls.length).toBe(1);
          }
        ),
        { numRuns: 50 },
      );
    });

    it('upgradeRole produces exactly one audit log entry on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          fc.string({ minLength: 3, maxLength: 100 }),
          async (userId, performedBy, reason) => {
            dbSelectResult = []; // No existing target role
            syncSelectResult = [];
            auditInsertCalls = [];
            dbInsertResult = [{
              id: crypto.randomUUID(),
              userId,
              role: 'driver',
              scopeType: null,
              scopeId: null,
              assignedBy: performedBy,
              assignedAt: new Date(),
              revokedAt: null,
              isActive: true,
            }];

            await upgradeRole({
              userId,
              fromRole: 'carrier_driver',
              toRole: 'driver',
              performedBy,
              performedByRoles: ['surewaka_admin'],
              reason,
            });

            // Exactly one audit entry should be created
            expect(auditInsertCalls.length).toBe(1);
          }
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('Property 7: Org-Scoped Role Validation — org roles rejected without scope fields', () => {
    it('org-scoped roles are rejected when scopeType is missing', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          orgScopedRoleArb,
          async (userId, assignedBy, role) => {
            const result = await assignRole({
              userId,
              role,
              assignedBy,
              assignedByRoles: ['surewaka_admin'],
              scopeType: null,
              scopeId: crypto.randomUUID(),
            });

            expect(result.error).not.toBeNull();
            expect(result.error?.code).toBe('VALIDATION_ERROR');
            expect(result.data).toBeNull();
          }
        ),
        { numRuns: 50 },
      );
    });

    it('org-scoped roles are rejected when scopeId is missing', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          orgScopedRoleArb,
          async (userId, assignedBy, role) => {
            const result = await assignRole({
              userId,
              role,
              assignedBy,
              assignedByRoles: ['surewaka_admin'],
              scopeType: 'carrier',
              scopeId: null,
            });

            expect(result.error).not.toBeNull();
            expect(result.error?.code).toBe('VALIDATION_ERROR');
            expect(result.data).toBeNull();
          }
        ),
        { numRuns: 50 },
      );
    });

    it('org-scoped roles succeed when both scopeType and scopeId are provided', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          orgScopedRoleArb,
          async (userId, assignedBy, scopeId, role) => {
            dbSelectResult = []; // No existing role
            syncSelectResult = [];
            dbInsertResult = [{
              id: crypto.randomUUID(),
              userId,
              role,
              scopeType: 'carrier',
              scopeId,
              assignedBy,
              assignedAt: new Date(),
              revokedAt: null,
              isActive: true,
            }];

            const result = await assignRole({
              userId,
              role,
              assignedBy,
              assignedByRoles: ['surewaka_admin'],
              scopeType: 'carrier',
              scopeId,
            });

            expect(result.error).toBeNull();
            expect(result.data).not.toBeNull();
            expect(result.data?.scopeType).toBe('carrier');
            expect(result.data?.scopeId).toBe(scopeId);
          }
        ),
        { numRuns: 50 },
      );
    });
  });
});
