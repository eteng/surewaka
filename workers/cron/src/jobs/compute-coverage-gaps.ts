import { db, deliveries, coverageGaps, carrierParks, drivers } from '@surewaka/db';
import { eq, and, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { getH3Cell, getH3Center, H3_RESOLUTION } from '@surewaka/shared/h3';
import { haversineKm } from '@surewaka/shared';

type Point = { lat: number; lng: number };

/** Straight-line distance (km) from a point to the nearest of a list of points, or null if the list is empty. */
function nearestKm(from: Point, points: Point[]): number | null {
  if (points.length === 0) return null;
  let min = Infinity;
  for (const p of points) {
    const d = haversineKm(from.lat, from.lng, p.lat, p.lng);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Compute coverage gaps — identifies H3 hexes with delivery demand but no carrier parks.
 *
 * Scans deliveries with status='routing_failed' from the last 7 days, groups by H3
 * cell (from pickup coordinates), and:
 *   1. Upserts every cell with current demand as active (resolved_at = null) —
 *      this re-opens a previously resolved gap if demand recurs in the same cell.
 *   2. Resolves any previously-active gap whose cell no longer shows demand in this
 *      run (including all of them, if there's no demand anywhere this run).
 *   3. Records nearest_park_km / nearest_driver_km (haversine, real coordinates) for
 *      every cell touched in this run, so a resolved gap's last known distance stays
 *      a meaningful historical value.
 *
 * Schedule: every 6 hours
 */
export async function computeCoverageGaps(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const failedDeliveries = await db
    .select({
      pickupLat: deliveries.pickupLat,
      pickupLng: deliveries.pickupLng,
      createdAt: deliveries.createdAt,
    })
    .from(deliveries)
    .where(eq(deliveries.status, 'routing_failed'));

  // Filter to last 7 days in JS (avoids complex SQL with gte on timestamp)
  const recent = failedDeliveries.filter((d) => d.createdAt >= sevenDaysAgo);

  // Group by H3 cell — may be empty, which is meaningful (demand dried up everywhere)
  const hexDemand = new Map<string, { count: number; lastSeen: Date }>();
  for (const d of recent) {
    const h3 = getH3Cell(d.pickupLat, d.pickupLng, H3_RESOLUTION);
    const existing = hexDemand.get(h3);
    if (existing) {
      existing.count++;
      if (d.createdAt > existing.lastSeen) existing.lastSeen = d.createdAt;
    } else {
      hexDemand.set(h3, { count: 1, lastSeen: d.createdAt });
    }
  }

  // Reference data for nearest-distance lookups, loaded once for this run
  const activeParks: Point[] = await db
    .select({ lat: carrierParks.lat, lng: carrierParks.lng })
    .from(carrierParks)
    .where(eq(carrierParks.isActive, true));

  const availableDrivers: Point[] = (
    await db
      .select({ lat: drivers.lat, lng: drivers.lng })
      .from(drivers)
      .where(and(eq(drivers.available, true), isNotNull(drivers.lat), isNotNull(drivers.lng)))
  ).map((d) => ({ lat: d.lat as number, lng: d.lng as number }));

  // 1. Upsert active cells
  let upserted = 0;
  for (const [h3Index, data] of hexDemand) {
    const center = getH3Center(h3Index);
    const nearestParkKm = nearestKm(center, activeParks);
    const nearestDriverKm = nearestKm(center, availableDrivers);

    await db
      .insert(coverageGaps)
      .values({
        h3Index,
        demandCount: data.count,
        lastSeenAt: data.lastSeen,
        resolvedAt: null,
        nearestParkKm,
        nearestDriverKm,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: coverageGaps.h3Index,
        set: {
          demandCount: data.count,
          lastSeenAt: data.lastSeen,
          resolvedAt: null,
          nearestParkKm,
          nearestDriverKm,
          updatedAt: now,
        },
      });
    upserted++;
  }

  // 2. Resolve previously-active gaps absent from this run's demand
  const activeH3Indexes = [...hexDemand.keys()];
  const staleGaps = await db
    .select({ h3Index: coverageGaps.h3Index })
    .from(coverageGaps)
    .where(
      activeH3Indexes.length > 0
        ? and(isNull(coverageGaps.resolvedAt), notInArray(coverageGaps.h3Index, activeH3Indexes))
        : isNull(coverageGaps.resolvedAt),
    );

  let resolved = 0;
  for (const gap of staleGaps) {
    const center = getH3Center(gap.h3Index);
    await db
      .update(coverageGaps)
      .set({
        resolvedAt: now,
        nearestParkKm: nearestKm(center, activeParks),
        nearestDriverKm: nearestKm(center, availableDrivers),
        updatedAt: now,
      })
      .where(eq(coverageGaps.h3Index, gap.h3Index));
    resolved++;
  }

  console.log(
    `[CoverageGaps] ${recent.length} failed deliveries → ${upserted} active, ${resolved} resolved`,
  );
}
