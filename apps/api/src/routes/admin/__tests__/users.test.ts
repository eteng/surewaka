// Feature: admin-user-management
// Integration tests for transaction atomicity and middleware chain
//
// Tests:
// - Invitation: force failure mid-transaction, verify no partial records created
// - Deactivation: force failure mid-transaction, verify all-or-nothing behavior
// - Middleware chain: verify requireAuth + requireRole applied to all routes
//
// **Validates: Requirements 1.7, 1.8, 4.7, 7.1, 7.2**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

// ─── Mock State ───────────────────────────────────────────────────────────────

let dbSelectResult: unknown[] = [];
let transactionCalled = false;
let transactionRolledBack = false;
let assignRoleCalls: unknown[] = [];
let assignRoleResult: unknown = { data: null, error: null, meta: null };
let supabaseInviteResult: { error: unknown } = { error: null };
let rolesSelectResult: unknown[] = [];
let carriersSelectResult: unknown[] = [];
let txInsertCalls: { table: unknown; values: unknown }[] = [];
let txUpdateCalls: { table: unknown; setData: unknown; whereArgs: unknown }[] = [];
let supabaseUpdateUserResult: { error: unknown } = { error: null };
let syncRolesToAuthCalls: string[] = [];

// Track whether user record was persisted (for atomicity verification)
let userRecordCreated = false;
let roleRecordCreated = false;
let userDeactivated = false;
let rolesRevoked = false;
let auditEntriesCreated = false;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  ne: (col: unknown, val: unknown) => ({ col, val, op: 'ne' }),
  and: (...conditions: unknown[]) => ({ conditions, op: 'and' }),
  or: (...conditions: unknown[]) => ({ conditions, op: 'or' }),
  ilike: (col: unknown, pattern: unknown) => ({ col, pattern, op: 'ilike' }),
  asc: (col: unknown) => ({ col, dir: 'asc' }),
  desc: (col: unknown) => ({ col, dir: 'desc' }),
  count: () => ({ fn: 'count' }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { join: (items: unknown[], sep: unknown) => ({ items, sep, type: 'sql_join' }) },
  ),
}));

