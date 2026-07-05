import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * ontime-rate-drop: fires when today's on-time delivery rate (delivered before
 * system ETA) drops below the configured warning/critical thresholds.
 * Requires at least 5 completed deliveries today before evaluating (avoids
 * false alarms in the first hour of the day).
 */
export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'delivered' AND system_eta_at IS NOT NULL) AS delivered,
      COUNT(*) FILTER (
        WHERE status = 'delivered'
          AND system_eta_at IS NOT NULL
          AND updated_at <= system_eta_at
      ) AS on_time
    FROM deliveries
    WHERE (created_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date
      AND status IN ('delivered', 'failed', 'cancelled')
  `);

  const row = result.rows[0] as { delivered: string; on_time: string } | undefined;
  const delivered = Number(row?.delivered ?? 0);
  const onTime = Number(row?.on_time ?? 0);

  // Not enough data for today yet — skip evaluation
  if (delivered < 5) return [];

  const ratePct = Math.round((onTime / delivered) * 100);
  const context = { ratePct, delivered, onTime };

  if (ratePct < settings.ontimeRateCriticalPct) {
    return [
      {
        deliveryId: null,
        legId: null,
        rule: 'ontime_rate_drop',
        severity: 'critical',
        context,
        shouldFire: true,
      },
    ];
  }

  if (ratePct < settings.ontimeRateWarningPct) {
    return [
      {
        deliveryId: null,
        legId: null,
        rule: 'ontime_rate_drop',
        severity: 'warning',
        context,
        shouldFire: true,
      },
    ];
  }

  return [
    {
      deliveryId: null,
      legId: null,
      rule: 'ontime_rate_drop',
      severity: 'info',
      context: {},
      shouldFire: false,
    },
  ];
}
