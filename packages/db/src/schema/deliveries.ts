import {
  pgTable,
  uuid,
  text,
  timestamp,
  real,
  bigint,
  index,
  foreignKey,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deliveryStatus, packageCategory } from './enums';
import { users } from './users';
import { drivers } from './drivers';
import { carriers } from './carriers';

/**
 * Deliveries table.
 *
 * Note: escrowHoldId uses AnyPgColumn to break the circular FK reference
 * with escrow_holds (which references deliveries.id).
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    customerId: uuid('customer_id').notNull(),
    driverId: uuid('driver_id'),
    carrierId: uuid('carrier_id'),
    status: deliveryStatus().default('draft').notNull(),
    pickupAddress: text('pickup_address').notNull(),
    pickupCity: text('pickup_city').notNull(),
    pickupLat: real('pickup_lat').notNull(),
    pickupLng: real('pickup_lng').notNull(),
    dropoffAddress: text('dropoff_address').notNull(),
    dropoffCity: text('dropoff_city').notNull(),
    dropoffLat: real('dropoff_lat').notNull(),
    dropoffLng: real('dropoff_lng').notNull(),
    packageDescription: text('package_description').notNull(),
    packageWeight: real('package_weight').notNull(),
    packageCategory: packageCategory('package_category').notNull(),
    price: real(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    deliveryNotes: text('delivery_notes'),
    senderPhone: text('sender_phone'),
    paymentStatus: text('payment_status').default('unpaid').notNull(),
    escrowHoldId: uuid('escrow_hold_id'),
    amountPaid: bigint('amount_paid', { mode: 'number' }),
  },
  (table) => [
    index('idx_deliveries_payment_status').using('btree', table.paymentStatus),
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'deliveries_carrier_id_carriers_id_fk',
    }),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [users.id],
      name: 'deliveries_customer_id_users_id_fk',
    }),
    foreignKey({
      columns: [table.driverId],
      foreignColumns: [drivers.id],
      name: 'deliveries_driver_id_drivers_id_fk',
    }),
    // escrowHoldId FK is defined in escrow-holds.ts to avoid circular import
    check('deliveries_amount_paid_check', sql`amount_paid > 0`),
    check(
      'deliveries_payment_status_check',
      sql`payment_status = ANY (ARRAY['unpaid'::text, 'escrowed'::text, 'released'::text, 'refunded'::text])`,
    ),
  ],
);
