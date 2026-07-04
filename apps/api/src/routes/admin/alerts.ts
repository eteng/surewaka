import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { UserRole, AlertItem } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const alertRoutes = new Hono<Env>();
alertRoutes.use('*', requireAuth);
alertRoutes.use('*', requireRole('surewaka_admin'));

alertRoutes.get('/', async (c) => {
  const resolvedParam = c.req.query('resolved');
  const includeResolved = resolvedParam === 'true';

  try {
    const rows = await db.execute<{
      id: string;
      delivery_id: string | null;
      leg_id: string | null;
      rule: string;
      severity: string;
      original_severity: string | null;
      message: string;
      fired_at: string;
      escalated_at: string | null;
      resolved_at: string | null;
      ack_by: string | null;
      tracking_id: string | null;
      actor_name: string | null;
    }>(sql`
      SELECT
        a.id,
        a.delivery_id,
        a.leg_id,
        a.rule,
        a.severity,
        a.original_severity,
        a.message,
        a.fired_at,
        a.escalated_at,
        a.resolved_at,
        a.ack_by,
        d.id::text AS tracking_id,
        u.name AS actor_name
      FROM alerts a
      LEFT JOIN deliveries d ON d.id = a.delivery_id
      LEFT JOIN users u ON u.id = a.ack_by
      WHERE ${includeResolved ? sql`TRUE` : sql`a.resolved_at IS NULL`}
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        a.fired_at DESC
      LIMIT 100
    `);

    const items: AlertItem[] = rows.rows.map((r) => ({
      id: r.id,
      deliveryId: r.delivery_id,
      legId: r.leg_id,
      rule: r.rule,
      severity: r.severity as AlertItem['severity'],
      originalSeverity: r.original_severity as AlertItem['originalSeverity'],
      message: r.message,
      firedAt: r.fired_at,
      escalatedAt: r.escalated_at,
      resolvedAt: r.resolved_at,
      ackBy: r.ack_by,
      deliveryTrackingId: r.tracking_id,
      actorName: r.actor_name,
    }));

    return c.json({ data: items, error: null, meta: null });
  } catch (err: unknown) {
    const causeMsg =
      (err as { cause?: { message?: string } })?.cause?.message ?? '';
    const topMsg = err instanceof Error ? err.message : '';
    const isNoTable =
      causeMsg.includes('"alerts"') || topMsg.includes('"alerts"');
    if (isNoTable) {
      return c.json({ data: [] as AlertItem[], error: null, meta: null });
    }
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load alerts' }, meta: null },
      500,
    );
  }
});

export default alertRoutes;
