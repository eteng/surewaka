import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { db, alertSettings } from '@surewaka/db';
import { updateAlertSettingsSchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const alertSettingsRoutes = new Hono<Env>();
alertSettingsRoutes.use('*', requireAuth);
alertSettingsRoutes.use('*', requireRole('surewaka_admin'));

alertSettingsRoutes.get('/', async (c) => {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Settings not initialised' }, meta: null },
      404,
    );
  }
  return c.json({ data: row, error: null, meta: null });
});

alertSettingsRoutes.put('/', async (c) => {
  const body = await c.req.json();
  const parsed = updateAlertSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const [updated] = await db
    .update(alertSettings)
    .set({ ...parsed.data, updatedAt: new Date() })
    .returning();

  if (!updated) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Settings not initialised' }, meta: null },
      404,
    );
  }

  return c.json({ data: updated, error: null, meta: null });
});

alertSettingsRoutes.post('/test', async (c) => {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Settings not initialised' }, meta: null },
      404,
    );
  }

  if (row.pumbleEnabled && row.pumbleWebhookUrl) {
    await fetch(row.pumbleWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🔴 CRITICAL — Test Alert\nThis is a test from SureWaka admin alert system.\n→ View: ${process.env.ADMIN_URL ?? 'https://admin.surewaka.ng'}`,
      }),
    }).catch((err) => console.error('[alert-settings] Pumble test webhook failed:', err));
  }

  return c.json({ data: { sent: true, pumble: row.pumbleEnabled, push: row.pushEnabled }, error: null, meta: null });
});

export default alertSettingsRoutes;
