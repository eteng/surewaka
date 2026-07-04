import { Hono } from 'hono';
import { sql, eq } from 'drizzle-orm';
import { db, deliveries } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { escalationActionSchema } from '@surewaka/shared';
import type { UserRole, OpsHubStats, AtRiskDelivery } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const opsHubRoutes = new Hono<Env>();
opsHubRoutes.use('*', requireAuth);
opsHubRoutes.use('*', requireRole('surewaka_admin'));

const ACTIVE_STATUSES = [
  'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff',
];

const DRIVER_SILENT_MINUTES = 15;
const OVERDUE_WARNING_MINUTES = 30;
const NO_UPDATE_MINUTES = 90;

opsHubRoutes.get('/stats', async (c) => {
  try {
    const rows = await db.execute<{
      active_deliveries: string;
      drivers_on_duty: string;
      drivers_available: string;
      at_risk_deliveries: string;
      open_disputes: string;
      on_time_rate_today: string | null;
    }>(sql`
      WITH active AS (
        SELECT id, driver_id, system_eta_at, driver_eta_at
        FROM deliveries
        WHERE status::text = ANY(ARRAY[${sql.raw(ACTIVE_STATUSES.map((s) => `'${s}'`).join(','))}])
      ),
      driver_last_ping AS (
        SELECT DISTINCT ON (driver_id) driver_id, recorded_at
        FROM driver_locations
        ORDER BY driver_id, recorded_at DESC
      ),
      at_risk AS (
        SELECT a.id
        FROM active a
        LEFT JOIN driver_last_ping dlp ON dlp.driver_id = a.driver_id
        WHERE
          (COALESCE(a.driver_eta_at, a.system_eta_at) < NOW() - INTERVAL '${sql.raw(String(OVERDUE_WARNING_MINUTES))} minutes')
          OR
          (dlp.recorded_at IS NULL OR dlp.recorded_at < NOW() - INTERVAL '${sql.raw(String(DRIVER_SILENT_MINUTES))} minutes')
      ),
      today_deliveries AS (
        SELECT
          d.id,
          d.system_eta_at,
          d.driver_eta_at,
          (SELECT MAX(de.created_at) FROM delivery_events de WHERE de.delivery_id = d.id AND de.to_status = 'delivered') AS delivered_at
        FROM deliveries d
        WHERE d.status = 'delivered'
          AND d.updated_at >= CURRENT_DATE
      )
      SELECT
        (SELECT COUNT(*) FROM active)::text AS active_deliveries,
        (SELECT COUNT(*) FROM drivers WHERE available = true)::text AS drivers_on_duty,
        (
          SELECT COUNT(*) FROM drivers dr
          WHERE dr.available = true
            AND NOT EXISTS (SELECT 1 FROM active a WHERE a.driver_id = dr.id)
        )::text AS drivers_available,
        (SELECT COUNT(*) FROM at_risk)::text AS at_risk_deliveries,
        0::bigint AS open_disputes, /* disputes table pending Spec 3 */
        (
          SELECT
            CASE WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(
              100.0 * COUNT(*) FILTER (
                WHERE delivered_at <= COALESCE(driver_eta_at, system_eta_at)
              ) / COUNT(*),
              2
            )
            END
          FROM today_deliveries
          WHERE delivered_at IS NOT NULL
        )::text AS on_time_rate_today
    `);

    const row = rows.rows[0];
    const stats: OpsHubStats = {
      activeDeliveries: parseInt(row.active_deliveries, 10),
      driversOnDuty: parseInt(row.drivers_on_duty, 10),
      driversAvailable: parseInt(row.drivers_available, 10),
      atRiskDeliveries: parseInt(row.at_risk_deliveries, 10),
      openDisputes: parseInt(row.open_disputes, 10),
      onTimeRateToday: row.on_time_rate_today != null ? parseFloat(row.on_time_rate_today) : null,
    };

    return c.json({ data: stats, error: null, meta: null });
  } catch (err: unknown) {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load ops stats' }, meta: null },
      500,
    );
  }
});

