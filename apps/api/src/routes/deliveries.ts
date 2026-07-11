import { Hono } from 'hono';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, deliveries, deliveryLegs, users, carriers, feeSettings, vehicleTypeRates, quotes } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { createDeliverySchema, weightCorrectionRequestSchema, weightCorrectionRespondSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import type { FeeSettings, VehicleType, VehicleTypeRates } from '@surewaka/shared';
import { calculateSystemEta, haversineKm } from '../lib/eta-calculator';
import { createAuthoritativeQuotesForDelivery, supersedeLeg } from '../services/quote-service';
import { computeOnDemandQuote, computeCarrierQuote } from '../lib/fee-engine';
import { respondToCorrection, reportDiscrepancy } from '../services/weight-correction-service';

type DeliveriesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
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

  const { pickup, dropoff, packageDetails, recipientDetails, legs } = parsed.data;

  try {
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

    // Create the delivery
    const [delivery] = await db
      .insert(deliveries)
      .values({
        customerId:         user.id,
        status:             'draft',
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
        systemEtaAt:        systemEtaAt,
      })
      .returning();

    // If no legs provided, return delivery without quotes (backwards-compatible)
    if (!legs || legs.length === 0) {
      return c.json({ data: delivery, error: null, meta: null }, 201);
    }

    // Load fee_settings and vehicle_type_rates
    const [settingsRow] = await db.select().from(feeSettings).limit(1);
    if (!settingsRow) {
      return c.json({ data: null, error: { code: 'CONFIG_ERROR', message: 'Fee settings not configured' }, meta: null }, 500);
    }

    const settings: FeeSettings = {
      baseRateKobo: settingsRow.baseRateKobo,
      perKgRateKobo: settingsRow.perKgRateKobo,
      perKmRateKobo: settingsRow.perKmRateKobo,
      carrierCommissionRatePct: Number(settingsRow.carrierCommissionRatePct),
      taxRatePct: Number(settingsRow.taxRatePct),
      minPriceKobo: settingsRow.minPriceKobo,
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

    // Load carrier data for any intercity legs
    const carrierIds = legs
      .filter((l): l is { legType: 'intercity'; carrierId: string } => l.legType === 'intercity')
      .map((l) => l.carrierId);

    const carriersMap = new Map<string, { basePrice: number; name: string }>();
    if (carrierIds.length > 0) {
      const carrierRows = await db
        .select({ id: carriers.id, basePrice: carriers.basePrice, name: carriers.name })
        .from(carriers)
        .where(inArray(carriers.id, carrierIds));

      for (const row of carrierRows) {
        carriersMap.set(row.id, { basePrice: row.basePrice ?? 0, name: row.name });
      }
    }

    // Create delivery_legs rows
    const NIL_UUID = '00000000-0000-0000-0000-000000000000';
    const legInsertValues = legs.map((leg, index) => {
      const legNumber = index + 1;
      if (leg.legType === 'intercity') {
        return {
          deliveryId: delivery.id,
          legNumber,
          legType: leg.legType,
          actorType: 'carrier' as const,
          actorId: leg.carrierId,
          pickupAddress: pickup.address,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffAddress: dropoff.address,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          status: 'pending' as const,
        };
      }
      // On-demand leg (first_mile or last_mile)
      return {
        deliveryId: delivery.id,
        legNumber,
        legType: leg.legType,
        actorType: 'driver' as const,
        actorId: NIL_UUID, // placeholder until driver matching assigns a real driver
        pickupAddress: pickup.address,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffAddress: dropoff.address,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        status: 'pending' as const,
      };
    });

    const insertedLegs = await db
      .insert(deliveryLegs)
      .values(legInsertValues)
      .returning();

    // Build the legs array for the quote service
    const quoteLegs = insertedLegs.map((dbLeg, index) => {
      const inputLeg = legs[index];
      const distanceKm = dbLeg.actorType === 'driver'
        ? haversineKm(dbLeg.pickupLat, dbLeg.pickupLng, dbLeg.dropoffLat, dbLeg.dropoffLng)
        : undefined;

      return {
        id: dbLeg.id,
        legType: dbLeg.legType,
        actorType: dbLeg.actorType as 'driver' | 'carrier',
        actorId: dbLeg.actorType === 'carrier' ? dbLeg.actorId : undefined,
        vehicleType: inputLeg.legType !== 'intercity' ? (inputLeg as { vehicleType: VehicleType }).vehicleType : undefined,
        distanceKm,
      };
    });

    // Create authoritative quotes for all legs
    const compositeQuote = await createAuthoritativeQuotesForDelivery(
      db,
      delivery.id,
      quoteLegs,
      packageDetails.weight,
      settings,
      vTypeRates,
      carriersMap,
    );

    // Update delivery with the composite total as priceKobo
    await db
      .update(deliveries)
      .set({ priceKobo: compositeQuote.compositeTotalKobo })
      .where(eq(deliveries.id, delivery.id));

    // Compute expiresAt matching what was persisted (15 minutes from creation)
    const quoteExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    return c.json({
      data: {
        ...delivery,
        priceKobo: compositeQuote.compositeTotalKobo,
        quote: {
          legs: compositeQuote.legs.map((l) => ({
            legType: l.legType,
            legLabel: l.legLabel,
            lineItems: l.quote.lineItems,
            totalKobo: l.quote.totalKobo,
          })),
          compositeTotalKobo: compositeQuote.compositeTotalKobo,
          expiresAt: quoteExpiresAt,
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
        const distanceKm = haversineKm(
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
 * Requirements: 12.1, 12.2
 */
deliveryRoutes.post(
  '/:id/legs/:legId/weight-correction',
  requireRole('driver'),
  async (c) => {
    const user = c.get('user');
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
      // 2. Validate the delivery exists
      const [delivery] = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId));

      if (!delivery) {
        return c.json(
          { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
          404,
        );
      }

      // 3. Validate the leg exists, belongs to this delivery, and is an on-demand leg
      const [leg] = await db
        .select({
          id: deliveryLegs.id,
          deliveryId: deliveryLegs.deliveryId,
          actorType: deliveryLegs.actorType,
          status: deliveryLegs.status,
        })
        .from(deliveryLegs)
        .where(
          and(
            eq(deliveryLegs.id, legId),
            eq(deliveryLegs.deliveryId, deliveryId),
          ),
        );

      if (!leg || leg.actorType !== 'driver') {
        return c.json(
          { data: null, error: { code: 'NOT_FOUND', message: 'On-demand leg not found' }, meta: null },
          404,
        );
      }

      // 4. Validate the leg is at `arrived_pickup` status
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
