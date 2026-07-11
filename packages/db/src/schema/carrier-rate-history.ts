import { pgTable, uuid, integer, text, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { carriers } from './carriers';
import { users } from './users';

export const carrierRateHistory = pgTable(
  'carrier_rate_history',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    oldBasePriceKobo: integer('old_base_price_kobo'),
    newBasePriceKobo: integer('new_base_price_kobo').notNull(),
    changedBy: uuid('changed_by'),
    reason: text(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_rate_history_carrier_id_carriers_id_fk',
    }),
    foreignKey({
      columns: [table.changedBy],
      foreignColumns: [users.id],
      name: 'carrier_rate_history_changed_by_users_id_fk',
    }),
  ],
);
