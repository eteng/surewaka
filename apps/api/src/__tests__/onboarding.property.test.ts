// Feature: rbac-system
// Property 10: Onboarding Postconditions — valid onboarding atomically produces
// role record + carrier_members + audit log
// **Validates: Requirements 5.2, 5.3, 7.1**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Mock State (global for mock factory access) ─────────────────────────────

// Using globalThis to share state between hoisted mock factory and test code
const STATE_KEY = '__onboarding_test_state__';

type TestState = {
  userRolesInserts: unknown[];
  carrierMembersInserts: unknown[];
  auditLogInserts: unknown[];
  usersInserts: unknown[];
  existingUserResult: unknown[];
};

function getState(): TestState {
  if (!(globalThis as Record<string, unknown>)[STATE_KEY]) {
    (globalThis as Record<string, unknown>)[STATE_KEY] = {
      userRolesInserts: [],
      carrierMembersInserts: [],
      auditLogInserts: [],
      usersInserts: [],
      existingUserResult: [],
    };
  }
  return (globalThis as Record<string, unknown>)[STATE_KEY] as TestState;
}

function resetState(): void {
  const state = getState();
  state.userRolesInserts = [];
  state.carrierMembersInserts = [];
  state.auditLogInserts = [];
  state.usersInserts = [];
  state.existingUserResult = [];
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  and: (...conditions: unknown[]) => ({ conditions, op: 'and' }),
}));

vi.mock('@surewaka/db', () => {
  const _usersTable = {
    id: 'id',
    phone: 'phone',
    name: 'name',
    email: 'email',
  };
  const _userRolesTable = {
    userId: 'userId',
    role: 'role',
    isActive: 'isActive',
    scopeId: 'scopeId',
    scopeType: 'scopeType',
  };
  const _carrierMembersTable = {
    carrierId: 'carrierId',
    userId: 'userId',
    role: 'role',
    isActive: 'isActive',
  };
  const _roleAuditLogTable = { __table: 'roleAuditLog' };

  const STATE_KEY = '__onboarding_test_state__';
  function _getState() {
    if (!(globalThis as Record<string, unknown>)[STATE_KEY]) {
      (globalThis as Record<string, unknown>)[STATE_KEY] = {
        userRolesInserts: [],
        carrierMembersInserts: [],
        auditLogInserts: [],
        usersInserts: [],
        existingUserResult: [],
      };
    }
    return (globalThis as Record<string, unknown>)[STATE_KEY] as {
      userRolesInserts: unknown[];
      carrierMembersInserts: unknown[];
      auditLogInserts: unknown[];
      usersInserts: unknown[];
      existingUserResult: unknown[];
    };
  }

  const createTx = () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(_getState().existingUserResult),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (data: unknown) => {
        const state = _getState();
        if (table === _userRolesTable) {
          state.userRolesInserts.push(data);
        } else if (table === _carrierMembersTable) {
          state.carrierMembersInserts.push(data);
        } else if (table === _roleAuditLogTable) {
          state.auditLogInserts.push(data);
        } else if (table === _usersTable) {
          state.usersInserts.push(data);
        }
        return {
          returning: () => {
            if (table === _usersTable) {
              const d = data as Record<string, unknown>;
              return Promise.resolve([{
                id: crypto.randomUUID(),
                phone: d.phone,
                name: d.name,
                email: d.email,
                role: 'customer',
                verified: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              }]);
            }
            if (table === _userRolesTable) {
              const d = data as Record<string, unknown>;
              return Promise.resolve([{
                id: crypto.randomUUID(),
                userId: d.userId,
                role: d.role,
                scopeType: d.scopeType,
                scopeId: d.scopeId,
                assignedBy: d.assignedBy,
                assignedAt: new Date(),
                revokedAt: null,
                isActive: true,
              }]);
            }
            return Promise.resolve([{ id: crypto.randomUUID(), ...(data as object) }]);
          },
        };
      },
    }),
  });

  return {
    db: {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback(createTx());
      },
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    },
    users: _usersTable,
    userRoles: _userRolesTable,
    carrierMembers: _carrierMembersTable,
    roleAuditLog: _roleAuditLogTable,
  };
});

vi.mock('@surewaka/supabase', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        updateUserById: () => Promise.resolve({ error: null }),
      },
    },
  }),
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../middleware/carrier-scope', () => ({
  requireCarrierScope: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../services/role-service', () => ({
  syncRolesToAuth: vi.fn(() => Promise.resolve()),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import carrierRoutes from '../routes/carriers';
import { Hono } from 'hono';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arbitrary for valid Nigerian phone numbers (+234 followed by 10 digits) */
const nigerianPhoneArb = fc
  .tuple(
    fc.constantFrom('7', '8', '9'),
    fc.stringMatching(/^\d{9}$/)
  )
  .map(([first, rest]) => `+234${first}${rest}`);

/** Arbitrary for valid full names (2-100 chars, alphabetic with spaces) */
const fullNameArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,20}$/),
    fc.stringMatching(/^[a-z]{2,20}$/)
  )
  .map(([first, last]) => `${first.charAt(0).toUpperCase()}${first.slice(1)} ${last.charAt(0).toUpperCase()}${last.slice(1)}`);

