import { pgTable, uuid, text, timestamp, numeric, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userSavedAddresses = pgTable(
  'user_saved_addresses',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    label: text().notNull(),
    addressText: text('address_text').notNull(),
    city: text().notNull(),
    state: text().notNull(),
    lat: numeric({ precision: 10, scale: 7 }).notNull(),
    lng: numeric({ precision: 10, scale: 7 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'user_saved_addresses_user_id_fkey',
    }).onDelete('cascade'),
  ],
);

export const recentLocations = pgTable(
  'recent_locations',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    addressText: text('address_text').notNull(),
    city: text().notNull(),
    state: text().notNull(),
    lat: numeric({ precision: 10, scale: 7 }).notNull(),
    lng: numeric({ precision: 10, scale: 7 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'recent_locations_user_id_fkey',
    }).onDelete('cascade'),
  ],
);
