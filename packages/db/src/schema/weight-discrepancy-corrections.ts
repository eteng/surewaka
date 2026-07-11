import {
  pgTable,
  uuid,
  real,
  integer,
  text,
  timestamp,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveries } from './deliveries';
import { deliveryLegs } from './delivery-legs';

export const weightDiscrepancyCorrections = pgTable(
  'weight_discrepancy_corrections',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    reportedLegId: uuid('reported_leg_id').notNull(),
    declaredWeightKg: real('declared_weight_kg').notNull(),
    reportedWeightKg: real('reported_weight_kg').notNull(),
    deltaKobo: integer('delta_kobo').notNull(),
    status: text().notNull().default('pending_approval'),
    approvalDeadline: timestamp('approval_deadline', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    walletTransactionRef: text('wallet_transaction_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_weight_corrections_pending')
      .on(table.approvalDeadline)
      .where(sql`status = 'pending_approval'`),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'weight_discrepancy_corrections_delivery_id_deliveries_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.reportedLegId],
      foreignColumns: [deliveryLegs.id],
      name: 'weight_discrepancy_corrections_reported_leg_id_delivery_legs_id_fk',
    }),
  ],
);
