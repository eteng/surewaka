import { db as defaultDb, quotes } from '@surewaka/db';
import { eq, and, isNull, sql } from 'drizzle-orm';
import type {
  CompositeQuote,
  FeeSettings,
  LegQuote,
  LegType,
  VehicleType,
  VehicleTypeRates,
} from '@surewaka/shared';
import { FEE_ENGINE_ERRORS } from '@surewaka/shared';
import {
  computeOnDemandQuote,
  computeCarrierQuote,
  assembleCompositeQuote,
} from '../lib/fee-engine';

/** Drizzle client type — inferred from the singleton export. */
export type DrizzleDB = typeof defaultDb;

const QUOTE_EXPIRY_MINUTES = 15;

/**
 * Creates one Authoritative_Quote per delivery leg, persists each to the `quotes`
 * table, and returns the assembled Composite_Quote.
 *
 * For on-demand legs (`actorType = 'driver'`): calls `computeOnDemandQuote` with
 * the leg's vehicleType, packageWeight, distanceKm, and the loaded VehicleTypeRates.
 *
 * For carrier legs (`actorType = 'carrier'`): calls `computeCarrierQuote` with
 * the carrier's basePrice.
 *
 * Each persisted quote row expires 15 minutes from creation.
 */
export async function createAuthoritativeQuotesForDelivery(
  db: DrizzleDB,
  deliveryId: string,
  legs: Array<{
    id: string;
    legType: string;
    actorType: 'driver' | 'carrier';
    actorId?: string;
    vehicleType?: VehicleType;
    distanceKm?: number;
  }>,
  packageWeight: number,
  settings: FeeSettings,
  vehicleTypeRates: VehicleTypeRates,
  carriers?: Map<string, { basePrice: number; name: string }>,
): Promise<CompositeQuote> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_EXPIRY_MINUTES * 60 * 1000);

  const legQuotes: { legType: LegType; legLabel: string; quote: LegQuote }[] = [];

  for (const leg of legs) {
    let quote: LegQuote;
    let carrierId: string | undefined;
    let distanceKm: number | undefined;

    if (leg.actorType === 'driver') {
      // On-demand leg — first_mile or last_mile
      const vehicleType = leg.vehicleType ?? 'motorcycle';
      const distance = leg.distanceKm ?? 0;
      distanceKm = distance;

      quote = computeOnDemandQuote(
        { packageWeight, distanceKm: distance, vehicleType },
        settings,
        vehicleTypeRates,
      );
    } else {
      // Carrier leg — intercity
      const carrier = carriers?.get(leg.actorId ?? '');
      const basePrice = carrier?.basePrice ?? 0;
      const carrierName = carrier?.name;
      carrierId = leg.actorId;

      quote = computeCarrierQuote({ carrierBasePrice: basePrice, carrierName }, settings);
    }

    // Persist the quote row
    await db.insert(quotes).values({
      deliveryLegId: leg.id,
      deliveryId,
      carrierId: carrierId ?? null,
      lineItems: quote.lineItems,
      totalKobo: quote.totalKobo,
      distanceKm: distanceKm ?? null,
      packageWeightKg: leg.actorType === 'driver' ? packageWeight : null,
      expiresAt,
    });

    // Build the label for composite assembly
    const legLabel = buildLegLabel(leg.legType, leg.actorType, carriers?.get(leg.actorId ?? ''));

    legQuotes.push({
      legType: leg.legType as LegType,
      legLabel,
      quote,
    });
  }

  // Assemble the composite quote with minimum price floor
  return assembleCompositeQuote(legQuotes, settings.minPriceKobo);
}

// ─── getActiveQuoteForLeg ─────────────────────────────────────────────────────

/**
 * Returns the non-superseded, non-expired active quote for a given leg.
 * Returns null if no active quote exists or the existing quote has expired.
 */
