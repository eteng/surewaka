import { db } from '../db';
import {
  weightDiscrepancyCorrections,
  deliveries,
  escrowHolds,
  wallets,
  walletTransactions,
} from '@surewaka/db';
import { eq, and, lt, sql } from 'drizzle-orm';

/**
 * weight-correction-expiry: resolves pending weight discrepancy corrections
 * whose approval_deadline has passed.
 *
 * Unlike the other 7 alert rules (which only produce notifications via EvaluationResult[]),
 * this check actively mutates business state:
 *   - Fails the delivery
 *   - Refunds 85% of the original escrow to the customer's wallet
 *   - Sets the correction status to 'expired'
 *
 * Called each 60s tick. Idempotent — only corrections with status = 'pending_approval'
 * are selected, and the WHERE clause uses the idx_weight_corrections_pending partial index.
 *
 * Requirements: 12.5, 12.6
 */

/**
 * The arrived_pickup REFUND_RATES tier — 85% refund of the original escrow.
 * Mirrors the constant in booking-payment.ts and weight-correction-service.ts.
 */
const ARRIVED_PICKUP_REFUND_RATE = 0.85;

/**
 * Runs the correction expiry check. Not an alert-rule evaluator — does not return
 * EvaluationResult[]. Instead, directly resolves expired corrections (decline + refund + fail).
 */
export async function runCorrectionExpiryCheck(): Promise<{ resolvedCount: number }> {
  const now = new Date();

  // Query pending corrections past their approval_deadline.
  // Hits the partial index: idx_weight_corrections_pending
  // (on approval_deadline WHERE status = 'pending_approval')
  const expiredCorrections = await db
    .select({
      id: weightDiscrepancyCorrections.id,
      deliveryId: weightDiscrepancyCorrections.deliveryId,
      declaredWeightKg: weightDiscrepancyCorrections.declaredWeightKg,
      reportedWeightKg: weightDiscrepancyCorrections.reportedWeightKg,
      deltaKobo: weightDiscrepancyCorrections.deltaKobo,
    })
    .from(weightDiscrepancyCorrections)
    .where(
      and(
        eq(weightDiscrepancyCorrections.status, 'pending_approval'),
        lt(weightDiscrepancyCorrections.approvalDeadline, now),
      ),
    );

  if (expiredCorrections.length === 0) {
    return { resolvedCount: 0 };
  }

  let resolvedCount = 0;

  for (const correction of expiredCorrections) {
    try {
      await resolveExpiredCorrection(correction);
      resolvedCount++;
    } catch (err) {
      console.error(
        `[weight-correction-expiry] failed to resolve correction ${correction.id}:`,
        err,
      );
    }
  }

  if (resolvedCount > 0) {
    console.log(
      `[weight-correction-expiry] resolved ${resolvedCount} expired correction(s)`,
    );
  }

  return { resolvedCount };
}

/**
 * Resolves a single expired correction:
 *   1. Fail the delivery
 *   2. Refund 85% of original escrow to customer's wallet
 *   3. Mark correction status = 'expired'
 */
async function resolveExpiredCorrection(correction: {
  id: string;
  deliveryId: string;
  declaredWeightKg: number;
  reportedWeightKg: number;
  deltaKobo: number;
}): Promise<void> {
  // 1. Look up the delivery for the customer and escrow info
  const [delivery] = await db
    .select({
      customerId: deliveries.customerId,
      escrowHoldId: deliveries.escrowHoldId,
      amountPaid: deliveries.amountPaid,
    })
    .from(deliveries)
    .where(eq(deliveries.id, correction.deliveryId));

  if (!delivery) {
    console.warn(
      `[weight-correction-expiry] delivery ${correction.deliveryId} not found — skipping`,
    );
    return;
  }

  // 2. Get the customer's wallet
  const [wallet] = await db
    .select({ id: wallets.id, balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, delivery.customerId));

  if (!wallet) {
    console.warn(
      `[weight-correction-expiry] wallet not found for customer of delivery ${correction.deliveryId} — skipping`,
    );
    return;
  }

  // 3. Calculate 85% refund of the original escrowed amount
  const originalAmount = Number(delivery.amountPaid ?? 0);
  const refundAmountKobo = Math.floor(originalAmount * ARRIVED_PICKUP_REFUND_RATE);

  // 4. Fail the delivery
  await db
    .update(deliveries)
    .set({
      status: 'failed',
      paymentStatus: refundAmountKobo > 0 ? 'refunded' : 'released',
    })
    .where(eq(deliveries.id, correction.deliveryId));

  // 5. Update the escrow hold status
  if (delivery.escrowHoldId) {
    await db
      .update(escrowHolds)
      .set({
        status: refundAmountKobo === originalAmount ? 'refunded' : 'partially_refunded',
        refundedAt: new Date(),
      })
      .where(eq(escrowHolds.id, delivery.escrowHoldId));
  }

  // 6. Credit the refund to the customer's wallet (if amount > 0)
  if (refundAmountKobo > 0) {
    const reference = `weight_correction_decline_refund_${correction.id}`;
    const newBalance = wallet.balance + refundAmountKobo;

    // Credit wallet
    await db
      .update(wallets)
      .set({ balance: sql`balance + ${refundAmountKobo}` })
      .where(eq(wallets.id, wallet.id));

    // Record wallet transaction
    await db.insert(walletTransactions).values({
      walletId: wallet.id,
      type: 'refund',
      amount: refundAmountKobo,
      balanceAfter: newBalance,
      reference,
      description: `Refund for expired weight correction on delivery ${correction.deliveryId} (85% of ₦${(originalAmount / 100).toLocaleString()})`,
      metadata: {
        correction_id: correction.id,
        delivery_id: correction.deliveryId,
        original_amount: originalAmount,
        refund_rate: ARRIVED_PICKUP_REFUND_RATE,
        reason: 'approval_window_expired',
      },
    });
  }

  // 7. Mark the correction as expired
  await db
    .update(weightDiscrepancyCorrections)
    .set({
      status: 'expired',
      respondedAt: new Date(),
    })
    .where(eq(weightDiscrepancyCorrections.id, correction.id));
}
