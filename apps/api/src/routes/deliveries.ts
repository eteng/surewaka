import { Hono } from 'hono';
import { eq, and, or, isNull, inArray } from 'drizzle-orm';
import { db, deliveries, deliveryLegs, users, carriers, carrierRoutes, feeSettings, vehicleTypeRates, quotes, carrierParks } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { requireLegActor } from '../middleware/require-leg-actor';
import { createDeliverySchema, weightCorrectionRequestSchema, weightCorrectionRespondSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import type { FeeSettings, VehicleType, VehicleTypeRates } from '@surewaka/shared';
import { calculateSystemEta } from '../lib/eta-calculator';
import { createAuthoritativeQuotesForDelivery, supersedeLeg } from '../services/quote-service';
import { computeOnDemandQuote, computeCarrierQuote } from '../lib/fee-engine';
import { respondToCorrection, reportDiscrepancy } from '../services/weight-correction-service';
import { getRoadDistanceKm } from '@surewaka/shared';
import { enqueueRouteDelivery } from '../lib/routing-queue';

type DeliveriesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    leg: {
      id: string;
      deliveryId: string;
      actorType: string;
      actorId: string;
      legNumber: number;
      legType: string;
      status: string;
      isActive: boolean;
      systemEtaAt: Date | null;
      slaHours: number | null;
      pickupLng: number;
      pickupLat: number;
      dropoffLng: number;
      dropoffLat: number;
    };
  };
};

const deliveryRoutes = new Hono<DeliveriesEnv>();

deliveryRoutes.use('*', requireAuth);

deliveryRoutes.get('/', async (c) => {
  const user = c.get('user');
  try {
    const rows = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.customerId, user.id));
    return c.json({ data: { deliveries: rows, total: rows.length }, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list deliveries' }, meta: null }, 500);
  }
});

