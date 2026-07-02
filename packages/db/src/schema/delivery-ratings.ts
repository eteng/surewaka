import {
  pgTable,
  uuid,
  smallint,
  text,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveries } from './deliveries';
import { drivers } from './drivers';
import { users } from './users';

export const deliveryRatings = pgTable(
  'delivery_ratings',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    driverId: uuid('driver_id'),
    customerId: uuid('customer_id').notNull(),
    rating: smallint().notNull(),
    comment: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('delivery_ratings_delivery_id_customer_id_unique').on(table.deliveryId, table.customerId),
    index('idx_delivery_ratings_driver_id').using('btree', table.driverId),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'delivery_ratings_delivery_id_deliveries_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.driverId],
      foreignColumns: [drivers.id],
      name: 'delivery_ratings_driver_id_drivers_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [users.id],
      name: 'delivery_ratings_customer_id_users_id_fk',
    }).onDelete('cascade'),
    check(
      'delivery_ratings_rating_check',
      sql`rating BETWEEN 1 AND 5`,
    ),
  ],
);
