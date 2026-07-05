import { pgTable, uuid, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

/**
 * alert_settings — singleton row pattern.
 * Exactly one row should exist (id is kept for ORM compatibility).
 * The migration seeds the default row with INSERT DEFAULT VALUES.
 * The API layer ensures only one row is ever created.
 */
export const alertSettings = pgTable('alert_settings', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  driverSilentWarningMin: integer('driver_silent_warning_min').notNull().default(15),
  driverSilentCriticalMin: integer('driver_silent_critical_min').notNull().default(30),
  legOverdueWarningMin: integer('leg_overdue_warning_min').notNull().default(30),
  legOverdueCriticalMin: integer('leg_overdue_critical_min').notNull().default(60),
  customerUpdateGapWarningMin: integer('customer_update_gap_warning_min').notNull().default(45),
  customerUpdateGapCriticalMin: integer('customer_update_gap_critical_min').notNull().default(90),
  ontimeRateWarningPct: integer('ontime_rate_warning_pct').notNull().default(80),
  ontimeRateCriticalPct: integer('ontime_rate_critical_pct').notNull().default(60),
  pumbleWebhookUrl: text('pumble_webhook_url'),
  pushEnabled: boolean('push_enabled').notNull().default(true),
  pumbleEnabled: boolean('pumble_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
