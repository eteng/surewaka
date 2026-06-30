import {
  pgTable,
  uuid,
  integer,
  bigint,
  timestamp,
  smallint,
  text,
  unique,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { customerTier } from './enums';
import { users } from './users';

/**
 * Customer segments table — pre-computed nightly by a cron worker.
 *
 * Stores activity tier (power/regular/new/dormant), cached delivery stats,
 * and a health score (0–100 RFM-based) for each customer. Used by the admin
 * customer listing for fast filtering and sorting without runtime aggregation.
 */
export const customerSegments = pgTable(
  'customer_segments',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    tier: customerTier().notNull(),
    totalDeliveries: integer('total_deliveries').default(0).notNull(),
    totalSpent: bigint('total_spent', { mode: 'number' }).default(0).notNull(),
    lastDeliveryAt: timestamp('last_delivery_at'),
    primaryCity: text('primary_city'),
    healthScore: smallint('health_score').default(0).notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (table) => [
    unique('customer_segments_user_id_unique').on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'customer_segments_user_id_users_id_fk',
    }).onDelete('cascade'),
    index('idx_customer_segments_tier').using('btree', table.tier),
    index('idx_customer_segments_city').using('btree', table.primaryCity),
  ],
);
