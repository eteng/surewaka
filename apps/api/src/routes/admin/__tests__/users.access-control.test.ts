// Feature: admin-user-management
// Property 16: Access control rejects non-admin users
//
// For any authenticated user without surewaka_admin role, ALL user management
// endpoints SHALL return HTTP 403 with FORBIDDEN.
//
// **Validates: Requirements 7.1, 7.3**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { UserRole } from '@surewaka/shared';
import { USER_ROLES } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { requireRole } from '../../../middleware/role';

// ─── Constants ────────────────────────────────────────────────────────────────

const NON_ADMIN_ROLES = USER_ROLES.filter((r) => r !== 'surewaka_admin') as UserRole[];

// All user management endpoints to test
const ENDPOINTS = [
  { method: 'POST' as const, path: '/invite' },
  { method: 'GET' as const, path: '/' },
  { method: 'GET' as const, path: '/test-user-id-123' },
  { method: 'PATCH' as const, path: '/test-user-id-123' },
  { method: 'POST' as const, path: '/test-user-id-123/deactivate' },
  { method: 'POST' as const, path: '/test-user-id-123/reactivate' },
  { method: 'GET' as const, path: '/test-user-id-123/audit-log' },
] as const;

// ─── Test App Factory ─────────────────────────────────────────────────────────

/**
 * Creates a test Hono app with a mock auth middleware that sets the user
 * with the given roles, followed by the real requireRole('surewaka_admin')
 * middleware. Handlers are stubs that return 200 (they should never be reached
 * when access is denied).
 */
function createTestApp(userRoles: UserRole[]) {
  const app = new Hono();

  // Mock requireAuth — sets user on context with the specified roles
  const mockAuth = createMiddleware(async (c, next) => {
    const mockUser: AuthUser = {
      id: 'mock-user-id',
      email: 'test@example.com',
      user_metadata: { name: 'Test User' },
      app_metadata: { roles: userRoles },
    };
    c.set('user', mockUser);
    c.set('accessToken', 'mock-token');
    await next();
  });

  // Apply mock auth + real role middleware
  app.use('*', mockAuth);
  app.use('*', requireRole('surewaka_admin'));

  // Stub handlers — should never be reached for non-admin users
  app.post('/invite', (c) => c.json({ data: 'ok' }, 201));
  app.get('/', (c) => c.json({ data: [] }, 200));
  app.get('/:userId', (c) => c.json({ data: 'ok' }, 200));
  app.patch('/:userId', (c) => c.json({ data: 'ok' }, 200));
  app.post('/:userId/deactivate', (c) => c.json({ data: 'ok' }, 200));
  app.post('/:userId/reactivate', (c) => c.json({ data: 'ok' }, 200));
  app.get('/:userId/audit-log', (c) => c.json({ data: [] }, 200));

  return app;
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a single non-admin role */
const nonAdminRoleArb = fc.constantFrom(...NON_ADMIN_ROLES);

/** Arbitrary for an array of non-admin roles (1-3 roles, none being surewaka_admin) */
const nonAdminRolesArrayArb = fc
  .array(nonAdminRoleArb, { minLength: 1, maxLength: 3 })
  .map((roles) => [...new Set(roles)] as UserRole[]);

/** Arbitrary for endpoint selection */
const endpointArb = fc.constantFrom(...ENDPOINTS);

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('User Management Routes — Access Control Property Tests', () => {
  describe('Property 16: Access control rejects non-admin users', () => {
    // **Validates: Requirements 7.1, 7.3**

    it('for any authenticated user without surewaka_admin role, ALL user management endpoints return HTTP 403 with FORBIDDEN', async () => {
      await fc.assert(
        fc.asyncProperty(
          nonAdminRolesArrayArb,
          endpointArb,
          async (roles, endpoint) => {
            const app = createTestApp(roles);

            const requestInit: RequestInit = {
              method: endpoint.method,
              headers: { 'Content-Type': 'application/json' },
            };

            // Add body for POST/PATCH requests
            if (endpoint.method === 'POST' || endpoint.method === 'PATCH') {
              requestInit.body = JSON.stringify({});
            }

            const res = await app.request(endpoint.path, requestInit);

            // Must return 403
            expect(res.status).toBe(403);

            // Must return FORBIDDEN error code
            const body = await res.json();
            expect(body.error).not.toBeNull();
            expect(body.error.code).toBe('FORBIDDEN');
            expect(body.data).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any single non-admin role, all 7 endpoints are blocked', async () => {
      await fc.assert(
        fc.asyncProperty(nonAdminRoleArb, async (role) => {
          const app = createTestApp([role]);

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
            expect(body.error.code).toBe('FORBIDDEN');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('users with empty roles array (defaulting to customer) are rejected', async () => {
      const app = createTestApp([]);

      for (const endpoint of ENDPOINTS) {
        const requestInit: RequestInit = {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' },
        };

        if (endpoint.method === 'POST' || endpoint.method === 'PATCH') {
          requestInit.body = JSON.stringify({});
        }

        const res = await app.request(endpoint.path, requestInit);

        // Empty roles defaults to ['customer'] in the middleware, which is not surewaka_admin
        expect(res.status).toBe(403);

        const body = await res.json();
        expect(body.error.code).toBe('FORBIDDEN');
      }
    });

    it('surewaka_admin role grants access (positive control)', async () => {
      const app = createTestApp(['surewaka_admin']);

      // Test just one endpoint to confirm admin access works
      const res = await app.request('/', { method: 'GET' });

      // Should NOT be 403 — admin has access
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
    });
  });
});
