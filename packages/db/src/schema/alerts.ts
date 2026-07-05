import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
  check,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveries } from './deliveries';
import { deliveryLegs } from './delivery-legs';
import { users } from './users';

export const alerts = pgTable(
  'alerts',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id'),
    legId: uuid('leg_id'),
    rule: text().notNull(),
    severity: text().notNull(),
    originalSeverity: text('original_severity'),
    message: text(),
    context: jsonb().notNull().default({}),
    firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ackBy: uuid('ack_by'),
  },
  (table) => [
    index('idx_alerts_unresolved')
      .on(table.firedAt.desc())
      .where(sql`resolved_at IS NULL`),
    index('idx_alerts_delivery_id')
      .on(table.deliveryId)
      .where(sql`delivery_id IS NOT NULL`),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'alerts_delivery_id_deliveries_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.legId],
      foreignColumns: [deliveryLegs.id],
      name: 'alerts_leg_id_delivery_legs_id_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.ackBy],
      foreignColumns: [users.id],
      name: 'alerts_ack_by_users_id_fk',
    }).onDelete('set null'),
    check(
      'alerts_severity_check',
      sql`severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])`,
    ),
    check(
      'alerts_original_severity_check',
      sql`original_severity IS NULL OR original_severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])`,
    ),
  ],
);
