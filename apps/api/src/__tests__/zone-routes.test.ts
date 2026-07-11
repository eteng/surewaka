// Feature: dynamic-zones
// Integration tests for zone CRUD endpoints
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.10

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';

// ─── Mock Data Store ─────────────────────────────────────────────────────────

type ZoneRow = {
  id: string;
  name: string;
  city: string;
  country: string;
  keywords: string[];
  swLat: number | null;
  swLng: number | null;
  neLat: number | null;
  neLng: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let zoneStore: ZoneRow[] = [];

let idCounter = 0;
function nextId() {
  idCounter++;
  return `zone-uuid-${idCounter}`;
}

// ─── Mock DB ─────────────────────────────────────────────────────────────────

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock('@surewaka/db', () => {
  const zones = {
    id: 'id',
    name: 'name',
    city: 'city',
    country: 'country',
    keywords: 'keywords',
    swLat: 'swLat',
    swLng: 'swLng',
    neLat: 'neLat',
    neLng: 'neLng',
    isActive: 'isActive',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  };
  return {
    db: mockDb,
    zones,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (field: string, val: unknown) => ({ field, val, type: 'eq' }),
  and: (...conditions: unknown[]) => ({ conditions, type: 'and' }),
  ne: (field: string, val: unknown) => ({ field, val, type: 'ne' }),
  count: () => 'count()',
}));

// ─── Mock Auth (Admin) ───────────────────────────────────────────────────────

let mockIsAuthenticated = true;

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: vi.fn((c: Context, next: () => Promise<void>) => {
    if (!mockIsAuthenticated) {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' }, meta: null },
        401,
      );
    }
    c.set('user', { id: 'user-1', roles: ['surewaka_admin'], role: 'surewaka_admin' });
    return next();
  }),
}));

vi.mock('../../src/middleware/role', () => ({
  requireRole: () => vi.fn((_c: Context, next: () => Promise<void>) => next()),
}));

