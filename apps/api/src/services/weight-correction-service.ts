import {
  db as defaultDb,
  weightDiscrepancyCorrections,
  deliveries,
  deliveryLegs,
  quotes,
  escrowHolds,
  alerts,
} from '@surewaka/db';
import { eq, and, lt, gte, isNull, inArray, sql } from 'drizzle-orm';
import type { FeeSettings, VehicleType, VehicleTypeRates } from '@surewaka/shared';
import {
  MAX_WEIGHT_CORRECTION_MULTIPLIER,
  MIN_WEIGHT_CORRECTION_KG,
  WEIGHT_CORRECTION_ABUSE_COUNT,
  WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS,
} from '@surewaka/shared';
import { computeOnDemandQuote } from '../lib/fee-engine';
import { creditWallet, debitWallet, getWalletByUserId } from '../lib/wallet-service';

/** Drizzle client type — inferred from the singleton export. */
export type DrizzleDB = typeof defaultDb;

/**
 * The arrived_pickup REFUND_RATES tier — 85% refund of the original escrow.
 * Mirrors the constant in booking-payment.ts (Requirement 12.6).
 */
const ARRIVED_PICKUP_REFUND_RATE = 0.85;

// ─── Report Discrepancy ───────────────────────────────────────────────────────

/**
 * Extracts the vehicle type from a quote's line_items jsonb array.
 *
 * The on-demand quote produces a line item with label format:
 *   "Vehicle type (car × 1.3)"
 *
 * We parse the vehicle type from that label. Falls back to 'motorcycle'
 * (multiplier 1.0) if no vehicle type line item is found.
 */
function extractVehicleTypeFromLineItems(
  lineItems: Array<{ label: string; amountKobo: number }>,
): VehicleType {
  const vehicleTypeLine = lineItems.find((item) =>
    item.label.startsWith('Vehicle type ('),
  );
  if (!vehicleTypeLine) return 'motorcycle';

  // Parse "Vehicle type (car × 1.3)" → "car"
  const match = vehicleTypeLine.label.match(/^Vehicle type \((\w+)/);
  if (match && ['motorcycle', 'car', 'van', 'truck'].includes(match[1])) {
    return match[1] as VehicleType;
  }
  return 'motorcycle';
}

/**
 * Reports a weight discrepancy at pickup.
 *
 * Recomputes every On_Demand_Leg of the delivery with the corrected weight
 * (using each leg's original vehicleType and distanceKm from its active/confirmed quote),
 * computes the combined delta, and inserts a `weight_discrepancy_corrections` row.
 *
 * Carrier_Legs are untouched — their pricing is not weight-based.
 *
 * Requirements: 12.1, 12.2
 */
export async function reportDiscrepancy(
  db: DrizzleDB,
  deliveryId: string,
  reportedLegId: string,
  reportedWeightKg: number,
  settings: FeeSettings,
  vehicleTypeRates: VehicleTypeRates,
): Promise<{
  correctionId: string;
  declaredWeightKg: number;
  reportedWeightKg: number;
  deltaKobo: number;
  approvalDeadline: Date;
}> {
  // 1. Look up the delivery's original packageWeight (declared weight)
  const [delivery] = await db
    .select({ packageWeight: deliveries.packageWeight })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!delivery) {
    throw new Error('Delivery not found');
  }

  const declaredWeightKg = delivery.packageWeight;

  // ─── Validation Guards ────────────────────────────────────────────────────
  // REQ-2: Minimum delta threshold — differences under 0.5kg are within tolerance
  const absDelta = Math.abs(reportedWeightKg - declaredWeightKg);
  if (absDelta < MIN_WEIGHT_CORRECTION_KG) {
    throw new Error('WITHIN_TOLERANCE');
  }

  // REQ-1: Maximum delta cap — block reports exceeding 3× declared weight
  if (reportedWeightKg > declaredWeightKg * MAX_WEIGHT_CORRECTION_MULTIPLIER) {
    throw new Error('WEIGHT_DELTA_TOO_LARGE');
  }

  // 2. Query all delivery_legs for this delivery where actor_type = 'driver' (on-demand legs only)
  const onDemandLegs = await db
    .select({
      id: deliveryLegs.id,
      legType: deliveryLegs.legType,
    })
    .from(deliveryLegs)
    .where(
      and(
        eq(deliveryLegs.deliveryId, deliveryId),
        eq(deliveryLegs.actorType, 'driver'),
      ),
    );

  if (onDemandLegs.length === 0) {
    throw new Error('No on-demand legs found for this delivery');
  }

  // 3. For each on-demand leg, get its active/confirmed quote's distance_km, total_kobo, and line_items
  //    (to extract vehicleType). We look at the most recent non-superseded quote (active or confirmed).
  let originalTotal = 0;
  let correctedTotal = 0;

  for (const leg of onDemandLegs) {
    // Get the active or confirmed quote for this leg (non-superseded)
    const [quote] = await db
      .select({
        totalKobo: quotes.totalKobo,
        distanceKm: quotes.distanceKm,
        lineItems: quotes.lineItems,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.deliveryLegId, leg.id),
          isNull(quotes.supersededAt),
        ),
      )
      .limit(1);

    if (!quote) {
      throw new Error(`No active quote found for leg ${leg.id}`);
    }

    // Sum original totals
    originalTotal += quote.totalKobo;

    // Extract vehicle type and distance from the quote
    const lineItems = quote.lineItems as Array<{ label: string; amountKobo: number }>;
    const vehicleType = extractVehicleTypeFromLineItems(lineItems);
    const distanceKm = quote.distanceKm ?? 0;

    // 4. Recompute with corrected weight
    const correctedQuote = computeOnDemandQuote(
      { packageWeight: reportedWeightKg, distanceKm, vehicleType },
      settings,
      vehicleTypeRates,
    );

    correctedTotal += correctedQuote.totalKobo;
  }

  // 5. Compute combined delta: (sum of corrected totals) − (sum of original totals)
  const deltaKobo = correctedTotal - originalTotal;

  // 6. Insert weight_discrepancy_corrections row
  const approvalDeadline = new Date(
    Date.now() + settings.weightCorrectionApprovalWindowMin * 60 * 1000,
  );

  const [correction] = await db
    .insert(weightDiscrepancyCorrections)
    .values({
      deliveryId,
      reportedLegId,
      declaredWeightKg,
      reportedWeightKg,
      deltaKobo,
      status: 'pending_approval',
      approvalDeadline,
    })
    .returning({ id: weightDiscrepancyCorrections.id });

  // REQ-3: Check driver correction frequency (fire-and-forget — don't block the response)
  void checkDriverCorrectionFrequency(db, reportedLegId, deliveryId);

  // 7. Return correction details
  return {
    correctionId: correction.id,
    declaredWeightKg,
    reportedWeightKg,
    deltaKobo,
    approvalDeadline,
  };
}

