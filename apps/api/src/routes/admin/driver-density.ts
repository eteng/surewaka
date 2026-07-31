import { Hono } from 'hono';
import { db, drivers } from '@surewaka/db';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { h3CellsToGeoJSON } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; accessToken: string } };

const driverDensityRoutes = new Hono<Env>();
driverDensityRoutes.use('*', requireAuth);
driverDensityRoutes.use('*', requireRole('surewaka_admin'));

/**
 * GET /api/v1/admin/driver-density
 *
 * Returns available driver count per H3 cell as GeoJSON or JSON.
 * Only includes cells with at least 1 available driver.
 *
 * Query params:
 *   - format: 'json' (default) or 'geojson'
 */
driverDensityRoutes.get('/', async (c) => {
  const format = c.req.query('format') ?? 'json';

  // Group available drivers by H3 cell
  const densityRows = await db
    .select({
      h3Index: drivers.h3Index,
      driverCount: sql<number>`count(*)::int`.as('driver_count'),
    })
    .from(drivers)
    .where(eq(drivers.available, true))
    .groupBy(drivers.h3Index)
    .having(isNotNull(drivers.h3Index));

  // Filter out null/empty h3 values
  const cells = densityRows.filter((r) => r.h3Index && r.h3Index !== '');

  if (format === 'geojson') {
    const geojson = h3CellsToGeoJSON(
      cells.map((r) => ({
        h3Index: r.h3Index!,
        properties: { driverCount: r.driverCount },
      })),
    );
    return c.json({ data: geojson, error: null, meta: { totalCells: cells.length } });
  }

  return c.json({
    data: cells.map((r) => ({
      h3Index: r.h3Index,
      driverCount: r.driverCount,
    })),
    error: null,
    meta: { totalCells: cells.length },
  });
});

export default driverDensityRoutes;
