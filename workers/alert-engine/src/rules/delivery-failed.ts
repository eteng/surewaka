import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * delivery-failed: fires when a delivery transitions to 'failed' within the
 * last 2 minutes and there is no existing unresolved delivery_failed alert.
 * The 2-minute window ensures this runs as a near-real-time notification
 * while avoiding repeated firing across engine cycles.
 */
export async function evaluate(_settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT id AS delivery_id
    FROM deliveries
    WHERE status = 'failed'
      AND updated_at > now() - interval '2 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM alerts a
        WHERE a.delivery_id = deliveries.id
          AND a.rule = 'delivery_failed'
          AND a.resolved_at IS NULL
      )
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    deliveryId: row.delivery_id as string,
    legId: null,
    rule: 'delivery_failed' as const,
    severity: 'warning' as const,
    context: { deliveryId: row.delivery_id },
    shouldFire: true,
  }));
}
