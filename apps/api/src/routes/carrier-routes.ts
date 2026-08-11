// Feature: routing-worker
// Public carrier routes endpoint — returns active intercity routes for a city pair
// with next departure time in WAT.
// Requirements: 26.1
// City resolution: .kiro/specs/booking-city-classification — classified server-side
// via classifyZone (lat/lng + address text), not a client-supplied city string.

import { Hono } from 'hono';
import { db, carrierRoutes, carrierRouteSchedules, carrierParks, carriers } from '@surewaka/db';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { classifyZone } from '../lib/zone-classifier';

const carrierRoutesPublic = new Hono();

carrierRoutesPublic.use('*', requireAuth);

/**
 * GET /?fromLat=&fromLng=&fromAddress=&toLat=&toLng=&toAddress=
 *
 * Classifies both coordinate pairs into a zone (and therefore a canonical
 * city) via classifyZone, then returns active carrier routes for that city
 * pair with the next scheduled departure (WAT).
 */
carrierRoutesPublic.get('/', async (c) => {
  const fromLat = Number(c.req.query('fromLat'));
  const fromLng = Number(c.req.query('fromLng'));
  const toLat = Number(c.req.query('toLat'));
  const toLng = Number(c.req.query('toLng'));
  const fromAddress = c.req.query('fromAddress') ?? '';
  const toAddress = c.req.query('toAddress') ?? '';

  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
    return c.json(
      { data: null, error: { code: 'MISSING_PARAMS', message: 'fromLat, fromLng, toLat, and toLng are required' }, meta: null },
      400,
    );
  }

  const [pickupZone, dropoffZone] = await Promise.all([
    classifyZone(fromAddress, fromLat, fromLng),
    classifyZone(toAddress, toLat, toLng),
  ]);

  if (!pickupZone || !dropoffZone) {
    return c.json(
      {
        data: null,
        error: {
          code: 'UNCLASSIFIED_LOCATION',
          message: "We couldn't determine the service area for one of these locations.",
        },
        meta: null,
      },
      422,
    );
  }

  const fromCity = pickupZone.city.trim().toLowerCase();
  const toCity = dropoffZone.city.trim().toLowerCase();
  const sameCity = fromCity === toCity;

  try {
    // Load active routes where origin park is in fromCity
    const rows = await db
      .select({
        routeId: carrierRoutes.id,
        carrierId: carrierRoutes.carrierId,
        basePriceKobo: carrierRoutes.basePriceKobo,
        estimatedTransitHrs: carrierRoutes.estimatedTransitHrs,
        maxWeightKg: carrierRoutes.maxWeightKg,
        originParkId: carrierRoutes.originParkId,
        destinationParkId: carrierRoutes.destinationParkId,
      })
      .from(carrierRoutes)
      .innerJoin(carrierParks, eq(carrierRoutes.originParkId, carrierParks.id))
      .where(and(
        eq(carrierRoutes.isActive, true),
        sql`lower(${carrierParks.city}) = ${fromCity}`,
      ));

    // Load active parks in destination city to filter routes
    const destParkCheck = await db
      .select({ id: carrierParks.id })
      .from(carrierParks)
      .where(sql`lower(${carrierParks.city}) = ${toCity} AND ${carrierParks.isActive} = true`);

    const destParkIds = new Set(destParkCheck.map((r) => r.id));
    const filtered = rows.filter((r) => destParkIds.has(r.destinationParkId));

    // For each route, load active schedules and compute nextDepartureAt (WAT inline)
    const result = await Promise.all(filtered.map(async (route) => {
      const schedules = await db
        .select()
        .from(carrierRouteSchedules)
        .where(and(
          eq(carrierRouteSchedules.carrierRouteId, route.routeId),
          eq(carrierRouteSchedules.isActive, true),
        ));

      let nextDepartureAt: string | null = null;

      if (schedules.length > 0) {
        const slots = schedules.map((s) => ({
          hour: s.hour,
          minute: s.minute,
          daysOfWeek: s.daysOfWeek ?? [],
        }));

        // Inline WAT calculation — WAT is UTC+1, no DST in Nigeria
        const WAT_OFFSET_MS = 60 * 60 * 1000;
        const now = new Date();
        const watMs = now.getTime() + WAT_OFFSET_MS;
        const watDate = new Date(watMs);
        const watYear = watDate.getUTCFullYear();
        const watMonth = watDate.getUTCMonth();
        const watDay = watDate.getUTCDate();
        const watHour = watDate.getUTCHours();
        const watMinute = watDate.getUTCMinutes();

        const isoWeekday = (y: number, m: number, d: number) => {
          const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
          return dow === 0 ? 7 : dow;
        };

        for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
          const candidateDate = new Date(Date.UTC(watYear, watMonth, watDay + dayOffset));
          const cy = candidateDate.getUTCFullYear();
          const cm = candidateDate.getUTCMonth();
          const cd = candidateDate.getUTCDate();
          const candidateWeekday = isoWeekday(cy, cm, cd);

          const validSlots = slots.filter((slot) => {
            if (slot.daysOfWeek.length > 0 && !slot.daysOfWeek.includes(candidateWeekday)) return false;
            if (dayOffset === 0) {
              if (slot.hour < watHour) return false;
              if (slot.hour === watHour && slot.minute <= watMinute) return false;
            }
            return true;
          });

          if (validSlots.length === 0) continue;

          const earliest = validSlots.reduce((a, b) =>
            a.hour * 60 + a.minute < b.hour * 60 + b.minute ? a : b,
          );
          const depUtcMs =
            Date.UTC(cy, cm, cd, earliest.hour, earliest.minute, 0, 0) - WAT_OFFSET_MS;
          nextDepartureAt = new Date(depUtcMs).toISOString();
          break;
        }
      }

      // Resolve carrier name
      const [carrier] = await db
        .select({ name: carriers.name })
        .from(carriers)
        .where(eq(carriers.id, route.carrierId));

      return {
        routeId: route.routeId,
        carrierId: route.carrierId,
        carrierName: carrier?.name ?? 'Unknown',
        basePriceKobo: route.basePriceKobo,
        estimatedTransitHours: route.estimatedTransitHrs,
        maxWeightKg: route.maxWeightKg,
        nextDepartureAt,
      };
    }));

    return c.json({
      data: result,
      error: null,
      meta: { fromCity: pickupZone.city, toCity: dropoffZone.city, sameCity },
    });
  } catch (err) {
    console.error('[GET /carrier-routes]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load carrier routes' }, meta: null },
      500,
    );
  }
});

export default carrierRoutesPublic;
