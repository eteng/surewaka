import { pgTable, uuid, text, bigint, timestamp, unique, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const platformLedger = pgTable(
  'platform_ledger',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    category: text().notNull(),
    type: text().notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'number' }).notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceType: text('source_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('platform_ledger_source_category_type_key').on(table.sourceId, table.category, table.type),
    index('idx_platform_ledger_occurred_at').using('btree', table.occurredAt),
    index('idx_platform_ledger_category_type').using('btree', table.category, table.type),
    check('platform_ledger_category_check', sql`category IN ('revenue', 'expense')`),
    check('platform_ledger_amount_check', sql`amount_kobo > 0`),
    check(
      'platform_ledger_type_check',
      sql`type IN ('commission', 'withdrawal_fee', 'paystack_transfer', 'paystack_collection', 'commission_reversal')`,
    ),
  ],
);
