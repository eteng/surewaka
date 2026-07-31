import { db, deliveries, coverageGaps } from '@surewaka/db';
import { eq, gte, sql } from 'drizzle-orm';
import { getH3Cell, H3_RESOLUTION } from '@surewaka/shared';

/**
 * Compute coverage gaps — identifies H3 hexes with delivery demand but no carrier parks.
 *
 * Scans deliveries with status='routing_failed' from the last 7 days,
 * groups by H3 cell (from pickup coordinates), and upserts into coverage_gaps table.
 *
 * Schedule: every 6 hours
 */
export async function computeCoverageGaps(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all routing_failed deliveries from last 7 days
  const failedDeliveries = await db
    .select({
      pickupLat: deliveries.pickupLat,
      pickupLng: deliveries.pickupLng,
      createdAt: deliveries.createdAt,
    })
    .from(deliveries)
    .where(
      eq(deliveries.status, 'routing_failed'),
    );

  // Filter to last 7 days in JS (avoids complex SQL with gte on timestamp)
  const recent = failedDeliveries.filter((d) => d.createdAt >= sevenDaysAgo);

  if (recent.length === 0) {
    console.log('[CoverageGaps] No routing_failed deliveries in last 7 days');
    return;
  }

  // Group by H3 cell
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

  // Upsert into coverage_gaps table
  const now = new Date();
  let upserted = 0;

  for (const [h3Index, data] of hexDemand) {
    await db
      .insert(coverageGaps)
      .values({
        h3Index,
        demandCount: data.count,
        lastSeenAt: data.lastSeen,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: coverageGaps.h3Index,
        set: {
          demandCount: data.count,
          lastSeenAt: data.lastSeen,
          updatedAt: now,
        },
      });
    upserted++;
  }

  console.log(`[CoverageGaps] Processed ${recent.length} failed deliveries → ${upserted} hex gaps updated`);
}
