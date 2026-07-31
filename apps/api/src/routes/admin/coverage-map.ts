import { Hono } from 'hono';
import { db, carrierParks, coverageGaps, drivers } from '@surewaka/db';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { h3CellsToGeoJSON, getH3Center } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; accessToken: string } };

const coverageMapRoutes = new Hono<Env>();
coverageMapRoutes.use('*', requireAuth);
coverageMapRoutes.use('*', requireRole('surewaka_admin'));

/**
 * GET /api/v1/admin/coverage-map
 *
 * Returns a unified GeoJSON FeatureCollection for the admin coverage map.
 * Each hex feature includes:
 *   - parkCount: number of active carrier parks in this hex
 *   - demandCount: number of failed deliveries (unserved demand) from coverage_gaps
 *   - driverCount: number of available drivers in this hex
 *
 * This provides a single-request overview for the admin dashboard map.
 */
coverageMapRoutes.get('/', async (c) => {
  // 1. Parks per hex
  const parkRows = await db
    .select({
      h3Index: carrierParks.h3Index,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(carrierParks)
    .where(eq(carrierParks.isActive, true))
    .groupBy(carrierParks.h3Index);

  // 2. Coverage gaps (demand in unserved areas)
  const gapRows = await db
    .select({
      h3Index: coverageGaps.h3Index,
      demandCount: coverageGaps.demandCount,
    })
    .from(coverageGaps);

  // 3. Driver density
  const driverRows = await db
    .select({
      h3Index: drivers.h3Index,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(drivers)
    .where(eq(drivers.available, true))
    .groupBy(drivers.h3Index)
    .having(isNotNull(drivers.h3Index));

  // Merge all data by h3Index
  const hexMap = new Map<string, { parkCount: number; demandCount: number; driverCount: number }>();

  for (const p of parkRows) {
    if (!p.h3Index || p.h3Index === '') continue;
    const entry = hexMap.get(p.h3Index) ?? { parkCount: 0, demandCount: 0, driverCount: 0 };
    entry.parkCount = p.count;
    hexMap.set(p.h3Index, entry);
  }

  for (const g of gapRows) {
    const entry = hexMap.get(g.h3Index) ?? { parkCount: 0, demandCount: 0, driverCount: 0 };
    entry.demandCount = g.demandCount;
    hexMap.set(g.h3Index, entry);
  }

  for (const d of driverRows) {
    if (!d.h3Index || d.h3Index === '') continue;
    const entry = hexMap.get(d.h3Index) ?? { parkCount: 0, demandCount: 0, driverCount: 0 };
    entry.driverCount = d.count;
    hexMap.set(d.h3Index, entry);
  }

  // Build GeoJSON
  const cells = [...hexMap.entries()].map(([h3Index, data]) => ({
    h3Index,
    properties: {
      ...data,
      center: getH3Center(h3Index),
      // Classification for styling
      type: data.parkCount > 0 ? 'covered' : data.demandCount > 0 ? 'gap' : 'active',
    },
  }));

  const geojson = h3CellsToGeoJSON(cells);

  return c.json({
    data: geojson,
    error: null,
    meta: {
      totalHexes: cells.length,
      coveredHexes: cells.filter((c) => c.properties.parkCount > 0).length,
      gapHexes: cells.filter((c) => c.properties.demandCount > 0 && c.properties.parkCount === 0).length,
      activeDriverHexes: cells.filter((c) => c.properties.driverCount > 0).length,
    },
  });
});

export default coverageMapRoutes;
