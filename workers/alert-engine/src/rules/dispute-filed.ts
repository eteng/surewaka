import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * dispute-filed: fires when a delivery's escrow hold moves to 'disputed'
 * and there is no existing unresolved dispute_filed alert for that delivery.
 */
export async function evaluate(_settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT d.id AS delivery_id, d.customer_id, d.driver_id
    FROM deliveries d
    JOIN escrow_holds eh ON eh.delivery_id = d.id AND eh.status = 'disputed'
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts a
      WHERE a.delivery_id = d.id
        AND a.rule = 'dispute_filed'
        AND a.resolved_at IS NULL
    )
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    deliveryId: row.delivery_id as string,
    legId: null,
    rule: 'dispute_filed' as const,
    severity: 'warning' as const,
    context: { deliveryId: row.delivery_id },
    shouldFire: true,
  }));
}