// ─── Driver Correction Frequency Check ────────────────────────────────────────

/**
 * Checks if a driver has exceeded the weight correction abuse threshold.
 * Fires a 'weight_correction_abuse' alert if count > 5 in the last 7 days.
 *
 * Fire-and-forget — errors are logged but don't affect the correction flow.
 * REQ-3.
 */
async function checkDriverCorrectionFrequency(
  db: DrizzleDB,
  reportedLegId: string,
  deliveryId: string,
): Promise<void> {
  try {
    // Find the driver who owns this leg
    const [leg] = await db
      .select({ actorId: deliveryLegs.actorId })
      .from(deliveryLegs)
      .where(eq(deliveryLegs.id, reportedLegId));

    if (!leg) return;
    const driverId = leg.actorId;

    // Get all leg IDs assigned to this driver
    const driverLegs = await db
      .select({ id: deliveryLegs.id })
      .from(deliveryLegs)
      .where(eq(deliveryLegs.actorId, driverId));

    const driverLegIds = driverLegs.map((l) => l.id);
    if (driverLegIds.length === 0) return;

    // Count corrections on this driver's legs in the rolling window
    const windowStart = new Date(
      Date.now() - WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(weightDiscrepancyCorrections)
      .where(
        and(
          inArray(weightDiscrepancyCorrections.reportedLegId, driverLegIds),
          gte(weightDiscrepancyCorrections.createdAt, windowStart),
        ),
      );

    const count = result?.count ?? 0;

    if (count > WEIGHT_CORRECTION_ABUSE_COUNT) {
      await db.insert(alerts).values({
        deliveryId,
        legId: reportedLegId,
        rule: 'weight_correction_abuse',
        severity: 'warning',
        context: { driverId, count, window: `${WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS}d` },
        firedAt: new Date(),
      });
    }
  } catch (err) {
    console.error('[weight-correction] Failed to check driver frequency:', err);
  }
}

// ─── Respond to Correction ────────────────────────────────────────────────────

/**
 * Responds to a pending weight discrepancy correction.
 *
 * - `approved`: applies the delta as a separate wallet transaction (charge if positive,
 *    refund if negative), sets `wallet_transaction_ref` and `responded_at`, updates
 *    status to `approved`. The original escrow is NEVER modified.
 *
 * - `declined`: fails the entire delivery, applies 85% refund of the original escrow
 *    amount (the `arrived_pickup` REFUND_RATES tier), sets `responded_at`, updates
 *    status to `declined`.
 *
 * Validates:
 *   - Correction exists
 *   - Correction is still in `pending_approval` status
 *   - `approval_deadline` has not passed
 *
 * Requirements: 12.3, 12.4, 12.6
 */
export async function respondToCorrection(
  db: DrizzleDB,
  correctionId: string,
  decision: 'approved' | 'declined',
): Promise<{
  status: string;
  walletTransactionRef?: string;
  refundAmountKobo?: number;
}> {
  // 1. Load and validate the correction
  const [correction] = await db
    .select()
    .from(weightDiscrepancyCorrections)
    .where(eq(weightDiscrepancyCorrections.id, correctionId));

  if (!correction) {
    throw new Error('CORRECTION_NOT_FOUND');
  }

  if (correction.status !== 'pending_approval') {
    throw new Error('CORRECTION_ALREADY_RESPONDED');
  }

  const now = new Date();
  if (correction.approvalDeadline <= now) {
    throw new Error('CORRECTION_EXPIRED');
  }

  if (decision === 'approved') {
    return await handleApproval(db, correction);
  } else {
    return await handleDecline(db, correction);
  }
}

// ─── Approval Path ────────────────────────────────────────────────────────────

/**
 * Applies the delta as a separate wallet transaction.
 * - Positive delta = charge customer (debit)
 * - Negative delta = refund to customer (credit)
 *
 * The original escrow amount is NEVER modified — the delta is a SEPARATE transaction.
 */
async function handleApproval(
  db: DrizzleDB,
  correction: typeof weightDiscrepancyCorrections.$inferSelect,
): Promise<{ status: string; walletTransactionRef?: string }> {
  // Look up the delivery to find the customer
  const [delivery] = await db
    .select({ customerId: deliveries.customerId })
    .from(deliveries)
    .where(eq(deliveries.id, correction.deliveryId));

  if (!delivery) {
    throw new Error('DELIVERY_NOT_FOUND');
  }

  // Get the customer's wallet
  const wallet = await getWalletByUserId(delivery.customerId);

  const deltaKobo = correction.deltaKobo;
  const reference = `weight_correction_${correction.id}`;

  // Apply the delta as a wallet transaction
  if (deltaKobo > 0) {
    // Positive delta: charge the customer (debit their wallet)
    await debitWallet(
      wallet.id,
      deltaKobo,
      'adjustment',
      reference,
      `Weight correction charge for delivery ${correction.deliveryId} (${correction.declaredWeightKg}kg → ${correction.reportedWeightKg}kg)`,
      {
        correction_id: correction.id,
        delivery_id: correction.deliveryId,
        declared_weight_kg: correction.declaredWeightKg,
        reported_weight_kg: correction.reportedWeightKg,
        delta_kobo: deltaKobo,
      },
    );
  } else if (deltaKobo < 0) {
    // Negative delta: refund to the customer (credit their wallet)
    await creditWallet(
      wallet.id,
      Math.abs(deltaKobo),
      'refund',
      reference,
      `Weight correction refund for delivery ${correction.deliveryId} (${correction.declaredWeightKg}kg → ${correction.reportedWeightKg}kg)`,
      {
        correction_id: correction.id,
        delivery_id: correction.deliveryId,
        declared_weight_kg: correction.declaredWeightKg,
        reported_weight_kg: correction.reportedWeightKg,
        delta_kobo: deltaKobo,
      },
    );
  }
  // Note: deltaKobo === 0 is theoretically possible (same weight reported);
  // we still mark as approved but skip the wallet transaction.

  // Update the correction record
  await db
    .update(weightDiscrepancyCorrections)
    .set({
      status: 'approved',
      respondedAt: new Date(),
      walletTransactionRef: deltaKobo !== 0 ? reference : null,
    })
    .where(eq(weightDiscrepancyCorrections.id, correction.id));

  return {
    status: 'approved',
    walletTransactionRef: deltaKobo !== 0 ? reference : undefined,
  };
}

// ─── Decline Path ─────────────────────────────────────────────────────────────

/**
 * Fails the delivery and applies 85% refund of the original escrow amount.
 * Uses the `arrived_pickup` REFUND_RATES tier (same rate as the cancellation
 * refund logic in booking-payment.ts).
 *
 * The entire delivery fails at this point — no leg proceeds.
 *
 * @param finalStatus - The correction status to set: 'declined' for explicit customer
 *   decline, 'expired' for timeout. Both execute the same refund + fail logic.
 *
 * Requirement 12.6.
 */
async function handleDecline(
  db: DrizzleDB,
  correction: typeof weightDiscrepancyCorrections.$inferSelect,
  finalStatus: 'declined' | 'expired' = 'declined',
): Promise<{ status: string; refundAmountKobo?: number }> {
  // Look up the delivery with the escrow info
  const [delivery] = await db
    .select({
      customerId: deliveries.customerId,
      escrowHoldId: deliveries.escrowHoldId,
      amountPaid: deliveries.amountPaid,
    })
    .from(deliveries)
    .where(eq(deliveries.id, correction.deliveryId));

  if (!delivery) {
    throw new Error('DELIVERY_NOT_FOUND');
  }

  // Get the customer's wallet for the refund
  const wallet = await getWalletByUserId(delivery.customerId);

  // Calculate 85% refund of the original escrowed amount
  const originalAmount = Number(delivery.amountPaid ?? 0);
  const refundAmountKobo = Math.floor(originalAmount * ARRIVED_PICKUP_REFUND_RATE);

  // Fail the delivery
  await db
    .update(deliveries)
    .set({
      status: 'failed',
      paymentStatus: refundAmountKobo > 0 ? 'refunded' : 'released',
    })
    .where(eq(deliveries.id, correction.deliveryId));

  // Update the escrow hold status if it exists
  if (delivery.escrowHoldId) {
    await db
      .update(escrowHolds)
      .set({
        status: refundAmountKobo === originalAmount ? 'refunded' : 'partially_refunded',
        refundedAt: new Date(),
      })
      .where(eq(escrowHolds.id, delivery.escrowHoldId));
  }

  // Credit the refund to the customer's wallet
  if (refundAmountKobo > 0) {
    await creditWallet(
      wallet.id,
      refundAmountKobo,
      'refund',
      `weight_correction_decline_refund_${correction.id}`,
      `Refund for declined weight correction on delivery ${correction.deliveryId} (85% of ₦${(originalAmount / 100).toLocaleString()})`,
      {
        correction_id: correction.id,
        delivery_id: correction.deliveryId,
        original_amount: originalAmount,
        refund_rate: ARRIVED_PICKUP_REFUND_RATE,
      },
    );
  }

  // Update the correction record
  await db
    .update(weightDiscrepancyCorrections)
    .set({
      status: finalStatus,
      respondedAt: new Date(),
    })
    .where(eq(weightDiscrepancyCorrections.id, correction.id));

  return {
    status: finalStatus,
    refundAmountKobo: refundAmountKobo > 0 ? refundAmountKobo : undefined,
  };
}


// ─── Resolve Expired ──────────────────────────────────────────────────────────

/**
 * Resolves all pending weight discrepancy corrections that have passed their
 * `approval_deadline`. Executes the same decline path as an explicit customer
 * decline (fail delivery + 85% refund), but sets the correction status to
 * `expired` to differentiate timeout from explicit decline.
 *
 * Called by the alert-engine's 60-second polling loop.
 *
 * Uses the `idx_weight_corrections_pending` partial index for efficient querying
 * (filtered on `status = 'pending_approval'`, ordered by `approval_deadline`).
 *
 * Idempotent — already-resolved corrections (status != 'pending_approval') are
 * excluded by the WHERE clause and won't be re-processed.
 *
 * Requirements: 12.5, 12.6
 */
export async function resolveExpired(
  db: DrizzleDB,
): Promise<{ resolvedCount: number; resolvedIds: string[] }> {
  const now = new Date();

  // Query pending corrections past their approval_deadline.
  // This hits the partial index: idx_weight_corrections_pending
  // (on approval_deadline WHERE status = 'pending_approval')
  const expiredCorrections = await db
    .select()
    .from(weightDiscrepancyCorrections)
    .where(
      and(
        eq(weightDiscrepancyCorrections.status, 'pending_approval'),
        lt(weightDiscrepancyCorrections.approvalDeadline, now),
      ),
    );

  const resolvedIds: string[] = [];

  for (const correction of expiredCorrections) {
    // Execute the same decline path: fail delivery + refund at 85% (arrived_pickup tier).
    // Status is set to 'expired' (not 'declined') to differentiate timeout from explicit decline.
    await handleDecline(db, correction, 'expired');
    resolvedIds.push(correction.id);
  }

  return { resolvedCount: resolvedIds.length, resolvedIds };
}
