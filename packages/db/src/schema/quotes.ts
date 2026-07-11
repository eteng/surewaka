import { pgTable, uuid, integer, real, jsonb, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveryLegs } from './delivery-legs';
import { deliveries } from './deliveries';
import { carriers } from './carriers';

/**
 * quotes — one row per delivery_leg_id.
 *
 * Stores authoritative (persisted) quotes for each leg of a delivery.
 * Speculative (pre-delivery) quotes are never written here.
 *
 * line_items shape: [{ "label": "Base fee", "amountKobo": 200000 }, ...]
 *
 * Lifecycle:
 * - Created when a delivery is created (one quote per leg)
 * - Superseded when a re-quote replaces it (superseded_at is set)
 * - Confirmed when booking/confirm succeeds (confirmed_at is set)
 * - Expires after 15 minutes (expires_at)
 *
 * Active quote = superseded_at IS NULL AND confirmed_at IS NULL (and not expired).
 */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryLegId: uuid('delivery_leg_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    carrierId: uuid('carrier_id'),
    lineItems: jsonb('line_items').notNull(),
    totalKobo: integer('total_kobo').notNull(),
    distanceKm: real('distance_km'),
    packageWeightKg: real('package_weight_kg'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.deliveryLegId],
      foreignColumns: [deliveryLegs.id],
      name: 'quotes_delivery_leg_id_delivery_legs_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'quotes_delivery_id_deliveries_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'quotes_carrier_id_carriers_id_fk',
    }),
    index('idx_quotes_leg_active')
      .on(table.deliveryLegId)
      .where(sql`superseded_at IS NULL AND confirmed_at IS NULL`),
    index('idx_quotes_delivery').on(table.deliveryId),
  ],
);
