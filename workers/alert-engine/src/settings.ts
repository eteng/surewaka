import { db } from './db';
import { alertSettings } from '@surewaka/db';
import type { AlertSettings } from '@surewaka/shared';

export async function loadSettings(): Promise<AlertSettings> {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) throw new Error('alert_settings row missing — run migration 0003_young_shard (pnpm --filter @surewaka/db db:migrate)');

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
