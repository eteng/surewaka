import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  real,
  integer,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { vehicleType } from './enums';
import { users } from './users';

export const drivers = pgTable(
  'drivers',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    vehicleType: vehicleType('vehicle_type').notNull(),
    licensePlate: text('license_plate').notNull(),
    vehicleModel: text('vehicle_model').notNull(),
    verified: boolean().default(false).notNull(),
    rating: real().default(0),
    available: boolean().default(false).notNull(),
    lat: real(),
    lng: real(),
    h3Index: text('h3_index'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    acceptanceRate: real('acceptance_rate').default(1.0).notNull(),
    completionRate: real('completion_rate').default(1.0).notNull(),
    totalOffersReceived: integer('total_offers_received').default(0).notNull(),
    totalOffersAccepted: integer('total_offers_accepted').default(0).notNull(),
    totalDeliveriesCompleted: integer('total_deliveries_completed').default(0).notNull(),
    lastJobCompletedAt: timestamp('last_job_completed_at'),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'drivers_user_id_users_id_fk',
    }),
    // One driver profile per user — every lookup site (driver-locations,
    // delivery-accept, require-leg-actor, ...) already assumes this via
    // `.where(eq(drivers.userId, ...)).limit(1)`. Without an index those
    // lookups are seq scans; this makes it both fast and enforced.
    uniqueIndex('idx_drivers_user_id').on(table.userId),
    index('idx_drivers_h3_available')
      .on(table.h3Index)
      .where(sql`available = true AND h3_index IS NOT NULL`),
  ],
);
