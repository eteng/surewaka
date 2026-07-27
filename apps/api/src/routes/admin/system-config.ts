import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { db, systemConfig } from '@surewaka/db';
import { configRegistry, invalidateConfig } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const systemConfigRoutes = new Hono<Env>();
systemConfigRoutes.use('*', requireAuth);

async function buildConfigList() {
  const rows = await db.select().from(systemConfig);
  const rowMap = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(configRegistry).map(([key, entry]) => {
    const row = rowMap.get(key);
    const value = row ? entry.schema.parse(row.value) : entry.default;
    return {
      key,
      value,
      label: entry.label,
      description: entry.description ?? null,
      category: entry.category,
      default: entry.default,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}

// IMPORTANT: /export and /import MUST be registered before /:key to avoid param collision

systemConfigRoutes.get('/', requireRole('surewaka_admin'), async (c) => {
  const list = await buildConfigList();
  return c.json({ data: list, error: null, meta: null });
});

systemConfigRoutes.get('/export', requireRole('surewaka_admin'), async (c) => {
  const list = await buildConfigList();
  const flat = Object.fromEntries(list.map((item) => [item.key, item.value]));
  c.header('Content-Disposition', 'attachment; filename="surewaka-config.json"');
  c.header('Content-Type', 'application/json');
  return c.body(JSON.stringify(flat, null, 2));
});

systemConfigRoutes.post('/import', requireRole('surewaka_superadmin'), async (c) => {
  const body = await c.req.json();
  if (typeof body !== 'object' || Array.isArray(body) || body === null) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Body must be a flat JSON object' }, meta: null },
      400,
    );
  }
  const errors: Array<{ key: string; message: string }> = [];
  const valid: Array<{ key: string; value: unknown }> = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(body)) {
    const entry = configRegistry[key as keyof typeof configRegistry];
    if (!entry) { skipped++; continue; }
    const parsed = entry.schema.safeParse(value);
    if (!parsed.success) {
      errors.push({ key, message: parsed.error.message });
    } else {
      valid.push({ key, value: parsed.data });
    }
  }
  if (errors.length > 0) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Import validation failed', details: errors }, meta: null },
      400,
    );
  }
  const user = c.get('user');
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const { key, value } of valid) {
      await tx
        .insert(systemConfig)
        .values({ key, value, updatedBy: user.id, updatedAt: now })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: { value, updatedBy: user.id, updatedAt: now },
        });
      invalidateConfig(key);
    }
  });
  return c.json({ data: { imported: valid.length, skipped }, error: null, meta: null });
});

systemConfigRoutes.get('/:key', requireRole('surewaka_admin'), async (c) => {
  const key = c.req.param('key');
  const entry = configRegistry[key as keyof typeof configRegistry];
  if (!entry) {
    return c.json(
      { data: null, error: { code: 'UNKNOWN_CONFIG_KEY', message: `Unknown config key: ${key}` }, meta: null },
      400,
    );
  }
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  const value = row ? entry.schema.parse(row.value) : entry.default;
  return c.json({
    data: {
      key,
      value,
      label: entry.label,
      description: entry.description ?? null,
      category: entry.category,
      default: entry.default,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    },
    error: null,
    meta: null,
  });
});

systemConfigRoutes.put('/:key', requireRole('surewaka_superadmin'), async (c) => {
  const key = c.req.param('key');
  const entry = configRegistry[key as keyof typeof configRegistry];
  if (!entry) {
    return c.json(
      { data: null, error: { code: 'UNKNOWN_CONFIG_KEY', message: `Unknown config key: ${key}` }, meta: null },
      400,
    );
  }
  const body = await c.req.json();
  const parsed = entry.schema.safeParse(body.value);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }
  const user = c.get('user');
  const now = new Date();
  const [updated] = await db
    .insert(systemConfig)
    .values({ key, value: parsed.data, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: parsed.data, updatedBy: user.id, updatedAt: now },
    })
    .returning();
  invalidateConfig(key);
  return c.json({
    data: { key, value: parsed.data, updatedAt: updated.updatedAt.toISOString() },
    error: null,
    meta: null,
  });
});

systemConfigRoutes.post('/:key/reset', requireRole('surewaka_superadmin'), async (c) => {
  const key = c.req.param('key');
  const entry = configRegistry[key as keyof typeof configRegistry];
  if (!entry) {
    return c.json(
      { data: null, error: { code: 'UNKNOWN_CONFIG_KEY', message: `Unknown config key: ${key}` }, meta: null },
      400,
    );
  }
  await db.delete(systemConfig).where(eq(systemConfig.key, key));
  invalidateConfig(key);
  return c.json({ data: { key, value: entry.default }, error: null, meta: null });
});

export default systemConfigRoutes;
