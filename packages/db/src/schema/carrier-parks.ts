import {
  pgTable,
  uuid,
  text,
  real,
  boolean,
  timestamp,
  index,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { carriers } from './carriers';

export const carrierParks = pgTable(
  'carrier_parks',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    city: text('city').notNull(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_parks_carrier_id_carriers_id_fk',
    }).onDelete('cascade'),
    unique('carrier_parks_carrier_id_name_unique').on(table.carrierId, table.name),
    index('idx_carrier_parks_city_active')
      .on(table.city)
      .where(sql`is_active = true`),
  ],
);
