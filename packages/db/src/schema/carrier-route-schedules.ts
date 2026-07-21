import {
  pgTable,
  uuid,
  smallint,
  boolean,
  timestamp,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { carrierRoutes } from './carrier-routes';

export const carrierRouteSchedules = pgTable(
  'carrier_route_schedules',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierRouteId: uuid('carrier_route_id').notNull(),
    hour: smallint('hour').notNull(),
    minute: smallint('minute').notNull().default(0),
    daysOfWeek: smallint('days_of_week').array(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierRouteId],
      foreignColumns: [carrierRoutes.id],
      name: 'carrier_route_schedules_carrier_route_id_carrier_routes_id_fk',
    }).onDelete('cascade'),
    check(
      'carrier_route_schedules_hour_check',
      sql`hour >= 0 AND hour <= 23`,
    ),
    check(
      'carrier_route_schedules_minute_check',
      sql`minute >= 0 AND minute <= 59`,
    ),
    index('idx_carrier_route_schedules_route_active')
      .on(table.carrierRouteId)
      .where(sql`is_active = true`),
  ],
);
