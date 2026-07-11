import { pgTable, uuid, date, integer, text, timestamp, foreignKey, unique } from 'drizzle-orm/pg-core';
import { carriers } from './carriers';
import { users } from './users';

export const carrierInvoiceReconciliations = pgTable(
  'carrier_invoice_reconciliations',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    invoicedAmountKobo: integer('invoiced_amount_kobo').notNull(),
    quotedCarrierTotalKobo: integer('quoted_carrier_total_kobo').notNull(),
    varianceKobo: integer('variance_kobo').notNull(),
    enteredBy: uuid('entered_by'),
    notes: text(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_invoice_reconciliations_carrier_id_carriers_id_fk',
    }),
    foreignKey({
      columns: [table.enteredBy],
      foreignColumns: [users.id],
      name: 'carrier_invoice_reconciliations_entered_by_users_id_fk',
    }),
    unique('carrier_invoice_reconciliations_carrier_period_unique').on(
      table.carrierId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);