vi.mock('@surewaka/db', () => {
  const usersTable = {
    id: 'id',
    email: 'email',
    name: 'name',
    phone: 'phone',
    verified: 'verified',
    avatarUrl: 'avatarUrl',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  };
  const userRolesTable = {
    id: 'id',
    userId: 'userId',
    role: 'role',
    isActive: 'isActive',
    scopeType: 'scopeType',
    scopeId: 'scopeId',
    revokedAt: 'revokedAt',
  };
  const carriersTable = { id: 'id', name: 'name' };
  const roleAuditLogTable = {
    id: 'id',
    userId: 'userId',
    role: 'role',
    action: 'action',
    scopeType: 'scopeType',
    scopeId: 'scopeId',
    performedBy: 'performedBy',
    reason: 'reason',
    createdAt: 'createdAt',
  };

  const makeChainableResult = (resolveData: () => unknown[]) => {
    const chain: Record<string, unknown> = {};
    chain.where = (..._args: unknown[]) => chain;
    chain.orderBy = (..._args: unknown[]) => chain;
    chain.limit = (_n: number) => chain;
    chain.offset = (_n: number) => chain;
    chain.groupBy = (..._args: unknown[]) => chain;
    chain.leftJoin = (..._args: unknown[]) => chain;
    chain.then = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) => {
      return Promise.resolve(resolveData()).then(resolve, reject);
    };
    return chain;
  };

  return {
    db: {
      select: (_fields?: unknown) => ({
        from: (table: unknown) => {
          if (table === carriersTable) {
            return makeChainableResult(() => carriersSelectResult);
          }
          if (table === userRolesTable) {
            return makeChainableResult(() => rolesSelectResult);
          }
          return makeChainableResult(() => dbSelectResult);
        },
      }),
      update: (_table: unknown) => ({
        set: (_data: unknown) => ({
          where: (..._args: unknown[]) => Promise.resolve(),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        transactionCalled = true;
        const tx = {
          insert: (table: unknown) => ({
            values: (data: unknown) => {
              txInsertCalls.push({ table, values: data });
              if (table === usersTable) {
                userRecordCreated = true;
              }
              if (table === roleAuditLogTable) {
                auditEntriesCreated = true;
              }
              return {
                returning: () =>
                  Promise.resolve([
                    {
                      id: 'new-user-id',
                      ...(data as object),
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ]),
              };
            },
          }),
          update: (table: unknown) => ({
            set: (data: unknown) => {
              const call = { table, setData: data, whereArgs: null as unknown };
              txUpdateCalls.push(call);
              if (table === usersTable) {
                userDeactivated = true;
              }
              if (table === userRolesTable) {
                rolesRevoked = true;
              }
              return {
                where: (...args: unknown[]) => {
                  call.whereArgs = args;
                  return Promise.resolve();
                },
              };
            },
          }),
        };
        try {
          return await fn(tx);
        } catch (err) {
          // Transaction rolled back — reset state to simulate rollback
          transactionRolledBack = true;
          userRecordCreated = false;
          roleRecordCreated = false;
          userDeactivated = false;
          rolesRevoked = false;
          auditEntriesCreated = false;
          txInsertCalls = [];
          txUpdateCalls = [];
          throw err;
        }
      },
    },
    users: usersTable,
    userRoles: userRolesTable,
    carriers: carriersTable,
    roleAuditLog: roleAuditLogTable,
  };
});

vi.mock('@surewaka/auth', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: (_email: string, _options?: unknown) => {
          return Promise.resolve(supabaseInviteResult);
        },
        updateUserById: (_userId: string, _data?: unknown) => {
          return Promise.resolve(supabaseUpdateUserResult);
        },
      },
    },
  }),
  createServerClient: (_token: string) => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: null },
          error: { message: 'Invalid token' },
        }),
    },
  }),
}));

