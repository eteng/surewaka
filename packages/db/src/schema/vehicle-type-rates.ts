import { pgTable, uuid, numeric, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { vehicleType } from './enums';

/**
 * vehicle_type_rates — one row per vehicle type.
 * Stores the multiplier applied to on-demand subtotal (base + weight + distance) before tax.
 * Seeded with defaults: motorcycle=1.0, car=1.3, van=1.6, truck=2.0.
 * Admin-editable only by surewaka_admin role.
 */
export const vehicleTypeRates = pgTable(
  'vehicle_type_rates',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    vehicleType: vehicleType('vehicle_type').notNull(),
    multiplier: numeric({ precision: 4, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('vehicle_type_rates_vehicle_type_unique').on(table.vehicleType)],
);