opsHubRoutes.get('/at-risk', async (c) => {
  try {
    const rows = await db.execute<{
      id: string;
      customer_name: string;
      driver_name: string | null;
      status: string;
      minutes_overdue: string;
      risk_reason: string;
      pickup_address: string;
      dropoff_address: string;
    }>(sql`
      WITH active_deliveries AS (
        SELECT
          d.id,
          u.name AS customer_name,
          du.name AS driver_name,
          d.status,
          d.pickup_address,
          d.dropoff_address,
          d.system_eta_at,
          d.driver_eta_at,
          d.driver_id,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(d.driver_eta_at, d.system_eta_at))) / 60 AS mins_since_eta
        FROM deliveries d
        JOIN users u ON u.id = d.customer_id
        LEFT JOIN drivers dr ON dr.id = d.driver_id
        LEFT JOIN users du ON du.id = dr.user_id
        WHERE d.status::text = ANY(ARRAY['en_route_pickup','arrived_pickup','picked_up','en_route_dropoff','arrived_dropoff'])
      ),
      driver_pings AS (
        SELECT DISTINCT ON (driver_id) driver_id, recorded_at
        FROM driver_locations
        ORDER BY driver_id, recorded_at DESC
      ),
      last_customer_event AS (
        SELECT DISTINCT ON (delivery_id) delivery_id, created_at
        FROM delivery_events
        WHERE to_status::text = ANY(ARRAY['accepted','picked_up','en_route_dropoff','arrived_dropoff','delivered'])
        ORDER BY delivery_id, created_at DESC
      )
      SELECT
        ad.id,
        ad.customer_name,
        ad.driver_name,
        ad.status,
        ad.pickup_address,
        ad.dropoff_address,
        CASE
          WHEN COALESCE(dp.recorded_at, '1970-01-01') < NOW() - INTERVAL '${sql.raw(String(DRIVER_SILENT_MINUTES))} minutes'
            THEN 'driver_silent'
          WHEN ad.mins_since_eta > ${sql.raw(String(OVERDUE_WARNING_MINUTES))}
            THEN 'overdue'
          ELSE 'no_update_sent'
        END AS risk_reason,
        GREATEST(0, ROUND(ad.mins_since_eta))::text AS minutes_overdue
      FROM active_deliveries ad
      LEFT JOIN driver_pings dp ON dp.driver_id = ad.driver_id
      LEFT JOIN last_customer_event lce ON lce.delivery_id = ad.id
      WHERE
        COALESCE(dp.recorded_at, '1970-01-01') < NOW() - INTERVAL '${sql.raw(String(DRIVER_SILENT_MINUTES))} minutes'
        OR ad.mins_since_eta > ${sql.raw(String(OVERDUE_WARNING_MINUTES))}
        OR lce.created_at < NOW() - INTERVAL '${sql.raw(String(NO_UPDATE_MINUTES))} minutes'
        OR lce.created_at IS NULL
      ORDER BY
        CASE WHEN dp.recorded_at < NOW() - INTERVAL '${sql.raw(String(DRIVER_SILENT_MINUTES))} minutes' THEN 0 ELSE 1 END,
        ad.mins_since_eta DESC NULLS LAST
      LIMIT 50
    `);

    const atRisk: AtRiskDelivery[] = rows.rows.map((r) => ({
      id: r.id,
      trackingId: r.id.slice(0, 8).toUpperCase(),
      customerName: r.customer_name,
      driverName: r.driver_name,
      status: r.status,
      minutesOverdue: parseInt(r.minutes_overdue, 10),
      riskReason: r.risk_reason as AtRiskDelivery['riskReason'],
      pickupAddress: r.pickup_address,
      dropoffAddress: r.dropoff_address,
    }));

    return c.json({ data: atRisk, error: null, meta: null });
  } catch {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load at-risk deliveries' }, meta: null },
      500,
    );
  }
});

opsHubRoutes.post('/escalate', async (c) => {
  const body = await c.req.json();
  const parsed = escalationActionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const { deliveryId, action } = parsed.data;

  try {
    if (action === 'mark_failed') {
      await db.update(deliveries)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(deliveries.id, deliveryId));
    }
    return c.json({ data: { deliveryId, action }, error: null, meta: null });
  } catch {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Escalation failed' }, meta: null },
      500,
    );
  }
});

export default opsHubRoutes;