deliveryRoutes.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json();
  const parsed = createDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  // Task 29: Normalise city slugs — applies to all delivery modes
  parsed.data.pickup.city = parsed.data.pickup.city.trim().toLowerCase();
  parsed.data.dropoff.city = parsed.data.dropoff.city.trim().toLowerCase();

  // Task 30: surewaka_way branch — validate cities have parks, insert with pending_routing, enqueue job
  if (parsed.data.mode === 'surewaka_way') {
    if (parsed.data.pickup.city === parsed.data.dropoff.city) {
      return c.json({ error: { code: 'SAME_CITY', message: 'surewaka_way requires different pickup and dropoff cities' } }, 422);
    }

    const pickupParks = await db.select({ id: carrierParks.id })
      .from(carrierParks)
      .where(and(eq(carrierParks.city, parsed.data.pickup.city), eq(carrierParks.isActive, true)))
      .limit(1);
    if (pickupParks.length === 0) {
      return c.json({ error: { code: 'NO_PARKS_IN_CITY', message: `No active carrier parks in pickup city: ${parsed.data.pickup.city}` } }, 422);
    }

    const dropoffParks = await db.select({ id: carrierParks.id })
      .from(carrierParks)
      .where(and(eq(carrierParks.city, parsed.data.dropoff.city), eq(carrierParks.isActive, true)))
      .limit(1);
    if (dropoffParks.length === 0) {
      return c.json({ error: { code: 'NO_PARKS_IN_CITY', message: `No active carrier parks in dropoff city: ${parsed.data.dropoff.city}` } }, 422);
    }

    // Pre-fetch sender phone for senderPhone field
    const [senderRow] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, user.id));

    const [delivery] = await db.insert(deliveries).values({
      customerId:         user.id,
      status:             'pending_routing',
      deliveryMode:       'surewaka_way',
      pickupAddress:      parsed.data.pickup.address,
      pickupCity:         parsed.data.pickup.city,
      pickupLat:          parsed.data.pickup.lat,
      pickupLng:          parsed.data.pickup.lng,
      dropoffAddress:     parsed.data.dropoff.address,
      dropoffCity:        parsed.data.dropoff.city,
      dropoffLat:         parsed.data.dropoff.lat,
      dropoffLng:         parsed.data.dropoff.lng,
      packageDescription: parsed.data.packageDetails.description,
      packageWeight:      parsed.data.packageDetails.weight,
      packageCategory:    parsed.data.packageDetails.category,
      recipientName:      parsed.data.recipientDetails.recipientName,
      recipientPhone:     parsed.data.recipientDetails.recipientPhone,
      deliveryNotes:      parsed.data.recipientDetails.deliveryNotes ?? null,
      senderPhone:        senderRow?.phone ?? null,
    }).returning({ id: deliveries.id });

    await enqueueRouteDelivery({
      deliveryId: delivery.id,
      bookingTime: new Date().toISOString(),
      vehicleType: 'motorcycle',
    });

    return c.json({ data: { deliveryId: delivery.id, status: 'pending_routing' } }, 202);
  }

  const { pickup, dropoff, packageDetails, recipientDetails, legs } = parsed.data;

  try {
    // ── Pre-fetch reads outside the transaction ────────────────────────────────
    const [userRow] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, user.id));

    const systemEtaAt = calculateSystemEta(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng,
      'motorcycle', // default — driver vehicle type applied when driver is assigned
    );

    const hasIntercityLeg = legs ? legs.some(l => l.legType === 'intercity') : false;
    const derivedMode = hasIntercityLeg ? 'carrier_direct' : 'on_demand';

    // No legs — create delivery only (backwards-compatible path, no quotes)
    if (!legs || legs.length === 0) {
      const [delivery] = await db
        .insert(deliveries)
        .values({
          customerId:         user.id,
          status:             'draft',
          deliveryMode:       'on_demand',
          pickupAddress:      pickup.address,
          pickupCity:         pickup.city,
          pickupLat:          pickup.lat,
          pickupLng:          pickup.lng,
          dropoffAddress:     dropoff.address,
          dropoffCity:        dropoff.city,
          dropoffLat:         dropoff.lat,
          dropoffLng:         dropoff.lng,
          packageDescription: packageDetails.description,
          packageWeight:      packageDetails.weight,
          packageCategory:    packageDetails.category,
          recipientName:      recipientDetails.recipientName,
          recipientPhone:     recipientDetails.recipientPhone,
          deliveryNotes:      recipientDetails.deliveryNotes ?? null,
          senderPhone:        userRow?.phone ?? null,
          systemEtaAt,
        })
        .returning();

      return c.json({ data: delivery, error: null, meta: null }, 201);
    }

    // ── Legs provided — load config data before entering the transaction ───────

    const [settingsRow] = await db.select().from(feeSettings).limit(1);
    if (!settingsRow) {
      return c.json({ data: null, error: { code: 'CONFIG_ERROR', message: 'Fee settings not configured' }, meta: null }, 500);
    }

    const settings: FeeSettings = {
      baseRateKobo:                      settingsRow.baseRateKobo,
      perKgRateKobo:                     settingsRow.perKgRateKobo,
      perKmRateKobo:                     settingsRow.perKmRateKobo,
      carrierCommissionRatePct:          Number(settingsRow.carrierCommissionRatePct),
      taxRatePct:                        Number(settingsRow.taxRatePct),
      minPriceKobo:                      settingsRow.minPriceKobo,
      withdrawalFeeKobo:                 settingsRow.withdrawalFeeKobo,
      weightCorrectionApprovalWindowMin: settingsRow.weightCorrectionApprovalWindowMin,
    };

    const rateRows = await db.select().from(vehicleTypeRates);
    const vTypeRates: VehicleTypeRates = {
      motorcycle: { multiplier: 1.0 },
      car:        { multiplier: 1.3 },
      van:        { multiplier: 1.6 },
      truck:      { multiplier: 2.0 },
    };
    for (const row of rateRows) {
      vTypeRates[row.vehicleType as VehicleType] = { multiplier: Number(row.multiplier) };
    }

    const intercityLegs = legs.filter(
      (l): l is { legType: 'intercity'; carrierId: string; routeId?: string } =>
        l.legType === 'intercity',
    );
    const carrierIds = intercityLegs.map((l) => l.carrierId);

    const carriersMap = new Map<string, { basePrice: number; name: string }>();
    if (carrierIds.length > 0) {
      const carrierRows = await db
        .select({ id: carriers.id, basePrice: carriers.basePrice, name: carriers.name })
        .from(carriers)
        .where(inArray(carriers.id, carrierIds));

      for (const row of carrierRows) {
        carriersMap.set(row.id, { basePrice: row.basePrice ?? 0, name: row.name });
      }

      // Override with route-specific pricing when the client supplied a routeId.
      // Scope by both id AND carrierId so a mismatched pair is rejected, not silently ignored.
      const legsWithRoute = intercityLegs.filter(
        (l): l is { legType: 'intercity'; carrierId: string; routeId: string } => !!l.routeId,
      );
      if (legsWithRoute.length > 0) {
        const routeConditions = legsWithRoute.map((l) =>
          and(eq(carrierRoutes.id, l.routeId), eq(carrierRoutes.carrierId, l.carrierId)),
        );
        const routeRows = await db
          .select({ id: carrierRoutes.id, carrierId: carrierRoutes.carrierId, basePriceKobo: carrierRoutes.basePriceKobo })
          .from(carrierRoutes)
          .where(or(...routeConditions));

        if (routeRows.length !== legsWithRoute.length) {
          return c.json(
            { data: null, error: { code: 'ROUTE_NOT_FOUND', message: 'One or more route IDs do not match the specified carrier' }, meta: null },
            400,
          );
        }

        for (const route of routeRows) {
          const existing = carriersMap.get(route.carrierId);
          if (existing) {
            carriersMap.set(route.carrierId, { ...existing, basePrice: route.basePriceKobo });
          }
        }
      }
    }

    // ── Atomic: delivery + legs + quotes in a single transaction ──────────────
    //
    // If any step fails, the whole transaction rolls back — no orphaned delivery
    // records and no partially-written legs or quotes.

    const NIL_UUID = '00000000-0000-0000-0000-000000000000';

    const { delivery, compositeQuote } = await db.transaction(async (tx) => {
      // 1. Insert delivery
      const [delivery] = await tx
        .insert(deliveries)
        .values({
          customerId:         user.id,
          status:             'draft',
          deliveryMode:       derivedMode,
          pickupAddress:      pickup.address,
          pickupCity:         pickup.city,
          pickupLat:          pickup.lat,
          pickupLng:          pickup.lng,
          dropoffAddress:     dropoff.address,
          dropoffCity:        dropoff.city,
          dropoffLat:         dropoff.lat,
          dropoffLng:         dropoff.lng,
          packageDescription: packageDetails.description,
          packageWeight:      packageDetails.weight,
          packageCategory:    packageDetails.category,
          recipientName:      recipientDetails.recipientName,
          recipientPhone:     recipientDetails.recipientPhone,
          deliveryNotes:      recipientDetails.deliveryNotes ?? null,
          senderPhone:        userRow?.phone ?? null,
          systemEtaAt,
        })
        .returning();

      // 2. Insert delivery_legs
      const legInsertValues = legs.map((leg, index) => {
        if (leg.legType === 'intercity') {
          return {
            deliveryId:     delivery.id,
            legNumber:      index + 1,
            legType:        leg.legType,
            actorType:      'carrier' as const,
            actorId:        leg.carrierId,
            pickupAddress:  pickup.address,
            pickupLat:      pickup.lat,
            pickupLng:      pickup.lng,
            dropoffAddress: dropoff.address,
            dropoffLat:     dropoff.lat,
            dropoffLng:     dropoff.lng,
            status:         'pending' as const,
          };
        }
        return {
          deliveryId:     delivery.id,
          legNumber:      index + 1,
          legType:        leg.legType,
          actorType:      'driver' as const,
          actorId:        NIL_UUID, // placeholder until driver matching assigns a real driver
          pickupAddress:  pickup.address,
          pickupLat:      pickup.lat,
          pickupLng:      pickup.lng,
          dropoffAddress: dropoff.address,
          dropoffLat:     dropoff.lat,
          dropoffLng:     dropoff.lng,
          status:         'pending' as const,
        };
      });

      const insertedLegs = await tx
        .insert(deliveryLegs)
        .values(legInsertValues)
        .returning();

      // 3. Build quote inputs from inserted legs
      const quoteLegs = await Promise.all(insertedLegs.map(async (dbLeg, index) => {
        const inputLeg = legs[index];
        return {
          id:          dbLeg.id,
          legType:     dbLeg.legType,
          actorType:   dbLeg.actorType as 'driver' | 'carrier',
          actorId:     dbLeg.actorType === 'carrier' ? dbLeg.actorId : undefined,
          vehicleType: inputLeg.legType !== 'intercity'
            ? (inputLeg as { vehicleType: VehicleType }).vehicleType
            : undefined,
          distanceKm:  dbLeg.actorType === 'driver'
            ? await getRoadDistanceKm(dbLeg.pickupLat, dbLeg.pickupLng, dbLeg.dropoffLat, dbLeg.dropoffLng)
            : undefined,
        };
      }));

      // 4. Compute and persist authoritative quotes (tx — atomic with delivery + legs)
      const compositeQuote = await createAuthoritativeQuotesForDelivery(
        tx,
        delivery.id,
        quoteLegs,
        packageDetails.weight,
        settings,
        vTypeRates,
        carriersMap,
      );

      // 5. Stamp the composite total back onto the delivery row
      await tx
        .update(deliveries)
        .set({ priceKobo: compositeQuote.compositeTotalKobo })
        .where(eq(deliveries.id, delivery.id));

      return { delivery, compositeQuote };
    });

    const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    return c.json({
      data: {
        ...delivery,
        priceKobo: compositeQuote.compositeTotalKobo,
        quote: {
          legs: compositeQuote.legs.map((l) => ({
            legType:    l.legType,
            legLabel:   l.legLabel,
            lineItems:  l.quote.lineItems,
            totalKobo:  l.quote.totalKobo,
          })),
          compositeTotalKobo: compositeQuote.compositeTotalKobo,
          expiresAt:          quoteExpiresAt,
        },
      },
      error: null,
      meta: null,
    }, 201);
  } catch (err) {
    console.error('[POST /deliveries]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create delivery' }, meta: null }, 500);
  }
});

