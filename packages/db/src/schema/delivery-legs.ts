import {
  pgTable,
  uuid,
  smallint,
  text,
  real,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveryStatus } from './enums';
import { deliveries } from './deliveries';

export const deliveryLegs = pgTable(
  'delivery_legs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    legNumber: smallint('leg_number').notNull(),
    legType: text('leg_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id').notNull(),
    pickupAddress: text('pickup_address').notNull(),
    pickupLat: real('pickup_lat').notNull(),
    pickupLng: real('pickup_lng').notNull(),
    pickupZone: text('pickup_zone'),
    dropoffAddress: text('dropoff_address').notNull(),
    dropoffLat: real('dropoff_lat').notNull(),
    dropoffLng: real('dropoff_lng').notNull(),
    dropoffZone: text('dropoff_zone'),
    status: deliveryStatus().default('pending').notNull(),
    systemEtaAt: timestamp('system_eta_at', { withTimezone: true }),
    driverEtaAt: timestamp('driver_eta_at', { withTimezone: true }),
    slaHours: real('sla_hours'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('delivery_legs_delivery_id_leg_number_unique').on(table.deliveryId, table.legNumber),
    index('idx_delivery_legs_delivery_id').using('btree', table.deliveryId),
    index('idx_delivery_legs_actor_id').using('btree', table.actorId),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'delivery_legs_delivery_id_deliveries_id_fk',
    }).onDelete('cascade'),
    check(
      'delivery_legs_leg_number_check',
      sql`leg_number BETWEEN 1 AND 10`,
    ),
    check(
      'delivery_legs_leg_type_check',
      sql`leg_type = ANY (ARRAY['first_mile'::text, 'intercity'::text, 'last_mile'::text])`,
    ),
    check(
      'delivery_legs_actor_type_check',
      sql`actor_type = ANY (ARRAY['driver'::text, 'carrier'::text])`,
    ),
  ],
);
