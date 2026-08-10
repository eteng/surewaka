import { Hono } from 'hono';
import { db, coverageGaps } from '@surewaka/db';
import { desc } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { h3CellsToGeoJSON, getH3Center } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; accessToken: string } };

const coverageGapRoutes = new Hono<Env>();
coverageGapRoutes.use('*', requireAuth);
coverageGapRoutes.use('*', requireRole('surewaka_admin'));

/**
 * GET /api/v1/admin/coverage-gaps
 *
 * Returns top coverage gap hexes (areas with delivery demand but no carrier parks).
 * Query params:
 *   - limit (default 50, max 200)
 *   - format: 'json' (default) or 'geojson'
 */
coverageGapRoutes.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const format = c.req.query('format') ?? 'json';

  const gaps = await db
    .select()
    .from(coverageGaps)
    .orderBy(desc(coverageGaps.demandCount))
    .limit(limit);

  if (format === 'geojson') {
    const geojson = h3CellsToGeoJSON(
      gaps.map((g) => ({
        h3Index: g.h3Index,
        properties: {
          demandCount: g.demandCount,
          detectedAt: g.createdAt.toISOString(),
          lastSeenAt: g.lastSeenAt.toISOString(),
          resolvedAt: g.resolvedAt ? g.resolvedAt.toISOString() : null,
          nearestParkKm: g.nearestParkKm,
          nearestDriverKm: g.nearestDriverKm,
          center: getH3Center(g.h3Index),
        },
      })),
    );
    return c.json({ data: geojson, error: null, meta: { total: gaps.length } });
  }

  return c.json({
    data: gaps.map((g) => ({
      id: g.id,
      h3Index: g.h3Index,
      demandCount: g.demandCount,
      detectedAt: g.createdAt,
      lastSeenAt: g.lastSeenAt,
      resolvedAt: g.resolvedAt,
      nearestParkKm: g.nearestParkKm,
      nearestDriverKm: g.nearestDriverKm,
      center: getH3Center(g.h3Index),
    })),
    error: null,
    meta: { total: gaps.length },
  });
});

export default coverageGapRoutes;