// ─── Re-Quote ─────────────────────────────────────────────────────────────────

/**
 * POST /deliveries/:id/requote
 *
 * Re-runs the Fee Engine for all legs of a delivery using the current fee_settings
 * and vehicle_type_rates. Supersedes prior quotes for each leg and updates the
 * delivery's priceKobo with the new composite total.
 *
 * Only callable when the delivery is in 'draft' or 'pending' status (pre-pickup).
 *
 * Requirements: 7.2
 */
deliveryRoutes.post('/:id/requote', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('id');

  try {
    // 1. Verify delivery exists and belongs to the authenticated customer
    const [delivery] = await db
      .select({
        id: deliveries.id,
        customerId: deliveries.customerId,
        status: deliveries.status,
        deliveryMode: deliveries.deliveryMode,
        packageWeight: deliveries.packageWeight,
        priceKobo: deliveries.priceKobo,
      })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));

    if (!delivery || delivery.customerId !== user.id) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
        404,
      );
    }

    // surewaka_way deliveries are re-routed via the routing worker when quotes expire —
    // the standard fee-engine requote path would use the wrong intercity pricing.
    if (delivery.deliveryMode === 'surewaka_way') {
      return c.json(
        {
          data: null,
          error: {
            code: 'NOT_REQUOTABLE',
            message: 'surewaka_way deliveries are re-routed automatically when quotes expire',
          },
          meta: null,
        },
        409,
      );
    }

    // 2. Validate delivery is in draft or pending status (pre-pickup)
    if (delivery.status !== 'draft' && delivery.status !== 'pending') {
      return c.json(
        {
          data: null,
          error: {
            code: 'DELIVERY_NOT_REQUOTABLE',
            message: 'Delivery can only be re-quoted in draft or pending status',
          },
          meta: null,
        },
        409,
      );
    }

    // 3. Load fee_settings and vehicle_type_rates
    const [settingsRow] = await db.select().from(feeSettings).limit(1);
    if (!settingsRow) {
      return c.json(
        { data: null, error: { code: 'CONFIG_ERROR', message: 'Fee settings not configured' }, meta: null },
        500,
      );
    }

    const settings: FeeSettings = {
      baseRateKobo: settingsRow.baseRateKobo,
      perKgRateKobo: settingsRow.perKgRateKobo,
      perKmRateKobo: settingsRow.perKmRateKobo,
      carrierCommissionRatePct: Number(settingsRow.carrierCommissionRatePct),
      taxRatePct: Number(settingsRow.taxRatePct),
      minPriceKobo: settingsRow.minPriceKobo,
      withdrawalFeeKobo: settingsRow.withdrawalFeeKobo,
      weightCorrectionApprovalWindowMin: settingsRow.weightCorrectionApprovalWindowMin,
    };

    const rateRows = await db.select().from(vehicleTypeRates);
    const vTypeRates: VehicleTypeRates = {
      motorcycle: { multiplier: 1.0 },
      car: { multiplier: 1.3 },
      van: { multiplier: 1.6 },
      truck: { multiplier: 2.0 },
    };
    for (const row of rateRows) {
      const vt = row.vehicleType as VehicleType;
      vTypeRates[vt] = { multiplier: Number(row.multiplier) };
    }

    // 4. Load all delivery_legs for this delivery
    const legs = await db
      .select()
      .from(deliveryLegs)
      .where(eq(deliveryLegs.deliveryId, deliveryId));

    if (legs.length === 0) {
      return c.json(
        { data: null, error: { code: 'NO_LEGS', message: 'No delivery legs found' }, meta: null },
        422,
      );
    }

    // 5. Load active quotes to extract vehicleType per on-demand leg
    const activeQuotes = await db
      .select({
        deliveryLegId: quotes.deliveryLegId,
        lineItems: quotes.lineItems,
        distanceKm: quotes.distanceKm,
        totalKobo: quotes.totalKobo,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.deliveryId, deliveryId),
          isNull(quotes.supersededAt),
          isNull(quotes.confirmedAt),
        ),
      );

    const quoteByLegId = new Map(
      activeQuotes.map((q) => [q.deliveryLegId, q]),
    );

    // 6. Load carrier data for any carrier legs
    const carrierLegIds = legs
      .filter((l) => l.actorType === 'carrier')
      .map((l) => l.actorId);

    const carriersMap = new Map<string, { basePrice: number; name: string }>();
    if (carrierLegIds.length > 0) {
      const carrierRows = await db
        .select({ id: carriers.id, basePrice: carriers.basePrice, name: carriers.name })
        .from(carriers)
        .where(inArray(carriers.id, carrierLegIds));

      for (const row of carrierRows) {
        carriersMap.set(row.id, { basePrice: row.basePrice ?? 0, name: row.name });
      }
    }

    // 7. Re-quote each leg: compute new quote and supersede the old one
    const previousTotalKobo = delivery.priceKobo ?? 0;
    const legResults: Array<{
      legType: string;
      legLabel: string;
      lineItems: Array<{ label: string; amountKobo: number }>;
      totalKobo: number;
    }> = [];

    for (const leg of legs) {
      if (leg.actorType === 'driver') {
        // On-demand leg — extract vehicleType from existing quote's line items
        const existingQuote = quoteByLegId.get(leg.id);
        const vehicleType = existingQuote
          ? extractVehicleTypeFromQuote(
              existingQuote.lineItems as Array<{ label: string; amountKobo: number }>,
            )
          : 'motorcycle';

        // Compute distance from leg coordinates
        const distanceKm = await getRoadDistanceKm(
          leg.pickupLat,
          leg.pickupLng,
          leg.dropoffLat,
          leg.dropoffLng,
        );

        const newQuote = computeOnDemandQuote(
          { packageWeight: delivery.packageWeight, distanceKm, vehicleType },
          settings,
          vTypeRates,
        );

        // Supersede the old quote and persist the new one
        await supersedeLeg(db, leg.id, deliveryId, newQuote, {
          distanceKm,
          packageWeightKg: delivery.packageWeight,
        });

        legResults.push({
          legType: leg.legType,
          legLabel: buildRequoteLegLabel(leg.legType, leg.actorType),
          lineItems: newQuote.lineItems,
          totalKobo: newQuote.totalKobo,
        });
      } else {
        // Carrier leg — recompute with current carrier basePrice
        const carrier = carriersMap.get(leg.actorId);
        const basePrice = carrier?.basePrice ?? 0;
        const carrierName = carrier?.name;

        const newQuote = computeCarrierQuote(
          { carrierBasePrice: basePrice, carrierName },
          settings,
        );

        // Supersede the old quote and persist the new one
        await supersedeLeg(db, leg.id, deliveryId, newQuote, {
          carrierId: leg.actorId,
        });

        legResults.push({
          legType: leg.legType,
          legLabel: buildRequoteLegLabel(leg.legType, leg.actorType, carrierName),
          lineItems: newQuote.lineItems,
          totalKobo: newQuote.totalKobo,
        });
      }
    }

    // 8. Compute new composite total (apply minimum price floor)
    const rawTotal = legResults.reduce((sum, l) => sum + l.totalKobo, 0);
    const compositeTotalKobo = Math.max(rawTotal, settings.minPriceKobo);

    // New quotes expire 15 minutes from now
    const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // 9. Update delivery priceKobo with new composite total
    await db
      .update(deliveries)
      .set({ priceKobo: compositeTotalKobo })
      .where(eq(deliveries.id, deliveryId));

    // 10. Return new composite quote + previous total
    return c.json({
      data: {
        quote: {
          legs: legResults,
          compositeTotalKobo,
          expiresAt: quoteExpiresAt,
        },
        previousTotalKobo,
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    console.error('[POST /deliveries/:id/requote]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to re-quote delivery' }, meta: null },
      500,
    );
  }
});

deliveryRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  try {
    const [delivery] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, id));

    if (!delivery || delivery.customerId !== user.id) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
    }

    // For surewaka_way draft deliveries, additionally join and return the active composite quote.
    // This lets the mobile app display the computed route + price while the customer reviews.
    if (delivery.status === 'draft' && delivery.deliveryMode === 'surewaka_way') {
      const now = new Date();

      // Fetch active legs
      const activeLegs = await db
        .select({ id: deliveryLegs.id, legType: deliveryLegs.legType })
        .from(deliveryLegs)
        .where(and(eq(deliveryLegs.deliveryId, id), eq(deliveryLegs.isActive, true)));

      if (activeLegs.length > 0) {
        const legIds = activeLegs.map((l) => l.id);

        // Fetch active (non-superseded, non-confirmed) quotes for these legs
        const activeQuoteRows = await db
          .select({
            deliveryLegId: quotes.deliveryLegId,
            lineItems: quotes.lineItems,
            totalKobo: quotes.totalKobo,
            expiresAt: quotes.expiresAt,
          })
          .from(quotes)
          .where(
            and(
              eq(quotes.deliveryId, id),
              inArray(quotes.deliveryLegId, legIds),
              isNull(quotes.supersededAt),
              isNull(quotes.confirmedAt),
            ),
          );

        // Filter out expired quotes — all must be valid for the composite to be valid
        const validQuotes = activeQuoteRows.filter((q) => q.expiresAt > now);

        if (validQuotes.length > 0) {
          const legTypeMap = new Map(activeLegs.map((l) => [l.id, l.legType]));
          const legOrder: Record<string, number> = {
            first_mile: 0,
            intercity: 1,
            transfer: 2,
            last_mile: 3,
          };

          // Build per-leg breakdown from lineItems, sorted by leg order
          const quoteLegs = validQuotes
            .map((q) => {
              const legType = legTypeMap.get(q.deliveryLegId) ?? q.deliveryLegId;
              const lineItemsArr = q.lineItems as Array<{ label: string; amountKobo: number }>;
              const commissionItem = lineItemsArr.find((item) => item.label === 'SureWaka service fee');
              const commissionKobo = commissionItem?.amountKobo ?? 0;
              const basePriceKobo = q.totalKobo - commissionKobo;
              return { legType, basePriceKobo, commissionKobo, totalKobo: q.totalKobo, expiresAt: q.expiresAt };
            })
            .sort((a, b) => (legOrder[a.legType] ?? 99) - (legOrder[b.legType] ?? 99));

          const compositeTotalKobo = quoteLegs.reduce((sum, q) => sum + q.totalKobo, 0);
          // Use the earliest expiry so the client knows when it must confirm by
          const minExpiresAt = quoteLegs.reduce(
            (min, q) => (q.expiresAt < min ? q.expiresAt : min),
            quoteLegs[0].expiresAt,
          );

          const quote = {
            legs: quoteLegs.map(({ legType, basePriceKobo, commissionKobo, totalKobo }) => ({
              legType,
              basePriceKobo,
              commissionKobo,
              totalKobo,
            })),
            compositeTotalKobo,
            expiresAt: minExpiresAt.toISOString(),
            estimatedDeliveryAt: delivery.systemEtaAt?.toISOString() ?? null,
          };

          return c.json({ data: { ...delivery, quote }, error: null, meta: null });
        }
      }
      // No active/valid quotes — fall through and return the delivery without quote field
    }

    return c.json({ data: delivery, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to get delivery' }, meta: null }, 500);
  }
});

