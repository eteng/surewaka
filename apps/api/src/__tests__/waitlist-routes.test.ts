// Feature: waitlist-admin
// Unit tests for API route auth and validation
// Requirements: 1.4, 1.5, 3.3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { personas, makeDbSelectChain, resetDbSelectChain, asUser } from '../test-utils/auth-mock';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
const mockDbSelect = makeDbSelectChain('admin-user-id');

vi.mock('@surewaka/auth', () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));

vi.mock('@surewaka/db', () => ({
  db: { select: vi.fn(() => mockDbSelect) },
  users: 'users',
  eq: vi.fn(),
}));

const mockListWaitlistSignups = vi.fn();
const mockGetWaitlistStats = vi.fn();

vi.mock('../services/waitlist-service', () => ({
  listWaitlistSignups: (...args: unknown[]) => mockListWaitlistSignups(...args),
  getWaitlistStats: (...args: unknown[]) => mockGetWaitlistStats(...args),
}));

// ─── Test App Setup ──────────────────────────────────────────────────────────

async function createTestApp() {
  const waitlistModule = await import('../routes/admin/waitlist');
  const app = new Hono();
  app.route('/api/v1/admin/waitlist', waitlistModule.default);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Waitlist Admin Routes — Auth & Validation', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbSelectChain(mockDbSelect, 'admin-user-id');
    app = await createTestApp();
  });

  describe('Authentication (401)', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await app.request('/api/v1/admin/waitlist');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header has no Bearer prefix', async () => {
      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Basic some-token' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token is invalid/expired', async () => {
      mockVerifyToken.mockResolvedValue(null);

      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer expired-token' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when verifyToken returns null (no user)', async () => {
      mockVerifyToken.mockResolvedValue(null);

      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer invalid-token' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Authorization (403)', () => {
    it('returns 403 for a user with customer role', async () => {
      asUser(mockVerifyToken, 'customer');

      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer valid-customer-token' },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 for a user with driver role', async () => {
      asUser(mockVerifyToken, 'driver');

      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer valid-driver-token' },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 for a user with no roles', async () => {
      asUser(mockVerifyToken, { id: 'user-norole-id', clerkId: 'no-role_clerk_123', email: 'norole@example.com', roles: [] });

      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer valid-norole-token' },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Validation (400)', () => {
    beforeEach(() => {
      asUser(mockVerifyToken, 'admin');
    });

    it('returns 400 for invalid userType query param', async () => {
      const res = await app.request('/api/v1/admin/waitlist?userType=invalid_type', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when pageSize exceeds 100', async () => {
      const res = await app.request('/api/v1/admin/waitlist?pageSize=101', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when pageSize is 0', async () => {
      const res = await app.request('/api/v1/admin/waitlist?pageSize=0', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when search exceeds 200 characters', async () => {
      const longSearch = 'a'.repeat(201);
      const res = await app.request(`/api/v1/admin/waitlist?search=${longSearch}`, {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid sortBy value', async () => {
      const res = await app.request('/api/v1/admin/waitlist?sortBy=invalidColumn', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid sortDir value', async () => {
      const res = await app.request('/api/v1/admin/waitlist?sortDir=sideways', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when page is 0', async () => {
      const res = await app.request('/api/v1/admin/waitlist?page=0', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Default values (200)', () => {
    beforeEach(() => {
      asUser(mockVerifyToken, 'admin');
      mockListWaitlistSignups.mockResolvedValue({ data: [], total: 0 });
    });

    it('applies default values when no query params are provided', async () => {
      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(20);

      expect(mockListWaitlistSignups).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          search: '',
          sortBy: 'createdAt',
          sortDir: 'desc',
        }),
      );
    });

    it('returns data in the correct response shape', async () => {
      mockListWaitlistSignups.mockResolvedValue({
        data: [
          {
            id: 'test-id',
            fullName: 'Test User',
            email: 'test@example.com',
            userType: 'sender',
            source: 'home',
            createdAt: new Date('2024-06-01'),
          },
        ],
        total: 1,
      });

      const res = await app.request('/api/v1/admin/waitlist', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data).toHaveLength(1);
      expect(body.error).toBeNull();
      expect(body.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('passes valid query params to the service', async () => {
      const res = await app.request(
        '/api/v1/admin/waitlist?page=2&pageSize=50&search=test&userType=sender&sortBy=email&sortDir=asc',
        {
          headers: { Authorization: 'Bearer valid-admin-token' },
        },
      );

      expect(res.status).toBe(200);
      expect(mockListWaitlistSignups).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 50,
          search: 'test',
          userType: 'sender',
          sortBy: 'email',
          sortDir: 'asc',
        }),
      );
    });
  });
});
