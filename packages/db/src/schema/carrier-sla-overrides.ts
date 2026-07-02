import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { carriers } from './carriers';

export const carrierSlaOverrides = pgTable(
  'carrier_sla_overrides',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    originZone: text('origin_zone').notNull(),
    destinationZone: text('destination_zone').notNull(),
    slaHours: real('sla_hours').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('carrier_sla_overrides_carrier_origin_dest_unique').on(
      table.carrierId,
      table.originZone,
      table.destinationZone,
    ),
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_sla_overrides_carrier_id_carriers_id_fk',
    }).onDelete('cascade'),
    check(
      'carrier_sla_overrides_sla_hours_check',
      sql`sla_hours > 0`,
    ),
  ],
);
