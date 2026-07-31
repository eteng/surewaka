import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Coverage gaps — hexes with delivery demand but no carrier parks.
 * Populated by a cron job that scans routing_failed deliveries.
 */
export const coverageGaps = pgTable(
  'coverage_gaps',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    h3Index: text('h3_index').notNull().unique(),
    demandCount: integer('demand_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_coverage_gaps_demand').on(table.demandCount).where(sql`demand_count > 0`),
    index('idx_coverage_gaps_h3').on(table.h3Index),
  ],
);
