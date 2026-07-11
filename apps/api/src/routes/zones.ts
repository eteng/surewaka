// Feature: dynamic-zones
// Zone listing route — authenticated users can list active zones with filters.
// Requirements: 2.2, 2.8

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import type { AuthUser } from '@surewaka/auth';
import { db, zones } from '@surewaka/db';
import { eq, and, count } from 'drizzle-orm';

type ZoneRoutesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const zoneRoutes = new Hono<ZoneRoutesEnv>();

/**
 * GET / — List active zones with optional city/country filters and pagination
 *
 * Query params:
 *   - city: filter by city (optional)
 *   - country: filter by country (optional)
 *   - page: page number (default 1)
 *   - pageSize: items per page (default 50, max 100)
 *
 * Response: { data: Zone[], error: null, meta: { page, pageSize, total } }
 *
 * Requirements: 2.2, 2.8
 */
zoneRoutes.get('/', requireAuth, async (c) => {
  const city = c.req.query('city');
  const country = c.req.query('country');
  const pageParam = c.req.query('page');
  const pageSizeParam = c.req.query('pageSize');

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeParam || '50', 10) || 50));
  const offset = (page - 1) * pageSize;

  try {
    // Build filter conditions — always filter by is_active = true
    const conditions = [eq(zones.isActive, true)];

    if (city) {
      conditions.push(eq(zones.city, city));
    }
    if (country) {
      conditions.push(eq(zones.country, country));
    }

    const whereClause = and(...conditions);

    // Get total count
    const [countResult] = await db
      .select({ total: count() })
      .from(zones)
      .where(whereClause);

    const total = countResult?.total ?? 0;

    // Get paginated data
    const data = await db
      .select({
        id: zones.id,
        name: zones.name,
        city: zones.city,
        country: zones.country,
        keywords: zones.keywords,
        swLat: zones.swLat,
        swLng: zones.swLng,
        neLat: zones.neLat,
        neLng: zones.neLng,
        isActive: zones.isActive,
        createdAt: zones.createdAt,
        updatedAt: zones.updatedAt,
      })
      .from(zones)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset);

    return c.json(
      {
        data,
        error: null,
        meta: { page, pageSize, total },
      },
      200,
    );
  } catch (error) {
    console.error('[ZoneRoutes] GET / error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve zones' },
        meta: null,
      },
      500,
    );
  }
});

export default zoneRoutes;
