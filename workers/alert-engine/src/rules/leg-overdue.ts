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
      id          AS leg_id,
      delivery_id,
      driver_eta_at,
      system_eta_at,
      dropoff_zone AS zone,
      actor_type
    FROM delivery_legs
    WHERE status IN (
        'accepted', 'en_route_pickup', 'arrived_pickup',
        'picked_up', 'en_route_dropoff', 'arrived_dropoff'
      )
      AND (driver_eta_at IS NOT NULL OR system_eta_at IS NOT NULL)
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

    const context = {
      deliveryId: row.delivery_id,
      minutesOverdue: Math.floor(minutesOverdue),
      zone: (row.zone as string | null) ?? 'Unknown',
      etaSource: row.driver_eta_at ? 'driver' : 'system',
    };

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
