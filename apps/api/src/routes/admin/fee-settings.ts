import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { db, feeSettings, vehicleTypeRates } from '@surewaka/db';
import { updateFeeSettingsSchema, updateVehicleTypeRateSchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const feeSettingsRoutes = new Hono<Env>();
feeSettingsRoutes.use('*', requireAuth);
feeSettingsRoutes.use('*', requireRole('surewaka_admin'));

// ─── Fee Settings ─────────────────────────────────────────────────────────────

feeSettingsRoutes.get('/', async (c) => {
  const [row] = await db.select().from(feeSettings).limit(1);
  if (!row) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Fee settings not initialised' }, meta: null },
      404,
    );
  }
  return c.json({ data: row, error: null, meta: null });
});

feeSettingsRoutes.put('/', async (c) => {
  const body = await c.req.json();
  const parsed = updateFeeSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  // Drizzle numeric columns expect string values — convert from Zod-validated numbers
  const { carrierCommissionRatePct, taxRatePct, ...intFields } = parsed.data;
  const setData: Record<string, unknown> = { ...intFields, updatedAt: new Date() };
  if (carrierCommissionRatePct !== undefined) {
    setData.carrierCommissionRatePct = String(carrierCommissionRatePct);
  }
  if (taxRatePct !== undefined) {
    setData.taxRatePct = String(taxRatePct);
  }

  const [updated] = await db
    .update(feeSettings)
    .set(setData as typeof feeSettings.$inferInsert)
    .returning();

  if (!updated) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Fee settings not initialised' }, meta: null },
      404,
    );
  }

  return c.json({ data: updated, error: null, meta: null });
});

// ─── Vehicle Type Rates ───────────────────────────────────────────────────────

feeSettingsRoutes.get('/vehicle-type-rates', async (c) => {
  const rows = await db.select().from(vehicleTypeRates);
  return c.json({ data: rows, error: null, meta: null });
});

feeSettingsRoutes.put('/vehicle-type-rates', async (c) => {
  const body = await c.req.json();
  const parsed = updateVehicleTypeRateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const { vehicleType, multiplier } = parsed.data;

  const [updated] = await db
    .update(vehicleTypeRates)
    .set({ multiplier: String(multiplier), updatedAt: new Date() })
    .where(eq(vehicleTypeRates.vehicleType, vehicleType))
    .returning();

  if (!updated) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: `Vehicle type rate not found: ${vehicleType}` },
        meta: null,
      },
      404,
    );
  }

  return c.json({ data: updated, error: null, meta: null });
});

export default feeSettingsRoutes;
