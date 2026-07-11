import { pgTable, uuid, text, real, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core';

export const zones = pgTable(
  'zones',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    city: text().notNull(),
    country: text().notNull(),
    keywords: text().array().notNull().default([]),
    swLat: real('sw_lat'),
    swLng: real('sw_lng'),
    neLat: real('ne_lat'),
    neLng: real('ne_lng'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('zones_name_city_country_unique').on(table.name, table.city, table.country),
    index('idx_zones_city_active').on(table.city, table.isActive),
  ],
);