export async function getActiveQuoteForLeg(
  db: DrizzleDB,
  deliveryLegId: string,
) {
  const now = new Date();

  const [row] = await db
    .select()
    .from(quotes)
    .where(
      and(
        eq(quotes.deliveryLegId, deliveryLegId),
        isNull(quotes.supersededAt),
        isNull(quotes.confirmedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.expiresAt <= now) return null;

  return row;
}

// ─── getCompositeTotal ────────────────────────────────────────────────────────

/**
 * Sums all active (non-superseded, non-confirmed, non-expired) leg quotes
 * for a delivery into a Composite_Quote total.
 */
export async function getCompositeTotal(
  db: DrizzleDB,
  deliveryId: string,
): Promise<{ totalKobo: number; quoteCount: number }> {
  const now = new Date();

  const activeQuotes = await db
    .select({ totalKobo: quotes.totalKobo, expiresAt: quotes.expiresAt })
    .from(quotes)
    .where(
      and(
        eq(quotes.deliveryId, deliveryId),
        isNull(quotes.supersededAt),
        isNull(quotes.confirmedAt),
      ),
    );

  // Filter out expired quotes
  const validQuotes = activeQuotes.filter((q) => q.expiresAt > now);
  const totalKobo = validQuotes.reduce((sum, q) => sum + q.totalKobo, 0);

  return { totalKobo, quoteCount: validQuotes.length };
}

// ─── supersedeLeg ─────────────────────────────────────────────────────────────

/**
 * Re-quotes a single delivery leg: marks the prior active quote as superseded
 * and inserts a new quote row, ensuring at most one active quote per leg at all
 * times. Both operations happen in a single transaction to maintain the invariant.
 *
 * The prior quote row is preserved with `superseded_at` set for audit/dispute replay
 * (matching the append-only `driver_locations` history pattern — no row is ever deleted).
 *
 * Requirements: 5.5, 7.2
 */
export async function supersedeLeg(
  db: DrizzleDB,
  deliveryLegId: string,
  deliveryId: string,
  newQuote: LegQuote,
  meta: {
    carrierId?: string;
    distanceKm?: number;
    packageWeightKg?: number;
  },
): Promise<typeof quotes.$inferSelect> {
  return await db.transaction(async (tx) => {
    // 1. Supersede any existing active quote for this leg.
    //    Active = superseded_at IS NULL AND confirmed_at IS NULL.
    await tx
      .update(quotes)
      .set({ supersededAt: sql`now()` })
      .where(
        and(
          eq(quotes.deliveryLegId, deliveryLegId),
          isNull(quotes.supersededAt),
          isNull(quotes.confirmedAt),
        ),
      );

    // 2. Insert the new quote row with a 15-minute expiry window.
    const [inserted] = await tx
      .insert(quotes)
      .values({
        deliveryLegId,
        deliveryId,
        carrierId: meta.carrierId ?? null,
        lineItems: newQuote.lineItems,
        totalKobo: newQuote.totalKobo,
        distanceKm: meta.distanceKm ?? null,
        packageWeightKg: meta.packageWeightKg ?? null,
        expiresAt: sql`now() + interval '15 minutes'`,
      })
      .returning();

    return inserted;
  });
}

// ─── confirmAll ───────────────────────────────────────────────────────────────

/**
 * Stamps `confirmed_at` on all active (non-superseded, non-confirmed) quotes
 * for a delivery. Validates none are expired before confirming.
 *
 * Uses `FOR UPDATE` row lock to prevent races with concurrent re-quote operations.
 * The entire operation runs in a transaction to ensure atomicity.
 *
 * @throws Error with code QUOTE_EXPIRED if any active quote has expired
 * @throws Error with code QUOTE_MISSING if no active quotes exist for the delivery
 */
export async function confirmAll(
  db: DrizzleDB,
  deliveryId: string,
): Promise<{ confirmedCount: number; totalKobo: number }> {
  return await db.transaction(async (tx) => {
    // Lock all active quotes for this delivery to prevent concurrent re-quote
    const activeQuotes = await tx
      .select({
        id: quotes.id,
        totalKobo: quotes.totalKobo,
        expiresAt: quotes.expiresAt,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.deliveryId, deliveryId),
          isNull(quotes.supersededAt),
          isNull(quotes.confirmedAt),
        ),
      )
      .for('update');

    if (activeQuotes.length === 0) {
      throw new Error(FEE_ENGINE_ERRORS.QUOTE_MISSING);
    }

    const now = new Date();
    const expiredQuotes = activeQuotes.filter((q) => q.expiresAt <= now);
    if (expiredQuotes.length > 0) {
      throw new Error(FEE_ENGINE_ERRORS.QUOTE_EXPIRED);
    }

    await tx
      .update(quotes)
      .set({ confirmedAt: sql`now()` })
      .where(
        and(
          eq(quotes.deliveryId, deliveryId),
          isNull(quotes.supersededAt),
          isNull(quotes.confirmedAt),
        ),
      );

    const confirmedCount = activeQuotes.length;
    const totalKobo = activeQuotes.reduce((acc, q) => acc + q.totalKobo, 0);

    return { confirmedCount, totalKobo };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a human-readable label for a leg in the composite breakdown.
 */
function buildLegLabel(
  legType: string,
  actorType: string,
  carrier?: { basePrice: number; name: string },
): string {
  switch (legType) {
    case 'first_mile':
      return 'First-mile pickup';
    case 'last_mile':
      return 'Last-mile delivery';
    case 'intercity':
      return carrier?.name ? `Intercity — ${carrier.name}` : 'Intercity transport';
    default:
      return legType;
  }
}
