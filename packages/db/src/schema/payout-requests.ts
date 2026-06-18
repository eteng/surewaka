import { pgTable, uuid, text, timestamp, bigint, index, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { wallets } from './wallets';

export const payoutRequests = pgTable(
  'payout_requests',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    walletId: uuid('wallet_id').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    bankCode: text('bank_code').notNull(),
    accountNumber: text('account_number').notNull(),
    accountName: text('account_name').notNull(),
    paystackTransferCode: text('paystack_transfer_code'),
    paystackRecipientCode: text('paystack_recipient_code'),
    status: text().default('pending').notNull(),
    failureReason: text('failure_reason'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_payout_requests_status').using('btree', table.status),
    index('idx_payout_requests_wallet_id').using('btree', table.walletId),
    foreignKey({
      columns: [table.walletId],
      foreignColumns: [wallets.id],
      name: 'payout_requests_wallet_id_fkey',
    }),
    check('payout_requests_amount_check', sql`amount > 0`),
    check(
      'payout_requests_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])`,
    ),
  ],
);
