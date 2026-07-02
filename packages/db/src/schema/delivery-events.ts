import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveryStatus } from './enums';
import { deliveries } from './deliveries';
import { deliveryLegs } from './delivery-legs';
import { users } from './users';

export const deliveryEvents = pgTable(
  'delivery_events',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    legId: uuid('leg_id'),
    fromStatus: deliveryStatus('from_status'),
    toStatus: deliveryStatus('to_status').notNull(),
    triggeredBy: uuid('triggered_by'),
    failureCause: text('failure_cause'),
    failureNote: text('failure_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_delivery_events_delivery_id').using('btree', table.deliveryId),
    index('idx_delivery_events_leg_id').using('btree', table.legId),
    index('idx_delivery_events_created_at').using('btree', table.createdAt),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'delivery_events_delivery_id_deliveries_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.legId],
      foreignColumns: [deliveryLegs.id],
      name: 'delivery_events_leg_id_delivery_legs_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.triggeredBy],
      foreignColumns: [users.id],
      name: 'delivery_events_triggered_by_users_id_fk',
    }).onDelete('set null'),
    check(
      'delivery_events_failure_cause_check',
      sql`failure_cause = ANY (ARRAY['driver'::text, 'carrier'::text, 'route_traffic'::text, 'system'::text])`,
    ),
  ],
);
