// Feature: dynamic-zones
// Admin zone CRUD routes — create, update, and partial-update zones.
// Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 3.8

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { createZoneSchema, updateZoneSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { db, zones } from '@surewaka/db';
import { eq, and, ne } from 'drizzle-orm';
import { invalidateZoneCache } from '../../lib/zone-classifier';

type Env = { Variables: { user: AuthUser } };

const adminZones = new Hono<Env>();

adminZones.use('*', requireAuth);
adminZones.use('*', requireRole('surewaka_admin'));

/**
 * Check keyword uniqueness within the same (city, country).
 * Returns a conflict response if overlap is found, or null if clear.
 */
async function checkKeywordConflict(
  city: string,
  country: string,
  keywords: string[],
  excludeZoneId?: string,
) {
  const conditions = [
    eq(zones.city, city),
    eq(zones.country, country),
    eq(zones.isActive, true),
  ];

  if (excludeZoneId) {
    conditions.push(ne(zones.id, excludeZoneId));
  }

  const siblings = await db
    .select()
    .from(zones)
    .where(and(...conditions));

  for (const sibling of siblings) {
    for (const kw of keywords) {
      if (sibling.keywords.some((sk) => sk.toLowerCase() === kw.toLowerCase())) {
        return {
          code: 'KEYWORD_CONFLICT' as const,
          message: `Keyword '${kw}' is already assigned to zone '${sibling.name}' in ${city}, ${country}`,
        };
      }
    }
  }

  return null;
}

// ─── POST / — Create zone ─────────────────────────────────────────────────────

adminZones.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createZoneSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const { name, city, country, keywords, swLat, swLng, neLat, neLng, isActive } = parsed.data;

  // Check keyword uniqueness within same (city, country)
  const conflict = await checkKeywordConflict(city, country, keywords);
  if (conflict) {
    return c.json({ data: null, error: conflict, meta: null }, 409);
  }

  try {
    const [created] = await db
      .insert(zones)
      .values({
        name,
        city,
        country,
        keywords,
        swLat: swLat ?? null,
        swLng: swLng ?? null,
        neLat: neLat ?? null,
        neLng: neLng ?? null,
        isActive: isActive ?? true,
      })
      .returning();

    invalidateZoneCache();

    return c.json({ data: created, error: null, meta: null }, 201);
  } catch (error: unknown) {
    // Handle unique constraint violation (name + city + country)
    const isUniqueViolation =
      (error instanceof Error && error.message.includes('unique')) ||
      (error as { code?: string })?.code === '23505';

    if (isUniqueViolation) {
      return c.json(
        {
          data: null,
          error: {
            code: 'DUPLICATE_ZONE',
            message: `A zone with name '${name}' already exists in ${city}, ${country}`,
          },
          meta: null,
        },
        409,
      );
    }
    console.error('[AdminZones] POST / error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create zone' },
        meta: null,
      },
      500,
    );
  }
});

// ─── PUT /:id — Full update ───────────────────────────────────────────────────

adminZones.put('/:id', async (c) => {
  const zoneId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createZoneSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  // Check zone exists
  const [existing] = await db
    .select({ id: zones.id })
    .from(zones)
    .where(eq(zones.id, zoneId))
    .limit(1);

  if (!existing) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
        meta: null,
      },
      404,
    );
  }

  const { name, city, country, keywords, swLat, swLng, neLat, neLng, isActive } = parsed.data;

  // Check keyword uniqueness within same (city, country), excluding self
  const conflict = await checkKeywordConflict(city, country, keywords, zoneId);
  if (conflict) {
    return c.json({ data: null, error: conflict, meta: null }, 409);
  }

  try {
    const [updated] = await db
      .update(zones)
      .set({
        name,
        city,
        country,
        keywords,
        swLat: swLat ?? null,
        swLng: swLng ?? null,
        neLat: neLat ?? null,
        neLng: neLng ?? null,
        isActive: isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(zones.id, zoneId))
      .returning();

    invalidateZoneCache();

    return c.json({ data: updated, error: null, meta: null }, 200);
  } catch (error: unknown) {
    // Handle unique constraint violation (name + city + country)
    const isUniqueViolation =
      (error instanceof Error && error.message.includes('unique')) ||
      (error as { code?: string })?.code === '23505';

    if (isUniqueViolation) {
      return c.json(
        {
          data: null,
          error: {
            code: 'DUPLICATE_ZONE',
            message: `A zone with name '${name}' already exists in ${city}, ${country}`,
          },
          meta: null,
        },
        409,
      );
    }
    console.error('[AdminZones] PUT /:id error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update zone' },
        meta: null,
      },
      500,
    );
  }
});

// ─── PATCH /:id — Partial update (e.g., toggle active) ───────────────────────

adminZones.patch('/:id', async (c) => {
  const zoneId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateZoneSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  // Check zone exists
  const [existing] = await db
    .select()
    .from(zones)
    .where(eq(zones.id, zoneId))
    .limit(1);

  if (!existing) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
        meta: null,
      },
      404,
    );
  }

  const updates = parsed.data;

  // If keywords or city/country are being updated, check keyword uniqueness
  const effectiveCity = updates.city ?? existing.city;
  const effectiveCountry = updates.country ?? existing.country;
  const effectiveKeywords = updates.keywords ?? existing.keywords;

  if (updates.keywords || updates.city || updates.country) {
    const conflict = await checkKeywordConflict(
      effectiveCity,
      effectiveCountry,
      effectiveKeywords,
      zoneId,
    );
    if (conflict) {
      return c.json({ data: null, error: conflict, meta: null }, 409);
    }
  }

  try {
    // Build the set object with only provided fields
    const setValues: Record<string, unknown> = { updatedAt: new Date() };

    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.city !== undefined) setValues.city = updates.city;
    if (updates.country !== undefined) setValues.country = updates.country;
    if (updates.keywords !== undefined) setValues.keywords = updates.keywords;
    if (updates.swLat !== undefined) setValues.swLat = updates.swLat ?? null;
    if (updates.swLng !== undefined) setValues.swLng = updates.swLng ?? null;
    if (updates.neLat !== undefined) setValues.neLat = updates.neLat ?? null;
    if (updates.neLng !== undefined) setValues.neLng = updates.neLng ?? null;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;

    const [updated] = await db
      .update(zones)
      .set(setValues)
      .where(eq(zones.id, zoneId))
      .returning();

    invalidateZoneCache();

    return c.json({ data: updated, error: null, meta: null }, 200);
  } catch (error: unknown) {
    // Handle unique constraint violation (name + city + country)
    const isUniqueViolation =
      (error instanceof Error && error.message.includes('unique')) ||
      (error as { code?: string })?.code === '23505';

    if (isUniqueViolation) {
      return c.json(
        {
          data: null,
          error: {
            code: 'DUPLICATE_ZONE',
            message: `A zone with name '${updates.name ?? existing.name}' already exists in ${effectiveCity}, ${effectiveCountry}`,
          },
          meta: null,
        },
        409,
      );
    }
    console.error('[AdminZones] PATCH /:id error:', error);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update zone' },
        meta: null,
      },
      500,
    );
  }
});

export default adminZones;
