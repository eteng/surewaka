import { pgTable, uuid, integer, numeric, timestamp } from 'drizzle-orm/pg-core';

/**
 * fee_settings — singleton row pattern.
 * Exactly one row should exist (id is kept for ORM compatibility).
 * Holds all admin-tunable pricing parameters for the Fee Engine.
 * Follows the same singleton pattern as `alert_settings`.
 */
export const feeSettings = pgTable('fee_settings', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  baseRateKobo: integer('base_rate_kobo').notNull().default(200000), // ₦2,000 on-demand base per leg
  perKgRateKobo: integer('per_kg_rate_kobo').notNull().default(20000), // ₦200/kg, applies from kg 0
  perKmRateKobo: integer('per_km_rate_kobo').notNull().default(15000), // ₦150/km
  carrierCommissionRatePct: numeric('carrier_commission_rate_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('15.00'), // additive markup on carrier basePrice
  taxRatePct: numeric('tax_rate_pct', { precision: 5, scale: 2 })
    .notNull()
    .default('0.00'), // applies only to SureWaka's own revenue line
  minPriceKobo: integer('min_price_kobo').notNull().default(50000), // floor on Composite_Quote total
  weightCorrectionApprovalWindowMin: integer('weight_correction_approval_window_min')
    .notNull()
    .default(10),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
