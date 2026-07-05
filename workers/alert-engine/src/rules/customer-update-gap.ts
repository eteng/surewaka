import { db } from '../db';
import { sql } from 'drizzle-orm';
import { CUSTOMER_FACING_STATUSES } from '@surewaka/shared';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * customer-update-gap: fires when an in-progress delivery has not had a
 * customer-visible status change for longer than the configured thresholds.
 *
 * CUSTOMER_FACING_STATUSES is a known safe constant (not user input), so
 * interpolating it directly into sql.raw() is acceptable.
 */
export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const statusList = CUSTOMER_FACING_STATUSES.map((s) => `'${s}'`).join(', ');

  const result = await db.execute(
    sql.raw(`
      SELECT
        d.id              AS delivery_id,
        d.recipient_name  AS customer_name,
        EXTRACT(EPOCH FROM (now() - COALESCE(MAX(de.created_at), d.created_at))) / 60 AS minutes_since_update
      FROM deliveries d
      LEFT JOIN delivery_events de ON de.delivery_id = d.id
        AND de.to_status IN (${statusList})
      WHERE d.status NOT IN ('delivered', 'cancelled', 'failed', 'returned', 'draft')
      GROUP BY d.id, d.recipient_name, d.created_at
    `),
  );

  const results: EvaluationResult[] = [];

  for (const row of result.rows as Array<Record<string, unknown>>) {
    const mins = Number(row.minutes_since_update ?? 0);
    const context = {
      deliveryId: row.delivery_id,
      customerName: row.customer_name,
      minutesSinceUpdate: Math.floor(mins),
    };

    if (mins >= settings.customerUpdateGapCriticalMin) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: null,
        rule: 'customer_update_gap',
        severity: 'critical',
        context,
        shouldFire: true,
      });
    } else if (mins >= settings.customerUpdateGapWarningMin) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: null,
        rule: 'customer_update_gap',
        severity: 'warning',
        context,
        shouldFire: true,
      });
    } else {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: null,
        rule: 'customer_update_gap',
        severity: 'info',
        context: {},
        shouldFire: false,
      });
    }
  }

  return results;
}
