/**
 * Auth test helpers — three patterns:
 *
 * Pattern A: Testing auth middleware itself (401/403 cases)
 *   - Mock @surewaka/auth and @surewaka/db manually in the test file
 *   - Use makeDbSelectChain(), resetDbSelectChain(), and asUser() from here
 *
 * Pattern B: Stubbing auth entirely (route logic tests)
 *   - vi.mock('../middleware/auth', () => stubAuthModule(personas.admin()))
 *   - Auth always passes; user is fixed for the whole test file
 *
 * Pattern C: Per-test user switching with a mutable stub
 *   - const auth = createMutableAuthStub()
 *   - vi.mock('../middleware/auth', () => auth.module)
 *   - auth.as('customer') in individual tests
 */

import { vi } from 'vitest';
import { createMiddleware } from 'hono/factory';
import type { AuthUser } from '@surewaka/auth';

// ── Personas ──────────────────────────────────────────────────────────────────

export const personas = {
  admin: (): AuthUser => ({
    id: 'user-admin-id',
    clerkId: 'clerk_admin_123',
    email: 'admin@surewaka.com',
    roles: ['surewaka_admin'],
    role: 'surewaka_admin',
  }),
  customer: (): AuthUser => ({
    id: 'user-customer-id',
    clerkId: 'clerk_customer_123',
    email: 'customer@example.com',
    roles: ['customer'],
    role: 'customer',
  }),
  driver: (): AuthUser => ({
    id: 'user-driver-id',
    clerkId: 'clerk_driver_123',
    email: 'driver@example.com',
    roles: ['driver'],
    role: 'driver',
  }),
  carrierAgent: (carrierId = 'carrier-test-id'): AuthUser => ({
    id: 'user-carrier-agent-id',
    clerkId: 'clerk_carrier_agent_123',
    email: 'agent@carrier.com',
    roles: ['carrier_agent'],
    role: 'carrier_agent',
    carrierId,
  }),
};

export type PersonaName = keyof typeof personas;

// ── Pattern A helpers ─────────────────────────────────────────────────────────

export type DbSelectChain = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

/**
 * Returns a fresh chainable Drizzle select mock for the requireAuth DB lookup.
 * Assign the result to a module-level const, then pass to vi.mock:
 *
 *   const mockDbSelect = makeDbSelectChain();
 *   vi.mock('@surewaka/db', () => ({ db: { select: vi.fn(() => mockDbSelect) }, users: 'users', eq: vi.fn() }));
 */
export function makeDbSelectChain(userId = 'user-admin-id'): DbSelectChain {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ id: userId }]),
  };
}

/**
 * Restores the chainable mock after vi.clearAllMocks() wipes return values.
 * Call in beforeEach, after vi.clearAllMocks():
 *
 *   beforeEach(() => { vi.clearAllMocks(); resetDbSelectChain(mockDbSelect); });
 */
export function resetDbSelectChain(chain: DbSelectChain, userId = 'user-admin-id'): void {
  chain.from.mockReturnThis();
  chain.where.mockReturnThis();
  chain.limit.mockResolvedValue([{ id: userId }]);
}

/**
 * Sets mockVerifyToken to resolve with a persona or a custom AuthUser.
 *
 *   asUser(mockVerifyToken, 'admin');
 *   asUser(mockVerifyToken, personas.carrierAgent('my-carrier-id'));
 */
export function asUser(
  mockVerifyToken: ReturnType<typeof vi.fn>,
  userOrPersona: AuthUser | PersonaName,
): void {
  const user = typeof userOrPersona === 'string' ? personas[userOrPersona]() : userOrPersona;
  mockVerifyToken.mockResolvedValue(user);
}

/** Sets mockVerifyToken to return null — simulates a missing/invalid token. */
export function asUnauthenticated(mockVerifyToken: ReturnType<typeof vi.fn>): void {
  mockVerifyToken.mockResolvedValue(null);
}

// ── Pattern B: fixed user stub ────────────────────────────────────────────────

/**
 * Returns a mock auth module where auth always passes with a fixed user.
 * Use when the test doesn't care about auth — just wants a user in context:
 *
 *   vi.mock('../middleware/auth', () => stubAuthModule(personas.admin()));
 */
export function stubAuthModule(user: AuthUser) {
  return {
    requireAuth: createMiddleware(async (c, next) => {
      c.set('user', user);
      c.set('accessToken', 'test-token');
      await next();
    }),
    requireClerkAuth: createMiddleware(async (c, next) => {
      c.set('clerkId', user.clerkId);
      c.set('clerkEmail', user.email);
      c.set('clerkPhone', user.phone);
      c.set('clerkName', user.name);
      c.set('accessToken', 'test-token');
      await next();
    }),
    optionalAuth: createMiddleware(async (c, next) => {
      c.set('user', user);
      c.set('accessToken', 'test-token');
      await next();
    }),
  };
}

// ── Pattern C: mutable stub (per-test user switching) ────────────────────────

type MutableAuthStub = {
  /** The mock module to pass as the vi.mock factory return value. */
  module: ReturnType<typeof stubAuthModule>;
  /** Switch the active user for subsequent requests in the same test. */
  as(userOrPersona: AuthUser | PersonaName): void;
};

/**
 * Creates a mutable auth stub where the user can be changed per-test.
 * Use when a single test file needs multiple user types:
 *
 *   const auth = createMutableAuthStub();
 *   vi.mock('../middleware/auth', () => auth.module);
 *
 *   it('allows admin', () => { auth.as('admin'); ... });
 *   it('rejects customer', () => { auth.as('customer'); ... });
 */
export function createMutableAuthStub(initial: AuthUser | PersonaName = 'admin'): MutableAuthStub {
  let current: AuthUser =
    typeof initial === 'string' ? personas[initial]() : initial;

  const module = {
    requireAuth: createMiddleware(async (c, next) => {
      c.set('user', current);
      c.set('accessToken', 'test-token');
      await next();
    }),
    requireClerkAuth: createMiddleware(async (c, next) => {
      c.set('clerkId', current.clerkId);
      c.set('clerkEmail', current.email);
      c.set('clerkPhone', current.phone);
      c.set('clerkName', current.name);
      c.set('accessToken', 'test-token');
      await next();
    }),
    optionalAuth: createMiddleware(async (c, next) => {
      c.set('user', current);
      c.set('accessToken', 'test-token');
      await next();
    }),
  };

  return {
    module,
    as(userOrPersona: AuthUser | PersonaName) {
      current = typeof userOrPersona === 'string' ? personas[userOrPersona]() : userOrPersona;
    },
  };
}
