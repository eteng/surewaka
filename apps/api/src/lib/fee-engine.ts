import type {
  CompositeQuote,
  FeeSettings,
  LegQuote,
  LegType,
  LineItem,
  VehicleType,
  VehicleTypeRates,
} from '@surewaka/shared';
import { FEE_ENGINE_ERRORS, VEHICLE_TYPES } from '@surewaka/shared';

// ─── On-Demand Quote ──────────────────────────────────────────────────────────

/**
 * Computes an itemized quote for a single On-Demand leg (first_mile or last_mile).
 *
 * Pure function — no DB access, no side effects.
 *
 * Formula:
 *   subtotal = (base_rate_kobo + (packageWeight × per_kg_rate_kobo) + (distanceKm × per_km_rate_kobo)) × vehicle_type_multiplier
 *   tax = subtotal × tax_rate_pct / 100
 *   total = subtotal + tax
 *
 * The vehicle type multiplier is applied multiplicatively to the subtotal (base + weight + distance),
 * not as a separate additive line. The "Vehicle type" line item shows the difference the multiplier adds.
 * Per-kg rate applies from kg 0 — no free-weight allowance.
 * All outputs are integers (Math.round each line item).
 * Sum of line items equals totalKobo exactly.
 */
export function computeOnDemandQuote(
  input: { packageWeight: number; distanceKm: number; vehicleType: VehicleType },
  settings: FeeSettings,
  vehicleTypeRates: VehicleTypeRates,
): LegQuote {
  const { packageWeight, distanceKm, vehicleType } = input;

  // Validate vehicleType is one of the four defined enum values
  if (!VEHICLE_TYPES.includes(vehicleType as (typeof VEHICLE_TYPES)[number])) {
    throw new Error(FEE_ENGINE_ERRORS.INVALID_VEHICLE_TYPE);
  }

  const multiplier = vehicleTypeRates[vehicleType].multiplier;

  // Individual components before multiplier
  const baseFee = Math.round(settings.baseRateKobo);
  const weightSurcharge = Math.round(packageWeight * settings.perKgRateKobo);
  const distanceSurcharge = Math.round(distanceKm * settings.perKmRateKobo);

  // Subtotal before multiplier
  const subtotalBeforeMultiplier = baseFee + weightSurcharge + distanceSurcharge;

  // Subtotal after multiplier
  const subtotalAfterMultiplier = Math.round(subtotalBeforeMultiplier * multiplier);

  // Vehicle type line item: the DIFFERENCE the multiplier adds
  const vehicleTypeDiff = subtotalAfterMultiplier - subtotalBeforeMultiplier;

  // Tax on the full multiplied subtotal (SureWaka's revenue)
  const tax = Math.round(subtotalAfterMultiplier * settings.taxRatePct / 100);

  // Build line items
  const lineItems: LineItem[] = [
    { label: 'Base fee', amountKobo: baseFee },
    { label: `Weight surcharge (${packageWeight}kg)`, amountKobo: weightSurcharge },
    { label: `Distance surcharge (${distanceKm}km)`, amountKobo: distanceSurcharge },
    { label: `Vehicle type (${vehicleType} × ${multiplier})`, amountKobo: vehicleTypeDiff },
  ];

  if (tax > 0) {
    lineItems.push({ label: 'Tax', amountKobo: tax });
  }

  const totalKobo = lineItems.reduce((sum, item) => sum + item.amountKobo, 0);

  return { lineItems, totalKobo };
}

// ─── Carrier Quote ────────────────────────────────────────────────────────────

/**
 * Computes a Leg_Quote for a Carrier_Leg (intercity).
 *
 * Formula: carrier_rate + service_fee + tax_on_service_fee_only
 *   - service_fee = carrierBasePrice × carrier_commission_rate_pct / 100
 *   - tax = service_fee × tax_rate_pct / 100
 *
 * No weight/distance surcharges — carrier's flat rate is the base.
 * All outputs are integers (Math.round).
 * Sum of line items equals totalKobo exactly.
 */
export function computeCarrierQuote(
  input: { carrierBasePrice: number; carrierName?: string },
  settings: FeeSettings,
): LegQuote {
  const { carrierBasePrice, carrierName } = input;
  const { carrierCommissionRatePct, taxRatePct } = settings;

  const label = carrierName ?? 'Carrier';

  // Carrier's own flat rate — passed through directly
  const carrierRate = Math.round(carrierBasePrice);

  // SureWaka's additive service fee on top of the carrier's rate
  const serviceFee = Math.round(carrierBasePrice * carrierCommissionRatePct / 100);

  // Tax applies ONLY to the service fee (SureWaka's revenue), never to the carrier's rate
  const tax = Math.round(serviceFee * taxRatePct / 100);

  const lineItems: LineItem[] = [
    { label: `Carrier rate (${label})`, amountKobo: carrierRate },
    { label: 'SureWaka service fee', amountKobo: serviceFee },
  ];

  if (tax > 0) {
    lineItems.push({ label: 'Tax', amountKobo: tax });
  }

  const totalKobo = lineItems.reduce((sum, item) => sum + item.amountKobo, 0);

  return { lineItems, totalKobo };
}

// ─── Composite Quote Assembly ─────────────────────────────────────────────────

/**
 * Assembles a Composite_Quote from an array of leg quotes.
 *
 * Pure function — no DB access, no side effects.
 *
 * Behavior:
 *   1. Sums all leg `totalKobo` values
 *   2. If the sum is below `minPriceKobo`, floors at `minPriceKobo`
 *   3. Returns the legs array as-is (grouped), with the floored/summed `compositeTotalKobo`
 *
 * Important: When floored, individual leg line items are NOT modified —
 * only `compositeTotalKobo` is adjusted.
 */
export function assembleCompositeQuote(
  legs: { legType: LegType; legLabel: string; quote: LegQuote }[],
  minPriceKobo: number,
): CompositeQuote {
  const rawTotal = legs.reduce((sum, leg) => sum + leg.quote.totalKobo, 0);
  const compositeTotalKobo = Math.max(rawTotal, minPriceKobo);

  return { legs, compositeTotalKobo };
}
