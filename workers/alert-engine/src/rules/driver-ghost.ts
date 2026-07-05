import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * driver-ghost: fires when a delivery was cancelled or failed before pickup
 * and the cancellation was not triggered by the customer — suggesting the
 * driver abandoned the job without notifying anyone.
 *
 * Window: events in the last 10 minutes (prevents repeated firing on the
 * same event; the deduplication / alert persistence layer handles ongoing state).
 */
export async function evaluate(_settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT
      de.delivery_id,
      dl.id          AS leg_id,
      u.name         AS driver_name,
      de.triggered_by,
      de.created_at  AS event_time,
      MAX(dloc.recorded_at) AS last_ping
    FROM delivery_events de
    JOIN delivery_legs dl ON dl.id = de.leg_id
    JOIN drivers dr ON dr.id = dl.actor_id AND dl.actor_type = 'driver'
    JOIN users u ON u.id = dr.user_id
    LEFT JOIN driver_locations dloc
      ON dloc.driver_id   = dl.actor_id
     AND dloc.delivery_id = de.delivery_id
    WHERE de.to_status IN ('cancelled', 'failed')
      AND de.from_status NOT IN ('picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered')
      AND de.created_at > now() - interval '10 minutes'
      AND (
        de.triggered_by IS DISTINCT FROM (
          SELECT d2.customer_id FROM deliveries d2 WHERE d2.id = de.delivery_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM alerts a
        WHERE a.delivery_id = de.delivery_id
          AND a.leg_id = dl.id
          AND a.rule = 'driver_ghost'
          AND (a.resolved_at IS NULL OR a.resolved_at > now() - interval '10 minutes')
      )
    GROUP BY de.delivery_id, dl.id, u.name, de.triggered_by, de.created_at
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    deliveryId: row.delivery_id as string,
    legId: row.leg_id as string,
    rule: 'driver_ghost' as const,
    severity: 'critical' as const,
    context: {
      deliveryId: row.delivery_id,
      driverName: (row.driver_name as string | null) ?? 'Unknown',
      triggeredBy: (row.triggered_by as string | null) ?? 'system',
    },
    shouldFire: true,
  }));
}
