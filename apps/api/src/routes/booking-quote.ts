import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, feeSettings, vehicleTypeRates, carriers } from '@surewaka/db';
import { quoteRequestSchema, FEE_ENGINE_ERRORS } from '@surewaka/shared';
import type { FeeSettings, VehicleType, VehicleTypeRates } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { requireAuth } from '../middleware/auth';
import { computeOnDemandQuote, computeCarrierQuote, assembleCompositeQuote } from '../lib/fee-engine';
import { haversineKm } from '../lib/eta-calculator';

type Env = { Variables: { user: AuthUser; accessToken: string } };

const bookingQuoteRoutes = new Hono<Env>();
bookingQuoteRoutes.use('*', requireAuth);

// POST /booking/quote — stateless Speculative_Quote per leg
bookingQuoteRoutes.post('/booking/quote', async (c) => {
  const body = await c.req.json();
  const parsed = quoteRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        },
        meta: null,
      },
      400,
    );
  }

  const { legs, packageWeight } = parsed.data;

  try {
    // Load fee_settings singleton
    const [settings] = await db.select().from(feeSettings).limit(1);
    if (!settings) {
      return c.json(
        { data: null, error: { code: 'CONFIG_ERROR', message: 'Fee settings not configured' }, meta: null },
        500,
      );
    }

    // Load all vehicle type rates
    const rateRows = await db.select().from(vehicleTypeRates);
    if (rateRows.length === 0) {
      return c.json(
        { data: null, error: { code: 'CONFIG_ERROR', message: 'Vehicle type rates not configured' }, meta: null },
        500,
      );
    }

    // Build FeeSettings object from DB row
    const feeSettingsObj: FeeSettings = {
      baseRateKobo: settings.baseRateKobo,
      perKgRateKobo: settings.perKgRateKobo,
      perKmRateKobo: settings.perKmRateKobo,
      carrierCommissionRatePct: Number(settings.carrierCommissionRatePct),
      taxRatePct: Number(settings.taxRatePct),
      minPriceKobo: settings.minPriceKobo,
      weightCorrectionApprovalWindowMin: settings.weightCorrectionApprovalWindowMin,
    };

    // Build VehicleTypeRates lookup from DB rows
    const vehicleTypeRatesObj: VehicleTypeRates = {} as VehicleTypeRates;
    for (const row of rateRows) {
      vehicleTypeRatesObj[row.vehicleType as VehicleType] = {
        multiplier: Number(row.multiplier),
      };
    }

    // Process each leg
    const legResults: { legType: string; lineItems: { label: string; amountKobo: number }[]; totalKobo: number }[] = [];

    for (const leg of legs) {
      if (leg.legType === 'first_mile' || leg.legType === 'last_mile') {
        // On-demand leg — validate vehicleType is in rates lookup
        if (!vehicleTypeRatesObj[leg.vehicleType as VehicleType]) {
          return c.json(
            {
              data: null,
              error: {
                code: FEE_ENGINE_ERRORS.INVALID_VEHICLE_TYPE,
                message: `Invalid vehicle type: ${leg.vehicleType}`,
              },
              meta: null,
            },
            400,
          );
        }

        // Compute haversine distance between pickup and dropoff
        const distanceKm = haversineKm(
          leg.pickup.lat,
          leg.pickup.lng,
          leg.dropoff.lat,
          leg.dropoff.lng,
        );

        const quote = computeOnDemandQuote(
          { packageWeight, distanceKm: Math.round(distanceKm * 10) / 10, vehicleType: leg.vehicleType },
          feeSettingsObj,
          vehicleTypeRatesObj,
        );

        legResults.push({
          legType: leg.legType,
          lineItems: quote.lineItems,
          totalKobo: quote.totalKobo,
        });
      } else if (leg.legType === 'intercity') {
        // Carrier leg — look up carrier's basePrice
        const [carrier] = await db
          .select({ id: carriers.id, name: carriers.name, basePrice: carriers.basePrice })
          .from(carriers)
          .where(eq(carriers.id, leg.carrierId))
          .limit(1);

        if (!carrier) {
          return c.json(
            {
              data: null,
              error: { code: 'CARRIER_NOT_FOUND', message: `Carrier not found: ${leg.carrierId}` },
              meta: null,
            },
            404,
          );
        }

        if (!carrier.basePrice) {
          return c.json(
            {
              data: null,
              error: { code: 'CARRIER_NO_PRICE', message: `Carrier ${carrier.name} has no base price configured` },
              meta: null,
            },
            422,
          );
        }

        const quote = computeCarrierQuote(
          { carrierBasePrice: carrier.basePrice, carrierName: carrier.name },
          feeSettingsObj,
        );

        legResults.push({
          legType: leg.legType,
          lineItems: quote.lineItems,
          totalKobo: quote.totalKobo,
        });
      }
    }

    // Assemble composite quote with min price floor
    const compositeLegs = legResults.map((lr) => ({
      legType: lr.legType as 'first_mile' | 'intercity' | 'last_mile',
      legLabel: lr.legType,
      quote: { lineItems: lr.lineItems, totalKobo: lr.totalKobo },
    }));
    const composite = assembleCompositeQuote(compositeLegs, feeSettingsObj.minPriceKobo);

    return c.json({
      data: {
        legs: legResults,
        compositeTotalKobo: composite.compositeTotalKobo,
      },
      error: null,
      meta: null,
    });
  } catch (err) {
    // Handle INVALID_VEHICLE_TYPE thrown by the fee engine
    if (err instanceof Error && err.message === FEE_ENGINE_ERRORS.INVALID_VEHICLE_TYPE) {
      return c.json(
        {
          data: null,
          error: { code: FEE_ENGINE_ERRORS.INVALID_VEHICLE_TYPE, message: 'Invalid vehicle type' },
          meta: null,
        },
        400,
      );
    }

    console.error('[POST /booking/quote]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to compute quote' }, meta: null },
      500,
    );
  }
});

export default bookingQuoteRoutes;
