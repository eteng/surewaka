import {
  pgTable,
  uuid,
  real,
  timestamp,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { deliveries } from './deliveries';

export const driverLocations = pgTable(
  'driver_locations',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    driverId: uuid('driver_id').notNull(),
    deliveryId: uuid('delivery_id'),
    lat: real().notNull(),
    lng: real().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_driver_locations_driver_recent').using('btree', table.driverId, table.recordedAt),
    foreignKey({
      columns: [table.driverId],
      foreignColumns: [drivers.id],
      name: 'driver_locations_driver_id_drivers_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'driver_locations_delivery_id_deliveries_id_fk',
    }).onDelete('set null'),
  ],
);