vi.mock('../../src/lib/zone-classifier', () => ({
  invalidateZoneCache: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Filter zoneStore based on the mock condition objects from drizzle-orm mocks.
 */
function applyCondition(results: ZoneRow[], condition: unknown): ZoneRow[] {
  if (!condition || typeof condition !== 'object') return results;
  const cond = condition as {
    type?: string;
    conditions?: Array<{ field?: string; val?: unknown; type?: string }>;
    field?: string;
    val?: unknown;
  };

  if (cond.type === 'and' && cond.conditions) {
    for (const c of cond.conditions) {
      results = applyCondition(results, c);
    }
    return results;
  }
  if (cond.type === 'eq') {
    if (cond.field === 'isActive') return results.filter((z) => z.isActive === cond.val);
    if (cond.field === 'city') return results.filter((z) => z.city === cond.val);
    if (cond.field === 'country') return results.filter((z) => z.country === cond.val);
    if (cond.field === 'id') return results.filter((z) => z.id === cond.val);
  }
  if (cond.type === 'ne') {
    if (cond.field === 'id') return results.filter((z) => z.id !== cond.val);
  }
  return results;
}

function setupDbMocks() {
  // Mock db.select() — returns Drizzle-like chainable interface
  mockDb.select.mockImplementation((_fields?: Record<string, unknown>) => ({
    from: () => ({
      where: (condition?: unknown) => {
        const results = applyCondition([...zoneStore], condition);
        // Return something that can be used as:
        //   await db.select().from(zones).where(...)          → results (iterable)
        //   await db.select().from(zones).where(...).limit(n) → results.slice(0, n)
        //   db.select().from(zones).where(...).limit(n).offset(o) → results
        const arr = results as ZoneRow[] & {
          limit: (n: number) => ZoneRow[] & { offset: (o: number) => ZoneRow[] };
        };
        arr.limit = (n: number) => {
          const sliced = results.slice(0, n) as ZoneRow[] & { offset: (o: number) => ZoneRow[] };
          sliced.offset = () => sliced;
          return sliced;
        };
        return arr;
      },
      limit: (n: number) => zoneStore.slice(0, n),
    }),
  }));

  // Mock db.insert()
  mockDb.insert.mockImplementation(() => ({
    values: (data: Record<string, unknown>) => ({
      returning: () => {
        // Check unique constraint
        const duplicate = zoneStore.find(
          (z) => z.name === data.name && z.city === data.city && z.country === data.country,
        );
        if (duplicate) {
          const err = new Error('unique constraint violation');
          (err as unknown as { code: string }).code = '23505';
          throw err;
        }
        const newZone: ZoneRow = {
          id: nextId(),
          name: data.name as string,
          city: data.city as string,
          country: data.country as string,
          keywords: data.keywords as string[],
          swLat: (data.swLat as number) ?? null,
          swLng: (data.swLng as number) ?? null,
          neLat: (data.neLat as number) ?? null,
          neLng: (data.neLng as number) ?? null,
          isActive: (data.isActive as boolean) ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        zoneStore.push(newZone);
        return [newZone];
      },
    }),
  }));

  // Mock db.update()
  mockDb.update.mockImplementation(() => ({
    set: (data: Record<string, unknown>) => ({
      where: (condition?: unknown) => ({
        returning: () => {
          const cond = condition as { field?: string; val?: unknown; type?: string } | undefined;
          let targetId: string | undefined;
          if (cond?.type === 'eq' && cond?.field === 'id') {
            targetId = cond.val as string;
          }
          const idx = zoneStore.findIndex((z) => z.id === targetId);
          if (idx === -1) return [];
          const updated = { ...zoneStore[idx], ...data, updatedAt: new Date() };
          zoneStore[idx] = updated as ZoneRow;
          return [updated];
        },
      }),
    }),
  }));
}

async function createTestApp() {
  const { default: adminZones } = await import('../routes/admin/zones');
  const { default: zoneRoutes } = await import('../routes/zones');
  const app = new Hono();
  app.route('/api/v1/admin/zones', adminZones);
  app.route('/api/v1/zones', zoneRoutes);
  return app;
}

const validZoneBody = {
  name: 'Lekki',
  city: 'Lagos',
  country: 'Nigeria',
  keywords: ['lekki', 'ajah', 'chevron'],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Zone CRUD Integration Tests', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    zoneStore = [];
    idCounter = 0;
    mockIsAuthenticated = true;
    setupDbMocks();
    app = await createTestApp();
  });

  // ─── Create → List → Update → Deactivate Flow ───────────────────────────

  describe('create → list → update → deactivate flow', () => {
    it('creates a zone and returns 201', async () => {
      const res = await app.request('/api/v1/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify(validZoneBody),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { id: string; name: string }; error: unknown };
      expect(body.data.name).toBe('Lekki');
      expect(body.data.id).toBeDefined();
      expect(body.error).toBeNull();
    });

    it('lists active zones with auth → 200', async () => {
      // Seed a zone
      zoneStore.push({
        id: 'z1',
        name: 'Lekki',
        city: 'Lagos',
        country: 'Nigeria',
        keywords: ['lekki'],
        swLat: null,
        swLng: null,
        neLat: null,
        neLng: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Override select to return count and data
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Count query
          return {
            from: () => ({
              where: () => [{ total: 1 }],
            }),
          };
        }
        // Data query
        return {
          from: () => ({
            where: () => ({
              limit: () => ({
                offset: () => zoneStore.filter((z) => z.isActive),
              }),
            }),
          }),
        };
      });

      const res = await app.request('/api/v1/zones', {
        headers: { Authorization: 'Bearer tok' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; meta: { total: number } };
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(1);
    });

    it('updates a zone → 200', async () => {
      zoneStore.push({
        id: 'z1',
        name: 'Lekki',
        city: 'Lagos',
        country: 'Nigeria',
        keywords: ['lekki'],
        swLat: null,
        swLng: null,
        neLat: null,
        neLng: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // PUT route does two selects:
      //  1. existence check: db.select({id}).from().where().limit(1) → [{ id }]
      //  2. keyword conflict check: db.select().from().where() → iterable []
      // Use the default setupDbMocks which handles both patterns via applyCondition.

      const res = await app.request('/api/v1/admin/zones/z1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({
          name: 'Lekki Phase 2',
          city: 'Lagos',
          country: 'Nigeria',
          keywords: ['lekki', 'ajah'],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { name: string }; error: unknown };
      expect(body.data.name).toBe('Lekki Phase 2');
      expect(body.error).toBeNull();
    });

    it('deactivates a zone via PATCH isActive: false → 200', async () => {
      zoneStore.push({
        id: 'z1',
        name: 'Lekki',
        city: 'Lagos',
        country: 'Nigeria',
        keywords: ['lekki'],
        swLat: null,
        swLng: null,
        neLat: null,
        neLng: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Select for checking existing zone returns the full record
      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: () => [zoneStore[0]],
          }),
        }),
      }));

      const res = await app.request('/api/v1/admin/zones/z1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ isActive: false }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { isActive: boolean }; error: unknown };
      expect(body.data.isActive).toBe(false);
      expect(body.error).toBeNull();
    });
  });

  // ─── Duplicate name+city+country → 409 ──────────────────────────────────

  describe('duplicate name+city+country returns 409', () => {
    it('returns 409 when creating duplicate zone', async () => {
      // Pre-seed the store with an existing zone
      zoneStore.push({
        id: 'z1',
        name: 'Lekki',
        city: 'Lagos',
        country: 'Nigeria',
        keywords: ['lekki'],
        swLat: null,
        swLng: null,
        neLat: null,
        neLng: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock select for keyword conflict check — returns empty (no keyword overlap)
      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: () => [],
        }),
      }));

      const res = await app.request('/api/v1/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({
          name: 'Lekki',
          city: 'Lagos',
          country: 'Nigeria',
          keywords: ['different-keyword'],
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('DUPLICATE_ZONE');
      expect(body.error.message).toContain('Lekki');
    });
  });

  // ─── Keyword overlap → 409 ──────────────────────────────────────────────

  describe('keyword overlap returns 409 with specific message', () => {
    it('returns 409 when keyword conflicts with existing zone', async () => {
      // Seed an existing zone
      zoneStore.push({
        id: 'z1',
        name: 'Lekki',
        city: 'Lagos',
        country: 'Nigeria',
        keywords: ['lekki', 'ajah', 'chevron'],
        swLat: null,
        swLng: null,
        neLat: null,
        neLng: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock select for keyword conflict check — returns the sibling zone
      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: () => zoneStore.filter((z) => z.isActive),
        }),
      }));

      const res = await app.request('/api/v1/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({
          name: 'Ajah',
          city: 'Lagos',
          country: 'Nigeria',
          keywords: ['ajah', 'sangotedo'],
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('KEYWORD_CONFLICT');
      expect(body.error.message).toContain('ajah');
      expect(body.error.message).toContain('Lekki');
      expect(body.error.message).toContain('Lagos');
    });
  });

  // ─── Missing fields → 400 ──────────────────────────────────────────────

  describe('missing fields returns 400', () => {
    it('returns 400 when body is empty', async () => {
      const res = await app.request('/api/v1/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when keywords array is empty', async () => {
      const res = await app.request('/api/v1/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ ...validZoneBody, keywords: [] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/api/v1/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ city: 'Lagos', country: 'Nigeria', keywords: ['test'] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Non-existent zone → 404 ───────────────────────────────────────────

  describe('non-existent zone returns 404', () => {
    it('returns 404 for PUT on non-existent zone ID', async () => {
      // Mock select for zone existence check — returns empty
      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: () => [],
          }),
        }),
      }));

      const res = await app.request('/api/v1/admin/zones/nonexistent-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify(validZoneBody),
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('not found');
    });

    it('returns 404 for PATCH on non-existent zone ID', async () => {
      mockDb.select.mockImplementation(() => ({
        from: () => ({
          where: () => ({
            limit: () => [],
          }),
        }),
      }));

      const res = await app.request('/api/v1/admin/zones/nonexistent-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ isActive: false }),
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── Listing requires auth ─────────────────────────────────────────────

  describe('listing requires auth', () => {
    it('returns 401 when no auth token is provided', async () => {
      mockIsAuthenticated = false;

      const res = await app.request('/api/v1/zones');

      expect(res.status).toBe(401);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── Listing returns active only ──────────────────────────────────────

  describe('listing returns active only', () => {
    it('returns only active zones, not inactive ones', async () => {
      zoneStore.push(
        {
          id: 'z1',
          name: 'Active Zone',
          city: 'Lagos',
          country: 'Nigeria',
          keywords: ['active'],
          swLat: null,
          swLng: null,
          neLat: null,
          neLng: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'z2',
          name: 'Inactive Zone',
          city: 'Lagos',
          country: 'Nigeria',
          keywords: ['inactive'],
          swLat: null,
          swLng: null,
          neLat: null,
          neLng: null,
          isActive: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      );

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        const activeZones = zoneStore.filter((z) => z.isActive);
        if (callCount === 1) {
          // Count query
          return {
            from: () => ({
              where: () => [{ total: activeZones.length }],
            }),
          };
        }
        // Data query
        return {
          from: () => ({
            where: () => ({
              limit: () => ({
                offset: () => activeZones,
              }),
            }),
          }),
        };
      });

      const res = await app.request('/api/v1/zones', {
        headers: { Authorization: 'Bearer tok' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ name: string }>; meta: { total: number } };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Active Zone');
      expect(body.meta.total).toBe(1);
    });
  });
});
