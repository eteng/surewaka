// Feature: rbac-system
// Unit tests for role middleware edge cases
// Validates: Requirements 2.1, 2.2, 2.5

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { USER_ROLES, type UserRole } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import { requireRole } from '../middleware/role';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockUser(appMetadata: SupabaseUser['app_metadata']): SupabaseUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test@surewaka.com',
    user_metadata: { name: 'Test User' },
    app_metadata: appMetadata,
  };
}

function createTestApp(requiredRoles: UserRole[], user: SupabaseUser) {
  const app = new Hono();

  // Simulate requireAuth — sets user on context
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });

  // Apply role middleware
  app.use('*', requireRole(...requiredRoles));

  // Test handler that returns userRoles from context
  app.get('/test', (c) => {
    const userRoles = c.get('userRoles');
    return c.json({ data: 'ok', error: null, meta: null, userRoles });
  });

  return app;
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('Role Middleware — Edge Cases', () => {
  describe('Missing roles in JWT defaults to [customer]', () => {
    it('user with no roles field in app_metadata defaults to customer', async () => {
      const user = createMockUser({});
      const app = createTestApp(['customer'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userRoles).toEqual(['customer']);
    });

    it('user with undefined roles in app_metadata defaults to customer', async () => {
      const user = createMockUser({ roles: undefined });
      const app = createTestApp(['customer'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userRoles).toEqual(['customer']);
    });

    it('user with no app_metadata.roles gets 403 for non-customer routes', async () => {
      const user = createMockUser({});
      const app = createTestApp(['driver'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(403);
    });
  });

  describe('Empty roles array defaults to [customer]', () => {
    it('user with empty roles array defaults to customer', async () => {
      const user = createMockUser({ roles: [] });
      const app = createTestApp(['customer'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userRoles).toEqual(['customer']);
    });

    it('user with empty roles array gets 403 for non-customer routes', async () => {
      const user = createMockUser({ roles: [] });
      const app = createTestApp(['carrier_admin'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Multiple required roles (OR logic)', () => {
    it('user with first of multiple required roles gets access', async () => {
      const user = createMockUser({ roles: ['driver'] });
      const app = createTestApp(['driver', 'carrier_admin'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
    });

    it('user with second of multiple required roles gets access', async () => {
      const user = createMockUser({ roles: ['carrier_admin'] });
      const app = createTestApp(['driver', 'carrier_admin'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
    });

    it('user with none of the multiple required roles gets 403', async () => {
      const user = createMockUser({ roles: ['customer'] });
      const app = createTestApp(['driver', 'carrier_admin'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('user with one matching role among many required roles gets access (OR not AND)', async () => {
      const user = createMockUser({ roles: ['support_agent'] });
      const app = createTestApp(['driver', 'carrier_admin', 'support_agent'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
    });
  });

  describe('Middleware ordering enforcement', () => {
    it('middleware sets userRoles on context for downstream handlers', async () => {
      const user = createMockUser({ roles: ['driver', 'customer'] });
      const app = createTestApp(['driver'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userRoles).toEqual(['driver', 'customer']);
    });

    it('middleware requires user to be set on context (simulating requireAuth ran first)', async () => {
      const app = new Hono();

      // Do NOT set user on context — simulates requireAuth not running
      app.use('*', requireRole('customer'));
      app.get('/test', (c) => c.json({ data: 'ok' }));

      const res = await app.request('/test');

      // Without user set, accessing user.app_metadata will throw
      expect(res.status).toBe(500);
    });

    it('userRoles defaults to [customer] even when middleware allows access', async () => {
      const user = createMockUser({ roles: undefined });
      const app = createTestApp(['customer'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const body = await res.json();
      // Downstream handler can read the defaulted roles
      expect(body.userRoles).toEqual(['customer']);
    });
  });

  describe('403 response shape', () => {
    it('returns correct error shape { data: null, error: { code: FORBIDDEN }, meta: null }', async () => {
      const user = createMockUser({ roles: ['customer'] });
      const app = createTestApp(['surewaka_admin'], user);

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
    });

    it('error message lists the required roles', async () => {
      const user = createMockUser({ roles: ['customer'] });
      const app = createTestApp(['driver', 'carrier_admin'], user);

      const res = await app.request('/test');

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain('driver');
      expect(body.error.message).toContain('carrier_admin');
    });
  });
});
