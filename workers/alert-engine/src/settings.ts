import { db } from './db';
import { alertSettings, userRoles } from '@surewaka/db';
import { and, eq } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';

/**
 * Load the singleton alert_settings row from the database.
 * Throws if no row exists (indicates migration hasn't been run).
 */
export async function loadSettings(): Promise<AlertSettings> {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) {
    throw new Error(
      'alert_settings row missing — run migration (pnpm --filter @surewaka/db db:migrate)',
    );
  }

  return {
    driverSilentWarningMin: row.driverSilentWarningMin,
    driverSilentCriticalMin: row.driverSilentCriticalMin,
    legOverdueWarningMin: row.legOverdueWarningMin,
    legOverdueCriticalMin: row.legOverdueCriticalMin,
    customerUpdateGapWarningMin: row.customerUpdateGapWarningMin,
    customerUpdateGapCriticalMin: row.customerUpdateGapCriticalMin,
    ontimeRateWarningPct: row.ontimeRateWarningPct,
    ontimeRateCriticalPct: row.ontimeRateCriticalPct,
    pumbleWebhookUrl: row.pumbleWebhookUrl,
    pushEnabled: row.pushEnabled,
    pumbleEnabled: row.pumbleEnabled,
  };
}

/**
 * Get all active admin user IDs (users with 'surewaka_admin' role).
 * Used to fan out push notifications to all admins on critical alerts.
 */
export async function getAdminUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.role, 'surewaka_admin'), eq(userRoles.isActive, true)));
  return rows.map((r) => r.userId);
}
