import { pgTable, uuid, text, timestamp, boolean, real, foreignKey } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'drivers_user_id_users_id_fk',
    }),
  ],
);
