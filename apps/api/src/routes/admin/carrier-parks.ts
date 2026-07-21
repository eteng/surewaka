// Feature: routing-worker
// Admin carrier park management — create, update, and list parks.
// Requirements: 23.1, 23.2, 23.3

import { Hono } from 'hono';
import { db, carrierParks } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { createCarrierParkSchema, updateCarrierParkSchema } from '@surewaka/shared';

const adminCarrierParks = new Hono();

adminCarrierParks.use('*', requireAuth);
adminCarrierParks.use('*', requireRole('surewaka_admin'));

// ─── POST / — Create park ─────────────────────────────────────────────────────

adminCarrierParks.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createCarrierParkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  try {
    const [park] = await db.insert(carrierParks).values({
      carrierId: parsed.data.carrierId,
      city: parsed.data.city.trim().toLowerCase(),
      name: parsed.data.name,
      address: parsed.data.address,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    }).returning();

    return c.json({ data: park, error: null, meta: null }, 201);
  } catch (error: unknown) {
    const isUniqueViolation =
      (error instanceof Error && error.message.includes('unique')) ||
      (error as { code?: string })?.code === '23505';

    if (isUniqueViolation) {
      return c.json(
        { data: null, error: { code: 'DUPLICATE_PARK', message: 'A park with this name already exists for this carrier' }, meta: null },
        409,
      );
    }

    console.error('[AdminCarrierParks] POST / error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create carrier park' }, meta: null },
      500,
    );
  }
});

// ─── PATCH /:id — Update park ─────────────────────────────────────────────────

adminCarrierParks.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateCarrierParkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const updates = parsed.data;

  try {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };

    if (updates.city !== undefined) setValues.city = updates.city.trim().toLowerCase();
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.address !== undefined) setValues.address = updates.address;
    if (updates.lat !== undefined) setValues.lat = updates.lat;
    if (updates.lng !== undefined) setValues.lng = updates.lng;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;

    const [updated] = await db.update(carrierParks)
      .set(setValues)
      .where(eq(carrierParks.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Carrier park not found' }, meta: null },
        404,
      );
    }

    return c.json({ data: updated, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierParks] PATCH /:id error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update carrier park' }, meta: null },
      500,
    );
  }
});

// ─── GET / — List parks ───────────────────────────────────────────────────────

adminCarrierParks.get('/', async (c) => {
  const carrierId = c.req.query('carrierId');

  try {
    const rows = carrierId
      ? await db.select().from(carrierParks).where(eq(carrierParks.carrierId, carrierId))
      : await db.select().from(carrierParks);

    return c.json({ data: rows, error: null, meta: null });
  } catch (error: unknown) {
    console.error('[AdminCarrierParks] GET / error:', error);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list carrier parks' }, meta: null },
      500,
    );
  }
});

export default adminCarrierParks;
