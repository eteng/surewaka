import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * driver-silent: fires when a driver on an active leg has not sent a GPS ping
 * for longer than the configured warning/critical thresholds.
 * Rows without any ping (last_ping IS NULL) are skipped — driver-ghost handles those.
 */
export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT
      dl.id          AS leg_id,
      dl.delivery_id,
      u.name         AS driver_name,
      dl.dropoff_zone AS zone,
      MAX(dloc.recorded_at) AS last_ping
    FROM delivery_legs dl
    JOIN drivers dr ON dr.id = dl.actor_id
    JOIN users u    ON u.id  = dr.user_id
    LEFT JOIN driver_locations dloc
      ON dloc.driver_id   = dl.actor_id
     AND dloc.delivery_id = dl.delivery_id
    WHERE dl.actor_type = 'driver'
      AND dl.status IN (
        'accepted', 'en_route_pickup', 'arrived_pickup',
        'picked_up', 'en_route_dropoff', 'arrived_dropoff'
      )
    GROUP BY dl.id, dl.delivery_id, u.name, dl.dropoff_zone
  `);

  const now = Date.now();
  const results: EvaluationResult[] = [];

  for (const row of result.rows as Array<Record<string, unknown>>) {
    if (!row.last_ping) continue; // No pings at all — driver-ghost handles this case

    const minutesSilent = (now - new Date(row.last_ping as string).getTime()) / 60_000;

    const context = {
      deliveryId: row.delivery_id,
      driverName: (row.driver_name as string | null) ?? 'Unknown',
      minutesSilent: Math.floor(minutesSilent),
      zone: (row.zone as string | null) ?? 'Unknown',
    };

    if (minutesSilent >= settings.driverSilentCriticalMin) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'driver_silent',
        severity: 'critical',
        context,
        shouldFire: true,
      });
    } else if (minutesSilent >= settings.driverSilentWarningMin) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'driver_silent',
        severity: 'warning',
        context,
        shouldFire: true,
      });
    } else {
      // Condition cleared — resolve any existing alert
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'driver_silent',
        severity: 'info',
        context: {},
        shouldFire: false,
      });
    }
  }

  return results;
}
