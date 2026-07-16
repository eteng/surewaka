import { pgTable, uuid, text, bigint, numeric, date, jsonb, timestamp, unique, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const costSnapshots = pgTable(
  'cost_snapshots',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    provider: text().notNull(),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 4 }).notNull(),
    usdToNgnRate: numeric('usd_to_ngn_rate', { precision: 10, scale: 2 }).notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'number' }).notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    rawResponse: jsonb('raw_response').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('cost_snapshots_provider_date_key').on(table.provider, table.snapshotDate),
    index('idx_cost_snapshots_snapshot_date').using('btree', table.snapshotDate),
    check(
      'cost_snapshots_provider_check',
      sql`provider IN ('vercel', 'fly', 'neon', 'clerk', 'ably')`,
    ),
    check('cost_snapshots_amount_check', sql`amount_kobo >= 0`),
  ],
);
