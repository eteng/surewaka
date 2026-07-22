---
description: How to mock auth in API route tests — three patterns with examples
inclusion: fileMatch
fileMatchPattern: "apps/api/src/**/*.test.ts"
---

# Auth Mock Patterns for API Tests

All auth mock utilities live in `apps/api/src/test-utils/auth-mock.ts`.
**Import from there — never copy-paste auth setup into a new test file.**

---

## Which pattern to use

| Goal | Pattern | Key indicator |
|---|---|---|
| Test 401 / 403 auth rejection | **A — verifyToken mock** | The test asserts on `UNAUTHORIZED` or `FORBIDDEN` error codes |
| Test route handler logic, auth always passes | **B — middleware stub** | Only one user type needed for the whole file |
| Test role-based access, multiple user types | **C — mutable stub** | Different user types needed per test case |

---

## Pattern A — Testing auth middleware itself (401/403)

Use when the test verifies that unauthenticated or insufficiently-privileged requests are rejected.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { personas, makeDbSelectChain, resetDbSelectChain, asUser, asUnauthenticated } from '../test-utils/auth-mock';

// ── Mock setup ────────────────────────────────────────────────────────────────
const mockVerifyToken = vi.fn();
const mockDbSelect = makeDbSelectChain('user-uuid-here');

vi.mock('@surewaka/auth', () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));
vi.mock('@surewaka/db', () => ({
  db: { select: vi.fn(() => mockDbSelect) },
  users: 'users',
  eq: vi.fn(),
  // add other exported tables/functions the route imports
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetDbSelectChain(mockDbSelect, 'user-uuid-here');
});

// ── Tests ─────────────────────────────────────────────────────────────────────
it('returns 401 when token is missing', async () => {
  // no mockVerifyToken setup → header check fails before verifyToken is called
  const res = await app.request('/api/v1/...');
  expect(res.status).toBe(401);
});

it('returns 401 when token is invalid', async () => {
  asUnauthenticated(mockVerifyToken);
  const res = await app.request('/api/v1/...', { headers: { Authorization: 'Bearer bad' } });
  expect(res.status).toBe(401);
});

it('returns 403 for a customer', async () => {
  asUser(mockVerifyToken, 'customer');
  const res = await app.request('/api/v1/...', { headers: { Authorization: 'Bearer tok' } });
  expect(res.status).toBe(403);
});

it('returns 200 for an admin', async () => {
  asUser(mockVerifyToken, 'admin');
  // ...
});
```

**`makeDbSelectChain(userId)`** — creates the chainable `from().where().limit()` mock that `requireAuth` uses to look up the internal user UUID. Pass the UUID the route handler should see as `c.get('user').id`.

**`resetDbSelectChain(chain, userId)`** — call in `beforeEach` after `vi.clearAllMocks()` to restore the chain after mocks are cleared.

**`asUser(mockFn, persona)`** — sets `mockVerifyToken.mockResolvedValue(...)`. Accepts a persona name (`'admin'`, `'customer'`, `'driver'`, `'carrierAgent'`) or a full `AuthUser` object.

**`asUnauthenticated(mockFn)`** — resolves to `null` (invalid token).

---

## Pattern B — Stubbing auth entirely (route logic tests)

Use when auth behavior isn't being tested — only the route handler logic. Auth always passes with a fixed user.

```ts
import { stubAuthModule, personas } from '../test-utils/auth-mock';

vi.mock('../middleware/auth', () => stubAuthModule(personas.admin()));
vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));
```

**Important:** If the test file calls `vi.resetModules()` (e.g., in a `createApp()` helper), use an async dynamic import to avoid stale closure errors:

```ts
// Use this form when vi.resetModules() is called anywhere in the file
vi.mock('../middleware/auth', async () => {
  const { stubAuthModule, personas } = await import('../test-utils/auth-mock');
  return stubAuthModule(personas.admin());
});
```

Choose the persona that matches the route's required role. `personas.admin()` for admin routes, `personas.driver()` for driver routes, etc.

---

## Pattern C — Per-test user switching (mutable stub)

Use when a single test file needs to check behavior under different user roles.

```ts
import { createMutableAuthStub } from '../test-utils/auth-mock';

const auth = createMutableAuthStub('admin'); // default user
vi.mock('../middleware/auth', () => auth.module);

it('allows admin', async () => {
  auth.as('admin');
  // ...
});

it('rejects customer', async () => {
  auth.as('customer');
  const res = await app.request('...');
  expect(res.status).toBe(403);
});

it('uses a custom carrier agent', async () => {
  auth.as(personas.carrierAgent('my-carrier-id'));
  // ...
});
```

---

## Available personas

```ts
personas.admin()          // { id: 'user-admin-id', roles: ['surewaka_admin'], ... }
personas.customer()       // { id: 'user-customer-id', roles: ['customer'], ... }
personas.driver()         // { id: 'user-driver-id', roles: ['driver'], ... }
personas.carrierAgent(carrierId?)  // { id: 'user-carrier-agent-id', roles: ['carrier_agent'], carrierId, ... }
```

All return a full `AuthUser` shape. For one-off shapes, pass a custom object to `asUser()` or `createMutableAuthStub()`.

---

## Files that intentionally don't use the helper

- `zone-routes.test.ts` — uses a stateful `mockIsAuthenticated` toggle to test both authenticated and unauthenticated paths in the same file; `createMutableAuthStub` doesn't model explicit 401 rejection
- `users.access-control.test.ts` — passes `UserRole[]` to `createTestApp(userRoles)` for property-based role testing; inline `createMiddleware` is the right tool here
- `users.test.ts` — some describe blocks use the real `requireAuth` middleware to verify middleware wiring; can't stub it away

Service-layer tests (`role-service`, `carrier-vetting-service`, `user-management-service`) mock `@surewaka/auth` for `getClerkClient`, not for `verifyToken`/personas — they don't need this helper.
