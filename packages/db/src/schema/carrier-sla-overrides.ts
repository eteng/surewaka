import {
  pgTable,
  uuid,
  real,
  timestamp,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { carriers } from './carriers';
import { zones } from './zones';

export const carrierSlaOverrides = pgTable(
  'carrier_sla_overrides',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    originZoneId: uuid('origin_zone_id').notNull(),
    destinationZoneId: uuid('destination_zone_id').notNull(),
    slaHours: real('sla_hours').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('carrier_sla_overrides_carrier_zones_unique').on(
      table.carrierId,
      table.originZoneId,
      table.destinationZoneId,
    ),
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_sla_overrides_carrier_id_carriers_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.originZoneId],
      foreignColumns: [zones.id],
      name: 'carrier_sla_overrides_origin_zone_id_zones_id_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.destinationZoneId],
      foreignColumns: [zones.id],
      name: 'carrier_sla_overrides_destination_zone_id_zones_id_fk',
    }).onDelete('restrict'),
    check(
      'carrier_sla_overrides_sla_hours_check',
      sql`sla_hours > 0`,
    ),
  ],
);
