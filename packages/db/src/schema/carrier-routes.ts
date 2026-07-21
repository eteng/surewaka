import {
  pgTable,
  uuid,
  integer,
  real,
  boolean,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { carriers } from './carriers';
import { carrierParks } from './carrier-parks';

export const carrierRoutes = pgTable(
  'carrier_routes',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    originParkId: uuid('origin_park_id').notNull(),
    destinationParkId: uuid('destination_park_id').notNull(),
    basePriceKobo: integer('base_price_kobo').notNull(),
    estimatedTransitHrs: real('estimated_transit_hrs').notNull(),
    maxWeightKg: real('max_weight_kg'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_routes_carrier_id_carriers_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.originParkId],
      foreignColumns: [carrierParks.id],
      name: 'carrier_routes_origin_park_id_carrier_parks_id_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.destinationParkId],
      foreignColumns: [carrierParks.id],
      name: 'carrier_routes_destination_park_id_carrier_parks_id_fk',
    }).onDelete('restrict'),
    unique('carrier_routes_carrier_id_origin_destination_unique').on(
      table.carrierId,
      table.originParkId,
      table.destinationParkId,
    ),
    check(
      'carrier_routes_different_parks_check',
      sql`origin_park_id != destination_park_id`,
    ),
    index('idx_carrier_routes_origin_destination_active')
      .on(table.originParkId, table.destinationParkId)
      .where(sql`is_active = true`),
  ],
);
