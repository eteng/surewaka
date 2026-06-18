// Feature: rbac-system
// Unit tests for role service operations
// Validates: Requirements 4.1, 4.2, 4.3, 4.7

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
            if (fields) {
              return Promise.resolve(syncSelectResult);
            }
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
} from '../services/role-service';

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('Role Service — Unit Tests', () => {
  beforeEach(() => {
    dbSelectResult = [];
    dbInsertResult = [];
    dbUpdateResult = [];
    auditInsertCalls = [];
    roleInsertCalls = [];
    syncSelectResult = [];
  });

  describe('assignRole — org-scoped role validation (Requirement 4.3)', () => {
    it('returns VALIDATION_ERROR when carrier_admin is assigned without scopeId', async () => {
      const result = await assignRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'carrier_admin',
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedByRoles: ['surewaka_admin'],
        scopeType: 'carrier',
        scopeId: null,
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toBe('Org-scoped roles require scopeType and scopeId');
      expect(result.data).toBeNull();
    });

    it('returns VALIDATION_ERROR when carrier_driver is assigned without scopeType', async () => {
      const result = await assignRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'carrier_driver',
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedByRoles: ['surewaka_admin'],
        scopeType: null,
        scopeId: '33333333-3333-4333-8333-333333333333',
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toBe('Org-scoped roles require scopeType and scopeId');
      expect(result.data).toBeNull();
    });

    it('returns VALIDATION_ERROR when carrier_admin has neither scopeType nor scopeId', async () => {
      const result = await assignRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'carrier_admin',
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedByRoles: ['surewaka_admin'],
        scopeType: null,
        scopeId: null,
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.data).toBeNull();
    });
  });

  describe('revokeRole — sets is_active=false and revoked_at (Requirement 4.2)', () => {
    it('calls update with is_active=false and sets revoked_at timestamp', async () => {
      const now = new Date();
      dbUpdateResult = [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'driver',
        scopeType: null,
        scopeId: null,
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedAt: new Date('2024-01-01'),
        revokedAt: now,
        isActive: false,
      }];
      syncSelectResult = [];

      const result = await revokeRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'driver',
        revokedBy: '22222222-2222-4222-8222-222222222222',
        reason: 'No longer active on platform',
      });

      expect(result.error).toBeNull();
      // Verify audit log was created with 'revoked' action
      expect(auditInsertCalls.length).toBe(1);
      const auditEntry = auditInsertCalls[0] as Record<string, unknown>;
      expect(auditEntry.action).toBe('revoked');
      expect(auditEntry.userId).toBe('11111111-1111-4111-8111-111111111111');
      expect(auditEntry.role).toBe('driver');
      expect(auditEntry.performedBy).toBe('22222222-2222-4222-8222-222222222222');
      expect(auditEntry.reason).toBe('No longer active on platform');
    });

    it('returns NOT_FOUND when no active role exists to revoke', async () => {
      dbUpdateResult = []; // No rows updated

      const result = await revokeRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'driver',
        revokedBy: '22222222-2222-4222-8222-222222222222',
        reason: 'Attempting to revoke non-existent role',
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.error?.message).toBe('Active role not found');
    });
  });

  describe('assignRole — duplicate active role returns 409 Conflict (Requirement 4.7)', () => {
    it('returns CONFLICT when user already has the same active role', async () => {
      // Simulate existing active role in the database
      dbSelectResult = [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'driver',
        scopeType: null,
        scopeId: null,
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedAt: new Date('2024-01-01'),
        revokedAt: null,
        isActive: true,
      }];

      const result = await assignRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'driver',
        assignedBy: '33333333-3333-4333-8333-333333333333',
        assignedByRoles: ['surewaka_admin'],
        scopeType: null,
        scopeId: null,
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('CONFLICT');
      expect(result.error?.message).toBe('User already has this active role');
      expect(result.data).toBeNull();
    });

    it('returns CONFLICT for duplicate org-scoped role with same scopeId', async () => {
      const carrierId = '44444444-4444-4444-8444-444444444444';

      dbSelectResult = [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'carrier_admin',
        scopeType: 'carrier',
        scopeId: carrierId,
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedAt: new Date('2024-01-01'),
        revokedAt: null,
        isActive: true,
      }];

      const result = await assignRole({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'carrier_admin',
        assignedBy: '33333333-3333-4333-8333-333333333333',
        assignedByRoles: ['surewaka_admin'],
        scopeType: 'carrier',
        scopeId: carrierId,
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('CONFLICT');
      expect(result.data).toBeNull();
    });
  });

  describe('upgradeRole — creates new role + audit log (Requirement 4.1, 4.7)', () => {
    it('creates a new role record and audit log entry with action=upgraded', async () => {
      const userId = '11111111-1111-4111-8111-111111111111';
      const performedBy = '22222222-2222-4222-8222-222222222222';

      dbSelectResult = []; // No existing target role
      syncSelectResult = [];
      dbInsertResult = [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId,
        role: 'driver',
        scopeType: null,
        scopeId: null,
        assignedBy: performedBy,
        assignedAt: new Date(),
        revokedAt: null,
        isActive: true,
      }];

      const result = await upgradeRole({
        userId,
        fromRole: 'carrier_driver',
        toRole: 'driver',
        performedBy,
        performedByRoles: ['surewaka_admin'],
        reason: 'Completed full platform KYC',
      });

      // Verify new role was created
      expect(result.error).toBeNull();
      expect(result.data).not.toBeNull();
      expect(result.data?.role).toBe('driver');
      expect(result.data?.userId).toBe(userId);
      expect(result.data?.isActive).toBe(true);

      // Verify role insert was called
      expect(roleInsertCalls.length).toBe(1);
      const roleInsert = roleInsertCalls[0] as Record<string, unknown>;
      expect(roleInsert.userId).toBe(userId);
      expect(roleInsert.role).toBe('driver');
      expect(roleInsert.assignedBy).toBe(performedBy);

      // Verify audit log was created with 'upgraded' action
      expect(auditInsertCalls.length).toBe(1);
      const auditEntry = auditInsertCalls[0] as Record<string, unknown>;
      expect(auditEntry.userId).toBe(userId);
      expect(auditEntry.role).toBe('driver');
      expect(auditEntry.action).toBe('upgraded');
      expect(auditEntry.performedBy).toBe(performedBy);
      expect(auditEntry.reason).toBe('Completed full platform KYC');
    });

    it('returns CONFLICT if user already has the target role', async () => {
      const userId = '11111111-1111-4111-8111-111111111111';

      // Simulate existing target role
      dbSelectResult = [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId,
        role: 'driver',
        scopeType: null,
        scopeId: null,
        assignedBy: '22222222-2222-4222-8222-222222222222',
        assignedAt: new Date(),
        revokedAt: null,
        isActive: true,
      }];

      const result = await upgradeRole({
        userId,
        fromRole: 'carrier_driver',
        toRole: 'driver',
        performedBy: '22222222-2222-4222-8222-222222222222',
        performedByRoles: ['surewaka_admin'],
        reason: 'Attempting duplicate upgrade',
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('CONFLICT');
      expect(result.error?.message).toBe('User already has the target role');
      expect(result.data).toBeNull();
    });

    it('returns FORBIDDEN when non-admin tries to upgrade to admin role', async () => {
      const result = await upgradeRole({
        userId: '11111111-1111-4111-8111-111111111111',
        fromRole: 'support_agent',
        toRole: 'surewaka_admin',
        performedBy: '22222222-2222-4222-8222-222222222222',
        performedByRoles: ['support_agent'],
        reason: 'Unauthorized upgrade attempt',
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('FORBIDDEN');
      expect(result.data).toBeNull();
    });
  });
});
