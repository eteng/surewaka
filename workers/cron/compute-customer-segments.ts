/**
 * Nightly cron worker: Compute Customer Segments
 *
 * Calculates tier (power/regular/new/dormant), delivery stats, and health score
 * for all customers. Upserts into the `customer_segments` table.
 *
 * Tier rules:
 *   - Power: ≥20 deliveries AND last delivery within 30 days
 *   - Regular: 5–19 deliveries AND last delivery within 30 days
 *   - New: <5 deliveries AND joined within 30 days
 *   - Dormant: No delivery in 30+ days (regardless of count)
 *
 * Health score (0–100) based on RFM:
 *   - Recency (40%): days since last delivery (0 days = 100, 60+ = 0)
 *   - Frequency (30%): delivery count percentile
 *   - Monetary (30%): spend percentile
 *
 * Schedule: Run daily at 02:00 WAT (01:00 UTC)
 */

import { db } from '@surewaka/db';
import { users, deliveries, customerSegments } from '@surewaka/db';
import { eq, sql, and } from 'drizzle-orm';

type CustomerTier = 'power' | 'regular' | 'new' | 'dormant';

type CustomerStats = {
  userId: string;
  createdAt: Date;
  totalDeliveries: number;
  totalSpent: number;
  lastDeliveryAt: Date | null;
  primaryCity: string | null;
};

function computeTier(stats: CustomerStats): CustomerTier {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const isRecentlyActive = stats.lastDeliveryAt && stats.lastDeliveryAt >= thirtyDaysAgo;
  const isNewUser = stats.createdAt >= thirtyDaysAgo;

  if (isRecentlyActive && stats.totalDeliveries >= 20) return 'power';
  if (isRecentlyActive && stats.totalDeliveries >= 5) return 'regular';
  if (stats.totalDeliveries < 5 && isNewUser) return 'new';
  return 'dormant';
}

function computeHealthScore(
  stats: CustomerStats,
  maxDeliveries: number,
  maxSpent: number,
): number {
  const now = new Date();

  // Recency score (0–100): 0 days = 100, 60+ days = 0
  let recencyScore = 0;
  if (stats.lastDeliveryAt) {
    const daysSinceLast = Math.floor(
      (now.getTime() - stats.lastDeliveryAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    recencyScore = Math.max(0, Math.min(100, Math.round(100 - (daysSinceLast / 60) * 100)));
  }

  // Frequency score (0–100): percentile vs max
  const frequencyScore = maxDeliveries > 0
    ? Math.round((stats.totalDeliveries / maxDeliveries) * 100)
    : 0;

  // Monetary score (0–100): percentile vs max
  const monetaryScore = maxSpent > 0
    ? Math.round((stats.totalSpent / maxSpent) * 100)
    : 0;

  // Weighted average
  const score = Math.round(recencyScore * 0.4 + frequencyScore * 0.3 + monetaryScore * 0.3);
  return Math.max(0, Math.min(100, score));
}

async function main() {
  console.log('[compute-customer-segments] Starting nightly segment computation...');
  const startTime = Date.now();

  // Fetch all customers with their delivery stats in one query
  const customerStats = await db
    .select({
      userId: users.id,
      createdAt: users.createdAt,
      totalDeliveries: sql<number>`COALESCE(COUNT(${deliveries.id}), 0)::int`,
      totalSpent: sql<number>`COALESCE(SUM(${deliveries.amountPaid}), 0)::bigint`,
      lastDeliveryAt: sql<Date | null>`MAX(${deliveries.createdAt})`,
      primaryCity: sql<string | null>`MODE() WITHIN GROUP (ORDER BY ${deliveries.pickupCity})`,
    })
    .from(users)
    .leftJoin(deliveries, eq(users.id, deliveries.customerId))
    .where(eq(users.role, 'customer'))
    .groupBy(users.id, users.createdAt);

  if (customerStats.length === 0) {
    console.log('[compute-customer-segments] No customers found. Exiting.');
    return;
  }

  // Compute max values for percentile calculations
  const maxDeliveries = Math.max(...customerStats.map((c) => c.totalDeliveries));
  const maxSpent = Math.max(...customerStats.map((c) => Number(c.totalSpent)));

  // Build upsert values
  const now = new Date();
  const segmentValues = customerStats.map((stats) => {
    const normalizedStats: CustomerStats = {
      userId: stats.userId,
      createdAt: stats.createdAt,
      totalDeliveries: stats.totalDeliveries,
      totalSpent: Number(stats.totalSpent),
      lastDeliveryAt: stats.lastDeliveryAt,
      primaryCity: stats.primaryCity,
    };

    return {
      userId: stats.userId,
      tier: computeTier(normalizedStats) as CustomerTier,
      totalDeliveries: stats.totalDeliveries,
      totalSpent: Number(stats.totalSpent),
      lastDeliveryAt: stats.lastDeliveryAt,
      primaryCity: stats.primaryCity,
      healthScore: computeHealthScore(normalizedStats, maxDeliveries, maxSpent),
      computedAt: now,
    };
  });

  // Batch upsert in chunks of 500
  const BATCH_SIZE = 500;
  let processed = 0;

  for (let i = 0; i < segmentValues.length; i += BATCH_SIZE) {
    const batch = segmentValues.slice(i, i + BATCH_SIZE);

    await db
      .insert(customerSegments)
      .values(batch)
      .onConflictDoUpdate({
        target: customerSegments.userId,
        set: {
          tier: sql`excluded.tier`,
          totalDeliveries: sql`excluded.total_deliveries`,
          totalSpent: sql`excluded.total_spent`,
          lastDeliveryAt: sql`excluded.last_delivery_at`,
          primaryCity: sql`excluded.primary_city`,
          healthScore: sql`excluded.health_score`,
          computedAt: sql`excluded.computed_at`,
        },
      });

    processed += batch.length;
    console.log(`[compute-customer-segments] Processed ${processed}/${segmentValues.length}`);
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[compute-customer-segments] Done. ${segmentValues.length} customers segmented in ${elapsed}ms`,
  );

  // Log tier distribution
  const tierCounts = segmentValues.reduce(
    (acc, s) => {
      acc[s.tier] = (acc[s.tier] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log('[compute-customer-segments] Tier distribution:', tierCounts);
}

main().catch((err) => {
  console.error('[compute-customer-segments] Fatal error:', err);
  process.exit(1);
});