// ─── Weight Correction Report ─────────────────────────────────────────────────

/**
 * POST /deliveries/:id/legs/:legId/weight-correction
 *
 * Driver-only. Reports a weight discrepancy at pickup.
 * The leg must be an on-demand leg (actor_type = 'driver') at `arrived_pickup` status.
 *
 * Authorization: requireLegActor verifies the user is the assigned driver for this leg.
 *
 * Requirements: 12.1, 12.2
 */
deliveryRoutes.post(
  '/:id/legs/:legId/weight-correction',
  requireRole('driver'),
  requireLegActor,
  async (c) => {
    const leg = c.get('leg') as { id: string; deliveryId: string; actorType: string; status: string };
    const deliveryId = c.req.param('id');
    const legId = c.req.param('legId');

    // 1. Parse and validate request body
    const body = await c.req.json();
    const parsed = weightCorrectionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
        400,
      );
    }

    const { reportedWeightKg } = parsed.data;

    try {
      // 2. Validate the leg is an on-demand leg (actor_type = 'driver')
      if (leg.actorType !== 'driver') {
        return c.json(
          { data: null, error: { code: 'NOT_FOUND', message: 'On-demand leg not found' }, meta: null },
          404,
        );
      }

      // 3. Validate the leg is at `arrived_pickup` status
      if (leg.status !== 'arrived_pickup') {
        return c.json(
          { data: null, error: { code: 'INVALID_STATUS', message: 'Leg must be at arrived_pickup status to report weight correction' }, meta: null },
          409,
        );
      }

      // 5. Load fee_settings and vehicle_type_rates
      const [settingsRow] = await db.select().from(feeSettings).limit(1);
      if (!settingsRow) {
        return c.json(
          { data: null, error: { code: 'CONFIG_ERROR', message: 'Fee settings not configured' }, meta: null },
          500,
        );
      }

      const settings: FeeSettings = {
        baseRateKobo: settingsRow.baseRateKobo,
        perKgRateKobo: settingsRow.perKgRateKobo,
        perKmRateKobo: settingsRow.perKmRateKobo,
        carrierCommissionRatePct: Number(settingsRow.carrierCommissionRatePct),
        taxRatePct: Number(settingsRow.taxRatePct),
        minPriceKobo: settingsRow.minPriceKobo,
        withdrawalFeeKobo: settingsRow.withdrawalFeeKobo,
        weightCorrectionApprovalWindowMin: settingsRow.weightCorrectionApprovalWindowMin,
      };

      const rateRows = await db.select().from(vehicleTypeRates);
      const vTypeRates: VehicleTypeRates = {
        motorcycle: { multiplier: 1.0 },
        car: { multiplier: 1.3 },
        van: { multiplier: 1.6 },
        truck: { multiplier: 2.0 },
      };
      for (const row of rateRows) {
        const vt = row.vehicleType as VehicleType;
        vTypeRates[vt] = { multiplier: Number(row.multiplier) };
      }

      // 6. Call reportDiscrepancy
      const result = await reportDiscrepancy(
        db,
        deliveryId,
        legId,
        reportedWeightKg,
        settings,
        vTypeRates,
      );

      // 7. Return correction details
      return c.json({
        data: {
          correctionId: result.correctionId,
          declaredWeightKg: result.declaredWeightKg,
          reportedWeightKg: result.reportedWeightKg,
          deltaKobo: result.deltaKobo,
          approvalDeadline: result.approvalDeadline.toISOString(),
        },
        error: null,
        meta: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      if (message === 'WITHIN_TOLERANCE') {
        return c.json(
          { data: { status: 'within_tolerance' }, error: null, meta: null },
          200,
        );
      }

      if (message === 'WEIGHT_DELTA_TOO_LARGE') {
        return c.json(
          {
            data: null,
            error: {
              code: 'WEIGHT_DELTA_TOO_LARGE',
              message: 'Reported weight exceeds 3× declared. Contact support for manual review.',
            },
            meta: null,
          },
          422,
        );
      }

      if (message === 'Delivery not found') {
        return c.json(
          { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
          404,
        );
      }

      if (message === 'No on-demand legs found for this delivery') {
        return c.json(
          { data: null, error: { code: 'NOT_FOUND', message: 'No on-demand legs found for this delivery' }, meta: null },
          404,
        );
      }

      console.error('[POST /deliveries/:id/legs/:legId/weight-correction]', err);
      return c.json(
        { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to report weight correction' }, meta: null },
        500,
      );
    }
  },
);

// ─── Weight Correction Respond ────────────────────────────────────────────────

deliveryRoutes.post('/:id/weight-correction/:correctionId/respond', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('id');
  const correctionId = c.req.param('correctionId');

  // 1. Parse and validate request body
  const body = await c.req.json();
  const parsed = weightCorrectionRespondSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const { decision } = parsed.data;

  try {
    // 2. Verify delivery exists and belongs to the authenticated customer
    const [delivery] = await db
      .select({ id: deliveries.id, customerId: deliveries.customerId })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));

    if (!delivery || delivery.customerId !== user.id) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
        404,
      );
    }

    // 3. Call respondToCorrection service
    const result = await respondToCorrection(db, correctionId, decision);

    // 4. Return the result
    return c.json({ data: result, error: null, meta: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message === 'CORRECTION_NOT_FOUND') {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Correction not found' }, meta: null },
        404,
      );
    }

    if (message === 'CORRECTION_ALREADY_RESPONDED') {
      return c.json(
        { data: null, error: { code: 'CORRECTION_ALREADY_RESPONDED', message: 'Correction has already been responded to' }, meta: null },
        409,
      );
    }

    if (message === 'CORRECTION_EXPIRED') {
      return c.json(
        { data: null, error: { code: 'CORRECTION_EXPIRED', message: 'Correction approval window has expired' }, meta: null },
        410,
      );
    }

    console.error('[POST /deliveries/:id/weight-correction/:correctionId/respond]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to respond to weight correction' }, meta: null },
      500,
    );
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the vehicle type from a quote's line_items jsonb array.
 *
 * The on-demand quote produces a line item with label format:
 *   "Vehicle type (car × 1.3)"
 *
 * We parse the vehicle type from that label. Falls back to 'motorcycle'
 * if no vehicle type line item is found.
 */
function extractVehicleTypeFromQuote(
  lineItems: Array<{ label: string; amountKobo: number }>,
): VehicleType {
  const vehicleTypeLine = lineItems.find((item) =>
    item.label.startsWith('Vehicle type ('),
  );
  if (!vehicleTypeLine) return 'motorcycle';

  const match = vehicleTypeLine.label.match(/^Vehicle type \((\w+)/);
  if (match && ['motorcycle', 'car', 'van', 'truck'].includes(match[1])) {
    return match[1] as VehicleType;
  }
  return 'motorcycle';
}

/**
 * Builds a human-readable label for a leg in the re-quote composite breakdown.
 */
function buildRequoteLegLabel(
  legType: string,
  actorType: string,
  carrierName?: string,
): string {
  switch (legType) {
    case 'first_mile':
      return 'First-mile pickup';
    case 'last_mile':
      return 'Last-mile delivery';
    case 'intercity':
      return carrierName ? `Intercity \u2014 ${carrierName}` : 'Intercity transport';
    default:
      return legType;
  }
}

export default deliveryRoutes;