/** Arbitrary for valid UUIDs */
const uuidArb = fc.uuid();

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 10: Onboarding Postconditions — valid onboarding atomically produces role record + carrier_members + audit log', () => {
  let app: Hono;

  beforeEach(() => {
    resetState();

    app = new Hono();
    // Mount carrier routes and set up user context
    app.use('*', async (c, next) => {
      // Simulate authenticated carrier_admin user
      c.set('user' as never, {
        id: crypto.randomUUID(),
        app_metadata: { roles: ['carrier_admin'] },
      });
      c.set('userRoles' as never, ['carrier_admin']);
      c.set('carrierMembership' as never, { id: crypto.randomUUID() });
      await next();
    });
    app.route('/', carrierRoutes);
  });

  it('valid onboarding produces a user_roles record with role=carrier_driver, scopeType=carrier, scopeId=carrierId', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        nigerianPhoneArb,
        fullNameArb,
        async (carrierId, phone, fullName) => {
          resetState();

          const req = new Request(
            `http://localhost/carriers/${carrierId}/drivers/invite`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, fullName }),
            }
          );

          const res = await app.request(req);
          const state = getState();

          // Precondition: request succeeded
          fc.pre(res.status === 201);

          // Postcondition 1: user_roles record created with correct fields
          expect(state.userRolesInserts.length).toBeGreaterThanOrEqual(1);
          const roleInsert = state.userRolesInserts[0] as Record<string, unknown>;
          expect(roleInsert.role).toBe('carrier_driver');
          expect(roleInsert.scopeType).toBe('carrier');
          expect(roleInsert.scopeId).toBe(carrierId);
        }
      ),
      { numRuns: 100 },
    );
  });

  it('valid onboarding produces a carrier_members record with carrierId, userId, role=carrier_driver', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        nigerianPhoneArb,
        fullNameArb,
        async (carrierId, phone, fullName) => {
          resetState();

          const req = new Request(
            `http://localhost/carriers/${carrierId}/drivers/invite`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, fullName }),
            }
          );

          const res = await app.request(req);
          const state = getState();

          // Precondition: request succeeded
          fc.pre(res.status === 201);

          // Postcondition 2: carrier_members record created with correct fields
          expect(state.carrierMembersInserts.length).toBeGreaterThanOrEqual(1);
          const memberInsert = state.carrierMembersInserts[0] as Record<string, unknown>;
          expect(memberInsert.carrierId).toBe(carrierId);
          expect(memberInsert.role).toBe('carrier_driver');
          // userId should be set (from the created/found user)
          expect(memberInsert.userId).toBeDefined();
          expect(typeof memberInsert.userId).toBe('string');
        }
      ),
      { numRuns: 100 },
    );
  });

  it('valid onboarding produces a role_audit_log entry with action=assigned, role=carrier_driver, scopeType=carrier, scopeId=carrierId', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        nigerianPhoneArb,
        fullNameArb,
        async (carrierId, phone, fullName) => {
          resetState();

          const req = new Request(
            `http://localhost/carriers/${carrierId}/drivers/invite`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, fullName }),
            }
          );

          const res = await app.request(req);
          const state = getState();

          // Precondition: request succeeded
          fc.pre(res.status === 201);

          // Postcondition 3: audit log entry created with correct fields
          expect(state.auditLogInserts.length).toBeGreaterThanOrEqual(1);
          const auditInsert = state.auditLogInserts[0] as Record<string, unknown>;
          expect(auditInsert.action).toBe('assigned');
          expect(auditInsert.role).toBe('carrier_driver');
          expect(auditInsert.scopeType).toBe('carrier');
          expect(auditInsert.scopeId).toBe(carrierId);
          // performedBy should be set (the carrier_admin who invited)
          expect(auditInsert.performedBy).toBeDefined();
          expect(typeof auditInsert.performedBy).toBe('string');
        }
      ),
      { numRuns: 100 },
    );
  });

  it('valid onboarding atomically produces ALL three records together', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        nigerianPhoneArb,
        fullNameArb,
        async (carrierId, phone, fullName) => {
          resetState();

          const req = new Request(
            `http://localhost/carriers/${carrierId}/drivers/invite`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, fullName }),
            }
          );

          const res = await app.request(req);
          const state = getState();

          // Precondition: request succeeded
          fc.pre(res.status === 201);

          // Postcondition: ALL three records must exist together (atomicity)
          expect(state.userRolesInserts.length).toBe(1);
          expect(state.carrierMembersInserts.length).toBe(1);
          expect(state.auditLogInserts.length).toBe(1);

          // Verify consistency: all records reference the same user
          const roleInsert = state.userRolesInserts[0] as Record<string, unknown>;
          const memberInsert = state.carrierMembersInserts[0] as Record<string, unknown>;
          const auditInsert = state.auditLogInserts[0] as Record<string, unknown>;

          expect(roleInsert.userId).toBe(memberInsert.userId);
          expect(roleInsert.userId).toBe(auditInsert.userId);

          // Verify consistency: all records reference the same carrier
          expect(roleInsert.scopeId).toBe(carrierId);
          expect(memberInsert.carrierId).toBe(carrierId);
          expect(auditInsert.scopeId).toBe(carrierId);
        }
      ),
      { numRuns: 100 },
    );
  });
});
