import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  index,
  unique,
  foreignKey,
  check,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { transactionType, walletStatus } from './enums';
import { users } from './users';

export const wallets = pgTable(
  'wallets',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    balance: bigint({ mode: 'number' }).default(0).notNull(),
    currency: text().default('NGN').notNull(),
    status: walletStatus().default('active').notNull(),
    dvaBank: text('dva_bank'),
    dvaAccountNo: text('dva_account_no'),
    dvaCustomerCode: text('dva_customer_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_wallets_user_id').using('btree', table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'wallets_user_id_fkey',
    }).onDelete('cascade'),
    unique('wallets_user_id_currency_key').on(table.userId, table.currency),
    check('wallets_balance_check', sql`balance >= 0`),
  ],
);

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    walletId: uuid('wallet_id').notNull(),
    type: transactionType().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    reference: text(),
    description: text(),
    metadata: jsonb().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_wallet_transactions_created_at').using('btree', table.createdAt),
    index('idx_wallet_transactions_reference').using('btree', table.reference),
    index('idx_wallet_transactions_type').using('btree', table.type),
    index('idx_wallet_transactions_wallet_created').using('btree', table.walletId, table.createdAt),
    index('idx_wallet_transactions_wallet_id').using('btree', table.walletId),
    foreignKey({
      columns: [table.walletId],
      foreignColumns: [wallets.id],
      name: 'wallet_transactions_wallet_id_fkey',
    }),
    unique('wallet_transactions_reference_key').on(table.reference),
    check('wallet_transactions_amount_check', sql`amount <> 0`),
    check('wallet_transactions_balance_after_check', sql`balance_after >= 0`),
  ],
);