vi.mock('../../../services/role-service', () => ({
  assignRole: (params: unknown) => {
    assignRoleCalls.push(params);
    return Promise.resolve(assignRoleResult);
  },
  syncRolesToAuth: (userId: string) => {
    syncRolesToAuthCalls.push(userId);
    return Promise.resolve();
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  inviteEmployee,
  deactivateEmployee,
} from '../../../services/user-management-service';
import { requireAuth } from '../../../middleware/auth';
import { requireRole } from '../../../middleware/role';

// ─── Reset State ──────────────────────────────────────────────────────────────

beforeEach(() => {
  dbSelectResult = [];
  transactionCalled = false;
  transactionRolledBack = false;
  assignRoleCalls = [];
  assignRoleResult = { data: { id: 'role-1' }, error: null, meta: null };
  supabaseInviteResult = { error: null };
  rolesSelectResult = [];
  carriersSelectResult = [];
  txInsertCalls = [];
  txUpdateCalls = [];
  supabaseUpdateUserResult = { error: null };
  syncRolesToAuthCalls = [];
  userRecordCreated = false;
  roleRecordCreated = false;
  userDeactivated = false;
  rolesRevoked = false;
  auditEntriesCreated = false;
});

// ─── Transaction Atomicity Tests ──────────────────────────────────────────────

describe('User Management Routes — Integration Tests', () => {
  describe('Transaction Atomicity: Invitation (Requirements 1.7, 1.8)', () => {
    it('when assignRole fails inside the invitation transaction, no user record is persisted', async () => {
      // Setup: email does not exist, Supabase invite succeeds
      dbSelectResult = []; // No existing user
      supabaseInviteResult = { error: null };

      // Force assignRole to fail mid-transaction — the service throws inside
      // the transaction callback, which causes the transaction to roll back
      assignRoleResult = {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Role assignment failed' },
        meta: null,
      };

      // The service throws when assignRole fails inside the transaction
      let thrownError: Error | null = null;
      try {
        await inviteEmployee({
          email: 'new@example.com',
          fullName: 'Test User',
          role: 'support_agent' as UserRole,
          scopeType: null,
          scopeId: null,
          invitedBy: 'admin-id',
          invitedByRoles: ['surewaka_admin'] as UserRole[],
        });
      } catch (e) {
        thrownError = e as Error;
      }

      // Transaction should have been called
      expect(transactionCalled).toBe(true);

      // Transaction should have rolled back (thrown error caught by tx wrapper)
      expect(transactionRolledBack).toBe(true);

      // No user record should be persisted after rollback
      expect(userRecordCreated).toBe(false);

      // The error should have propagated (transaction atomicity guarantee)
      expect(thrownError).not.toBeNull();
      expect(thrownError!.message).toContain('Role assignment failed');
    });

    it('when Supabase invitation fails, no DB transaction is started', async () => {
      // Setup: email does not exist
      dbSelectResult = [];

      // Force Supabase invite to fail
      supabaseInviteResult = { error: { message: 'Email service unavailable' } };

      const result = await inviteEmployee({
        email: 'new@example.com',
        fullName: 'Test User',
        role: 'support_agent' as UserRole,
        scopeType: null,
        scopeId: null,
        invitedBy: 'admin-id',
        invitedByRoles: ['surewaka_admin'] as UserRole[],
      });

      // Transaction should NOT have been called (fail-fast before DB)
      expect(transactionCalled).toBe(false);

      // No records should exist
      expect(userRecordCreated).toBe(false);
      expect(txInsertCalls).toHaveLength(0);

      // Error should be INVITATION_FAILED
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('INVITATION_FAILED');
      expect(result.data).toBeNull();
    });

    it('successful invitation creates user record and assigns role atomically', async () => {
      // Setup: email does not exist, Supabase invite succeeds, role assignment succeeds
      dbSelectResult = [];
      supabaseInviteResult = { error: null };
      assignRoleResult = {
        data: { id: 'role-1', role: 'support_agent', isActive: true },
        error: null,
        meta: null,
      };
      rolesSelectResult = [
        { role: 'support_agent', scopeType: null, scopeId: null },
      ];

      const result = await inviteEmployee({
        email: 'new@example.com',
        fullName: 'Test User',
        role: 'support_agent' as UserRole,
        scopeType: null,
        scopeId: null,
        invitedBy: 'admin-id',
        invitedByRoles: ['surewaka_admin'] as UserRole[],
      });

      // Transaction should have been called and NOT rolled back
      expect(transactionCalled).toBe(true);
      expect(transactionRolledBack).toBe(false);

      // User record should be created
      expect(txInsertCalls.length).toBeGreaterThan(0);

      // Result should be successful
      expect(result.error).toBeNull();
      expect(result.data).not.toBeNull();
    });
  });

  describe('Transaction Atomicity: Deactivation (Requirements 4.7)', () => {
    it('when role revocation fails mid-transaction, no changes are committed', async () => {
      // Setup: user exists with active roles
      dbSelectResult = [{ id: 'user-123' }];
      rolesSelectResult = [
        { id: 'role-1', role: 'support_agent', scopeType: null, scopeId: null },
        { id: 'role-2', role: 'carrier_admin', scopeType: 'carrier', scopeId: 'carrier-1' },
      ];

      // Override the db mock to simulate a failure during the transaction
      // We need to re-mock the transaction to throw during the role update
      const { db } = await import('@surewaka/db');
      const originalTransaction = db.transaction;

      // Temporarily override transaction to simulate failure during role revocation
      (db as { transaction: unknown }).transaction = async (
        fn: (tx: unknown) => Promise<unknown>,
      ) => {
        transactionCalled = true;
        const failingTx = {
          insert: (_table: unknown) => ({
            values: (_data: unknown) => {
              auditEntriesCreated = true;
              return {
                returning: () => Promise.resolve([{ id: 'audit-1' }]),
              };
            },
          }),
          update: (table: unknown) => ({
            set: (data: unknown) => {
              // First update (users table) succeeds
              if (!userDeactivated) {
                userDeactivated = true;
                return {
                  where: (..._args: unknown[]) => Promise.resolve(),
                };
              }
              // Second update (userRoles table) throws to simulate failure
              rolesRevoked = false;
              throw new Error('Database connection lost during role revocation');
            },
          }),
        };

        try {
          return await fn(failingTx);
        } catch (err) {
          transactionRolledBack = true;
          // Simulate rollback: reset all state
          userDeactivated = false;
          rolesRevoked = false;
          auditEntriesCreated = false;
          throw err;
        }
      };

      // Call deactivateEmployee — should fail atomically
      let error: Error | null = null;
      try {
        await deactivateEmployee({
          userId: 'user-123',
          performedBy: 'admin-456',
        });
      } catch (e) {
        error = e as Error;
      }

      // Transaction should have been attempted
      expect(transactionCalled).toBe(true);

      // Transaction should have rolled back
      expect(transactionRolledBack).toBe(true);

      // No partial state should remain after rollback
      expect(userDeactivated).toBe(false);
      expect(rolesRevoked).toBe(false);
      expect(auditEntriesCreated).toBe(false);

      // Restore original transaction
      (db as { transaction: unknown }).transaction = originalTransaction;
    });

    it('self-deactivation is rejected without starting a transaction', async () => {
      const result = await deactivateEmployee({
        userId: 'admin-123',
        performedBy: 'admin-123',
      });

      // Transaction should NOT have been called
      expect(transactionCalled).toBe(false);

      // Error should be SELF_DEACTIVATION_NOT_ALLOWED
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe('SELF_DEACTIVATION_NOT_ALLOWED');
    });

    it('successful deactivation commits all changes atomically', async () => {
      // Setup: user exists with active roles
      dbSelectResult = [{ id: 'user-123' }];
      rolesSelectResult = [
        { id: 'role-1', role: 'support_agent', scopeType: null, scopeId: null },
      ];

      const result = await deactivateEmployee({
        userId: 'user-123',
        performedBy: 'admin-456',
      });

      // Transaction should have been called and NOT rolled back
      expect(transactionCalled).toBe(true);
      expect(transactionRolledBack).toBe(false);

      // Result should be successful
      expect(result.error).toBeNull();

      // syncRolesToAuth should have been called
      expect(syncRolesToAuthCalls).toContain('user-123');
    });
  });

  describe('Middleware Chain: requireAuth + requireRole (Requirements 7.1, 7.2)', () => {
    const ENDPOINTS = [
      { method: 'POST' as const, path: '/invite' },
      { method: 'GET' as const, path: '/' },
      { method: 'GET' as const, path: '/user-123' },
      { method: 'PATCH' as const, path: '/user-123' },
      { method: 'POST' as const, path: '/user-123/deactivate' },
      { method: 'POST' as const, path: '/user-123/reactivate' },
      { method: 'GET' as const, path: '/user-123/audit-log' },
    ] as const;

    function createAppWithRealMiddleware() {
      const app = new Hono();

      // Use the real requireAuth and requireRole middleware
      app.use('*', requireAuth);
      app.use('*', requireRole('surewaka_admin'));

      // Stub handlers
      app.post('/invite', (c) => c.json({ data: 'ok' }, 201));
      app.get('/', (c) => c.json({ data: [] }, 200));
      app.get('/:userId', (c) => c.json({ data: 'ok' }, 200));
      app.patch('/:userId', (c) => c.json({ data: 'ok' }, 200));
      app.post('/:userId/deactivate', (c) => c.json({ data: 'ok' }, 200));
      app.post('/:userId/reactivate', (c) => c.json({ data: 'ok' }, 200));
      app.get('/:userId/audit-log', (c) => c.json({ data: [] }, 200));

      return app;
    }

    function createAppWithMockAuth(userRoles: UserRole[]) {
      const app = new Hono();

      // Mock requireAuth — sets user on context
      const mockAuth = createMiddleware(async (c, next) => {
        const mockUser: AuthUser = {
          id: 'mock-user-id',
          email: 'admin@example.com',
          user_metadata: { name: 'Admin User' },
          app_metadata: { roles: userRoles },
        };
        c.set('user', mockUser);
        c.set('accessToken', 'mock-token');
        await next();
      });

      app.use('*', mockAuth);
      app.use('*', requireRole('surewaka_admin'));

      // Stub handlers
      app.post('/invite', (c) => c.json({ data: 'ok' }, 201));
      app.get('/', (c) => c.json({ data: [] }, 200));
      app.get('/:userId', (c) => c.json({ data: 'ok' }, 200));
      app.patch('/:userId', (c) => c.json({ data: 'ok' }, 200));
      app.post('/:userId/deactivate', (c) => c.json({ data: 'ok' }, 200));
      app.post('/:userId/reactivate', (c) => c.json({ data: 'ok' }, 200));
      app.get('/:userId/audit-log', (c) => c.json({ data: [] }, 200));

      return app;
    }

    it('unauthenticated requests (no token) get 401 on all endpoints', async () => {
      const app = createAppWithRealMiddleware();

      for (const endpoint of ENDPOINTS) {
        const requestInit: RequestInit = {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' },
        };

        if (endpoint.method === 'POST' || endpoint.method === 'PATCH') {
          requestInit.body = JSON.stringify({});
        }

        const res = await app.request(endpoint.path, requestInit);

        expect(res.status).toBe(401);

        const body = await res.json();
        expect(body.error).not.toBeNull();
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(body.data).toBeNull();
      }
    });

    it('authenticated non-admin requests get 403 on all endpoints', async () => {
      const app = createAppWithMockAuth(['customer']);

      for (const endpoint of ENDPOINTS) {
        const requestInit: RequestInit = {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' },
        };

        if (endpoint.method === 'POST' || endpoint.method === 'PATCH') {
          requestInit.body = JSON.stringify({});
        }

        const res = await app.request(endpoint.path, requestInit);

        expect(res.status).toBe(403);

        const body = await res.json();
        expect(body.error).not.toBeNull();
        expect(body.error.code).toBe('FORBIDDEN');
        expect(body.data).toBeNull();
      }
    });

    it('authenticated admin requests pass middleware and reach handlers', async () => {
      const app = createAppWithMockAuth(['surewaka_admin']);

      // Test GET / endpoint as representative
      const res = await app.request('/', { method: 'GET' });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).not.toBeNull();
      expect(body.error).toBeUndefined();
    });

    it('requests with invalid token get 401', async () => {
      const app = createAppWithRealMiddleware();

      const res = await app.request('/', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer invalid-token-xyz',
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('requests with malformed Authorization header get 401', async () => {
      const app = createAppWithRealMiddleware();

      const res = await app.request('/', {
        method: 'GET',
        headers: {
          Authorization: 'Basic dXNlcjpwYXNz',
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('carrier_admin role without surewaka_admin gets 403', async () => {
      const app = createAppWithMockAuth(['carrier_admin']);

      for (const endpoint of ENDPOINTS) {
        const requestInit: RequestInit = {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' },
        };

        if (endpoint.method === 'POST' || endpoint.method === 'PATCH') {
          requestInit.body = JSON.stringify({});
        }

        const res = await app.request(endpoint.path, requestInit);
        expect(res.status).toBe(403);
      }
    });

    it('multiple non-admin roles still get 403', async () => {
      const app = createAppWithMockAuth(['customer', 'carrier_driver', 'support_agent']);

      const res = await app.request('/', { method: 'GET' });

      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });
});
