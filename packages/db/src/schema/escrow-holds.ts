import { pgTable, uuid, timestamp, bigint, numeric, index, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { escrowStatus } from './enums';
import { deliveries } from './deliveries';
import { wallets } from './wallets';

export const escrowHolds = pgTable(
  'escrow_holds',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    senderWalletId: uuid('sender_wallet_id').notNull(),
    driverWalletId: uuid('driver_wallet_id'),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }).default('0.1500').notNull(),
    commissionAmount: bigint('commission_amount', { mode: 'number' }).default(0).notNull(),
    driverAmount: bigint('driver_amount', { mode: 'number' }).default(0).notNull(),
    status: escrowStatus().default('held').notNull(),
    heldAt: timestamp('held_at', { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_escrow_holds_delivery_id').using('btree', table.deliveryId),
    index('idx_escrow_holds_sender_wallet').using('btree', table.senderWalletId),
    index('idx_escrow_holds_status').using('btree', table.status),
    foreignKey({
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
      name: 'escrow_holds_delivery_id_fkey',
    }),
    foreignKey({
      columns: [table.driverWalletId],
      foreignColumns: [wallets.id],
      name: 'escrow_holds_driver_wallet_id_fkey',
    }),
    foreignKey({
      columns: [table.senderWalletId],
      foreignColumns: [wallets.id],
      name: 'escrow_holds_sender_wallet_id_fkey',
    }),
    check('escrow_holds_commission_amount_check', sql`commission_amount >= 0`),
    check('escrow_holds_driver_amount_check', sql`driver_amount >= 0`),
    check('escrow_holds_total_amount_check', sql`total_amount > 0`),
  ],
);
