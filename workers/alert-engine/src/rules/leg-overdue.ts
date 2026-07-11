import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

/**
 * leg-overdue: fires when an active leg has exceeded its ETA.
 * Driver-set ETA takes precedence over system ETA.
 * Severity scales with how far past the ETA we are.
 */
export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT
      dl.id          AS leg_id,
      dl.delivery_id,
      dl.driver_eta_at,
      dl.system_eta_at,
      z.name         AS zone,
      dl.actor_type
    FROM delivery_legs dl
    LEFT JOIN zones z ON z.id = dl.dropoff_zone_id
    WHERE dl.status IN (
        'accepted', 'en_route_pickup', 'arrived_pickup',
        'picked_up', 'en_route_dropoff', 'arrived_dropoff'
      )
      AND (dl.driver_eta_at IS NOT NULL OR dl.system_eta_at IS NOT NULL)
  `);

  const now = Date.now();
  const results: EvaluationResult[] = [];

  for (const row of result.rows as Array<Record<string, unknown>>) {
    // Driver ETA takes precedence over system ETA
    const etaRaw = (row.driver_eta_at ?? row.system_eta_at) as string | null;
    if (!etaRaw) continue;

    const minutesOverdue = (now - new Date(etaRaw).getTime()) / 60_000;

    if (minutesOverdue <= 0) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'leg_overdue',
        severity: 'info',
        context: {},
        shouldFire: false,
      });
      continue;
    }

    const zoneName = row.zone as string | null;
    const context: Record<string, unknown> = {
      deliveryId: row.delivery_id,
      minutesOverdue: Math.floor(minutesOverdue),
      etaSource: row.driver_eta_at ? 'driver' : 'system',
    };
    if (zoneName) {
      context.zone = zoneName;
    }

    if (minutesOverdue >= settings.legOverdueCriticalMin) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'leg_overdue',
        severity: 'critical',
        context,
        shouldFire: true,
      });
    } else if (minutesOverdue >= settings.legOverdueWarningMin) {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'leg_overdue',
        severity: 'warning',
        context,
        shouldFire: true,
      });
    } else {
      results.push({
        deliveryId: row.delivery_id as string,
        legId: row.leg_id as string,
        rule: 'leg_overdue',
        severity: 'info',
        context: {},
        shouldFire: false,
      });
    }
  }

  return results;
}
