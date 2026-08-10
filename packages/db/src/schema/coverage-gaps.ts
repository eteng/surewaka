import { pgTable, uuid, text, integer, real, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Coverage gaps — hexes with delivery demand but no carrier parks.
 * Populated by a cron job that scans routing_failed deliveries.
 *
 * resolvedAt: null while the cell still shows unmet demand in the most recent
 * scan; set when a scan no longer finds demand there, cleared again (re-set
 * to null) if demand recurs. See workers/cron/src/jobs/compute-coverage-gaps.ts.
 *
 * nearestParkKm / nearestDriverKm: haversine distance from the cell's H3
 * center to the nearest active carrier park / available driver at the time
 * of the most recent scan. Null when no parks/drivers exist at all.
 */
export const coverageGaps = pgTable(
  'coverage_gaps',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    h3Index: text('h3_index').notNull().unique(),
    demandCount: integer('demand_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    nearestParkKm: real('nearest_park_km'),
    nearestDriverKm: real('nearest_driver_km'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_coverage_gaps_demand').on(table.demandCount).where(sql`demand_count > 0`),
    index('idx_coverage_gaps_h3').on(table.h3Index),
    index('idx_coverage_gaps_resolved').on(table.resolvedAt),
  ],
);
