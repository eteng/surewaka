// Feature: routing-worker
// Admin carrier route + schedule management — full CRUD for routes and departure slots.
// Requirements: 24.1–24.7

import { Hono } from 'hono';
import { db, carrierRoutes, carrierRouteSchedules } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import {
  createCarrierRouteSchema,
  updateCarrierRouteSchema,
  createCarrierRouteScheduleSchema,
  updateCarrierRouteScheduleSchema,
} from '@surewaka/shared';

const adminCarrierRoutes = new Hono();

adminCarrierRoutes.use('*', requireAuth);
adminCarrierRoutes.use('*', requireRole('surewaka_admin'));

// ─── POST / — Create route ────────────────────────────────────────────────────

adminCarrierRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createCarrierRouteSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  try {
    const [route] = await db.insert(carrierRoutes).values({
      carrierId: parsed.data.carrierId,
      originParkId: parsed.data.originParkId,
      destinationParkId: parsed.data.destinationParkId,
      basePriceKobo: parsed.data.basePriceKobo,
      estimatedTransitHrs: parsed.data.estimatedTransitHrs,
      maxWeightKg: parsed.data.maxWeightKg ?? null,
    }).returning();

    return c.json({ data: route, error: null, meta: null }, 201);
  } catch (error: unknown) {
    const isUniqueViolation =
      (error instanceof Error && error.message.includes('unique')) ||
      (error as { code?: string })?.code === '23505';

    if (isUniqueViolation) {
      return c.json(
        { data: null, error: { code: 'DUPLICATE_ROUTE', message: 'A route between these parks already exists for this carrier' }, meta: null },
        409,
      );
    }

    console.error('[AdminCarrierRoutes] POST / error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create carrier route' }, meta: null },
      500,
    );
  }
});

// ─── PATCH /:id — Update route ────────────────────────────────────────────────

adminCarrierRoutes.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateCarrierRouteSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  try {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };

    if (parsed.data.basePriceKobo !== undefined) setValues.basePriceKobo = parsed.data.basePriceKobo;
    if (parsed.data.estimatedTransitHrs !== undefined) setValues.estimatedTransitHrs = parsed.data.estimatedTransitHrs;
    if (parsed.data.maxWeightKg !== undefined) setValues.maxWeightKg = parsed.data.maxWeightKg;
    if (parsed.data.isActive !== undefined) setValues.isActive = parsed.data.isActive;

    const [updated] = await db.update(carrierRoutes)
      .set(setValues)
      .where(eq(carrierRoutes.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Carrier route not found' }, meta: null },
        404,
      );
    }

    return c.json({ data: updated, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierRoutes] PATCH /:id error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update carrier route' }, meta: null },
      500,
    );
  }
});

// ─── GET / — List routes ──────────────────────────────────────────────────────

adminCarrierRoutes.get('/', async (c) => {
  const carrierId = c.req.query('carrierId');

  try {
    const rows = carrierId
      ? await db.select().from(carrierRoutes).where(eq(carrierRoutes.carrierId, carrierId))
      : await db.select().from(carrierRoutes);

    return c.json({ data: rows, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierRoutes] GET / error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list carrier routes' }, meta: null },
      500,
    );
  }
});

// ─── DELETE /:id — Soft-delete route ─────────────────────────────────────────

adminCarrierRoutes.delete('/:id', async (c) => {
  const { id } = c.req.param();

  try {
    await db.update(carrierRoutes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(carrierRoutes.id, id));

    return c.json({ data: { ok: true }, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierRoutes] DELETE /:id error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to deactivate carrier route' }, meta: null },
      500,
    );
  }
});

// ─── GET /:id/schedules — List departure slots ────────────────────────────────

adminCarrierRoutes.get('/:id/schedules', async (c) => {
  const { id } = c.req.param();

  try {
    const rows = await db.select()
      .from(carrierRouteSchedules)
      .where(eq(carrierRouteSchedules.carrierRouteId, id));

    return c.json({ data: rows, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierRoutes] GET /:id/schedules error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list schedules' }, meta: null },
      500,
    );
  }
});

// ─── POST /:id/schedules — Add departure slot ─────────────────────────────────

adminCarrierRoutes.post('/:id/schedules', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = createCarrierRouteScheduleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  try {
    const [slot] = await db.insert(carrierRouteSchedules).values({
      carrierRouteId: id,
      hour: parsed.data.hour,
      minute: parsed.data.minute,
      daysOfWeek: parsed.data.daysOfWeek,
    }).returning();

    return c.json({ data: slot, error: null, meta: null }, 201);
  } catch (error: unknown) {
    console.error('[AdminCarrierRoutes] POST /:id/schedules error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create schedule slot' }, meta: null },
      500,
    );
  }
});

// ─── PATCH /schedules/:scheduleId — Update or deactivate a slot ──────────────

adminCarrierRoutes.patch('/schedules/:scheduleId', async (c) => {
  const { scheduleId } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateCarrierRouteScheduleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  try {
    const setValues: Record<string, unknown> = {};

    if (parsed.data.hour !== undefined) setValues.hour = parsed.data.hour;
    if (parsed.data.minute !== undefined) setValues.minute = parsed.data.minute;
    if (parsed.data.daysOfWeek !== undefined) setValues.daysOfWeek = parsed.data.daysOfWeek;
    if (parsed.data.isActive !== undefined) setValues.isActive = parsed.data.isActive;

    const [updated] = await db.update(carrierRouteSchedules)
      .set(setValues)
      .where(eq(carrierRouteSchedules.id, scheduleId))
      .returning();

    if (!updated) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Schedule slot not found' }, meta: null },
        404,
      );
    }

    return c.json({ data: updated, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierRoutes] PATCH /schedules/:scheduleId error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update schedule slot' }, meta: null },
      500,
    );
  }
});

export default adminCarrierRoutes;
