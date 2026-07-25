import { Hono } from 'hono';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db, deliveries, escrowHolds, deliveryLegs, quotes } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, creditWallet, debitWallet } from '../lib/wallet-service';
import { bookingConfirmSchema, cancelDeliverySchema, FEE_ENGINE_ERRORS } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { randomUUID } from 'crypto';
import { notifyDeliveryCancelled } from '../services/push-triggers';
import { confirmAll } from '../services/quote-service';
import { writeLedgerEvent } from '../lib/ledger';
import { enqueueRouteDelivery } from '../lib/routing-queue';

type Env = { Variables: { user: AuthUser; accessToken: string } };

const bookingPaymentRoutes = new Hono<Env>();
bookingPaymentRoutes.use('*', requireAuth);

// POST /booking/confirm — validate quotes, escrow hold + wallet debit
bookingPaymentRoutes.post('/booking/confirm', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = bookingConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join(', ') }, meta: null },
      400,
    );
  }

  const { delivery_id } = parsed.data;

  try {
    // Confirm all active quotes — validates they exist and aren't expired,
    // stamps confirmed_at, and returns the server-computed total.
    // Uses FOR UPDATE row lock internally to prevent race with concurrent re-quote.
    const { totalKobo } = await confirmAll(db, delivery_id);

    const wallet = await getWalletByUserId(user.id);
    const reference = `escrow_${delivery_id}_${randomUUID().slice(0, 8)}`;

    await db.transaction(async (tx) => {
      // Re-check ownership and status inside the transaction with a row lock
      const [deliveryRow] = await tx
        .select({ id: deliveries.id, customerId: deliveries.customerId, status: deliveries.status, escrowHoldId: deliveries.escrowHoldId })
        .from(deliveries)
        .where(eq(deliveries.id, delivery_id))
        .for('update');

      if (!deliveryRow || deliveryRow.customerId !== user.id) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }
      if (deliveryRow.status !== 'draft') {
        throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
      }
      if (deliveryRow.escrowHoldId) {
        throw Object.assign(new Error('ALREADY_CONFIRMED'), { code: 'ALREADY_CONFIRMED' });
      }

      await debitWallet(wallet.id, totalKobo, 'escrow_hold', reference, `Escrow for delivery ${delivery_id}`, { delivery_id, user_id: wallet.userId }, tx);

      const [escrow] = await tx
        .insert(escrowHolds)
        .values({
          deliveryId: delivery_id,
          senderWalletId: wallet.id,
          totalAmount: totalKobo,
          status: 'held',
          heldAt: new Date(),
        })
        .returning();

      await tx
        .update(deliveries)
        .set({ status: 'pending', paymentStatus: 'escrowed', escrowHoldId: escrow.id, amountPaid: totalKobo })
        .where(eq(deliveries.id, delivery_id));
    });

    return c.json({ data: { delivery_id, status: 'confirmed', totalKobo }, error: null, meta: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const code = (err as { code?: string }).code;

    // Quote validation errors from confirmAll
    if (msg === FEE_ENGINE_ERRORS.QUOTE_MISSING) {
      return c.json(
        { data: null, error: { code: 'QUOTE_MISSING', message: 'No active quotes found for this delivery' }, meta: null },
        422,
      );
    }
    if (msg === FEE_ENGINE_ERRORS.QUOTE_EXPIRED) {
      // For surewaka_way deliveries: soft-deactivate legs, supersede quotes, reset to
      // pending_routing, and re-enqueue the routing job so the customer doesn't have to
      // manually re-quote — they just wait for the new route on the routing-pending screen.
      try {
        const [deliveryForReRoute] = await db
          .select({ id: deliveries.id, customerId: deliveries.customerId, deliveryMode: deliveries.deliveryMode })
          .from(deliveries)
          .where(eq(deliveries.id, delivery_id));

        if (
          deliveryForReRoute?.deliveryMode === 'surewaka_way' &&
          deliveryForReRoute.customerId === user.id
        ) {
          await db.transaction(async (tx) => {
            // Soft-deactivate all legs (preserves audit trail — append-only pattern)
            await tx
              .update(deliveryLegs)
              .set({ isActive: false })
              .where(eq(deliveryLegs.deliveryId, delivery_id));

            // Supersede all active quotes
            await tx
              .update(quotes)
              .set({ supersededAt: sql`now()` })
              .where(
                and(
                  eq(quotes.deliveryId, delivery_id),
                  isNull(quotes.supersededAt),
                  isNull(quotes.confirmedAt),
                ),
              );

            // Reset delivery: status → pending_routing, clear deadline and price
            await tx
              .update(deliveries)
              .set({ status: 'pending_routing', cancellationDeadlineAt: null, priceKobo: null })
              .where(eq(deliveries.id, delivery_id));
          });

          // Re-enqueue routing job so the worker picks up a fresh route
          await enqueueRouteDelivery({
            deliveryId: delivery_id,
            bookingTime: new Date().toISOString(),
            vehicleType: 'motorcycle',
          });

          return c.json(
            { data: null, error: { code: 'QUOTE_EXPIRED', message: 'Quote expired — re-routing started', reroutingStarted: true }, meta: null },
            409,
          );
        }
      } catch (rerouteErr) {
        console.error('[POST /booking/confirm] QUOTE_EXPIRED re-route failed:', rerouteErr);
      }

      // Non-surewaka_way, or re-route sequence failed — fall back to standard 409
      return c.json(
        { data: null, error: { code: 'QUOTE_EXPIRED', message: 'One or more quotes have expired — please re-quote' }, meta: null },
        409,
      );
    }

    // Delivery ownership/status errors
    if (code === 'NOT_FOUND') {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
    }
    if (code === 'INVALID_STATUS') {
      return c.json(
        { data: null, error: { code: 'INVALID_STATUS', message: 'Delivery is not in draft status' }, meta: null },
        422,
      );
    }
    if (code === 'ALREADY_CONFIRMED') {
      return c.json(
        { data: null, error: { code: 'ALREADY_CONFIRMED', message: 'Delivery already confirmed' }, meta: null },
        409,
      );
    }
    if (msg === 'INSUFFICIENT_BALANCE') {
      return c.json(
        { data: null, error: { code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance too low' }, meta: null },
        422,
      );
    }
    console.error('[POST /booking/confirm]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to confirm booking' }, meta: null },
      500,
    );
  }
});

// Refund percentage by delivery status when customer cancels
const REFUND_RATES: Record<string, number> = {
  pending: 1.0,
  accepted: 1.0,
  en_route_pickup: 0.85,
  arrived_pickup: 0.85,
  picked_up: 0.5,
  en_route_dropoff: 0.5,
  arrived_dropoff: 0.5,
};

const NON_CANCELLABLE = new Set(['delivered', 'cancelled', 'failed', 'returned']);

// POST /deliveries/:id/cancel — tiered refund
bookingPaymentRoutes.post('/deliveries/:id/cancel', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join(', ') }, meta: null },
      400,
    );
  }

  try {
    const wallet = await getWalletByUserId(user.id);

    let refundAmount = 0;
    // Captured outside the tx for post-commit ledger write (fire-and-forget)
    let cancellationFeeKobo = 0;
    let feeSourceEscrowId: string | null = null;
    let capturedAmountPaid = 0;
    let capturedEscrowHoldId: string | null = null;

    await db.transaction(async (tx) => {
      // SELECT with row lock inside the transaction
      const [locked] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId))
        .for('update');

      if (!locked || locked.customerId !== user.id) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }

      // Draft deliveries (all modes) — no payment has been taken, free cancel
      if (locked.status === 'draft') {
        await tx
          .update(deliveries)
          .set({ status: 'cancelled', paymentStatus: 'released' })
          .where(eq(deliveries.id, deliveryId));
        return; // refundAmount stays 0
      }

      if (NON_CANCELLABLE.has(locked.status)) {
        throw Object.assign(new Error('CANNOT_CANCEL'), { code: 'CANNOT_CANCEL', status: locked.status });
      }

      // pending_routing: routing not yet complete, no escrow — free cancel
      if (locked.status === 'pending_routing') {
        await tx
          .update(deliveries)
          .set({ status: 'cancelled', paymentStatus: 'released' })
          .where(eq(deliveries.id, deliveryId));
        return; // refundAmount stays 0
      }

      const amountPaid = Number(locked.amountPaid ?? 0);
      capturedAmountPaid = amountPaid;
      capturedEscrowHoldId = locked.escrowHoldId;

      if (locked.cancellationDeadlineAt) {
        // surewaka_way pending — apply deadline-based refund logic
        const now = new Date();
        if (now < locked.cancellationDeadlineAt) {
          // Within free-cancel window — full refund
          refundAmount = amountPaid;
        } else {
          // Late cancellation — deduct first active intercity leg quote as cancellation fee
          const [intercityLegQuote] = await tx
            .select({ totalKobo: quotes.totalKobo })
            .from(deliveryLegs)
            .innerJoin(
              quotes,
              and(
                eq(quotes.deliveryLegId, deliveryLegs.id),
                isNull(quotes.supersededAt),
              ),
            )
            .where(
              and(
                eq(deliveryLegs.deliveryId, deliveryId),
                eq(deliveryLegs.legType, 'intercity'),
                eq(deliveryLegs.isActive, true),
              ),
            )
            .limit(1);

          const feeKobo = intercityLegQuote?.totalKobo ?? 0;
          refundAmount = Math.max(0, amountPaid - feeKobo);
          // Capture for post-commit ledger write
          cancellationFeeKobo = feeKobo;
          feeSourceEscrowId = locked.escrowHoldId;
        }
      } else {
        // on_demand or carrier_direct — existing tiered refund rates
        const rate = REFUND_RATES[locked.status] ?? 0;
        refundAmount = Math.floor(amountPaid * rate);
      }

      await tx
        .update(deliveries)
        .set({ status: 'cancelled', paymentStatus: refundAmount > 0 ? 'refunded' : 'released' })
        .where(eq(deliveries.id, deliveryId));

      if (locked.escrowHoldId) {
        await tx
          .update(escrowHolds)
          .set({
            status: refundAmount === amountPaid ? 'refunded' : 'partially_refunded',
            refundedAt: new Date(),
          })
          .where(eq(escrowHolds.id, locked.escrowHoldId));
      }

      if (refundAmount > 0) {
        await creditWallet(
          wallet.id,
          refundAmount,
          'refund',
          // Deterministic reference — duplicate cancel attempts will fail on UNIQUE constraint,
          // preventing double-refunds.
          `refund_${deliveryId}`,
          `Cancellation refund for delivery ${deliveryId}`,
          { delivery_id: deliveryId, original_amount: amountPaid, refund_amount: refundAmount },
          tx,
        );
      }
    });

    // Write cancellation fee commission ledger event after transaction commits.
    // Fire-and-forget with internal retry queue — cancel response is not blocked by this.
    if (cancellationFeeKobo > 0 && feeSourceEscrowId) {
      writeLedgerEvent({
        category: 'revenue',
        type: 'commission',
        amountKobo: cancellationFeeKobo,
        sourceId: feeSourceEscrowId,
        sourceType: 'escrow_hold',
      }).catch((err) => console.error('[cancel] commission ledger write failed:', err));
    }

    // For partial refunds (non-surewaka_way), the retained portion is platform revenue.
    // Record as commission so P&L accurately reflects earnings from forfeited escrow.
    if (
      cancellationFeeKobo === 0 &&
      capturedAmountPaid > 0 &&
      refundAmount > 0 &&
      refundAmount < capturedAmountPaid &&
      capturedEscrowHoldId
    ) {
      const retainedAmount = capturedAmountPaid - refundAmount;
      writeLedgerEvent({
        category: 'revenue',
        type: 'commission',
        amountKobo: retainedAmount,
        sourceId: capturedEscrowHoldId,
        sourceType: 'escrow_hold',
      }).catch((err) => console.error('[cancel] retained commission ledger write failed:', err));
    }

    // Push notification: notify customer of cancellation.
    // This endpoint is customer-initiated (requireAuth ensures user is the delivery owner),
    // so we pass 'customer' as cancelledBy — the trigger function will skip the push
    // since the customer already knows they cancelled.
    // When driver/carrier/admin cancel endpoints are built, pass their role instead.
    const [cancelledDelivery] = await db
      .select({ customerId: deliveries.customerId })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);

    if (cancelledDelivery) {
      // Fire-and-forget — push failure should not affect the cancel response
      notifyDeliveryCancelled(deliveryId, cancelledDelivery.customerId, 'customer').catch(
        (err) => console.error('[PushTrigger] delivery_cancelled failed:', err),
      );
    }

    return c.json({ data: { delivery_id: deliveryId, refund_amount: refundAmount }, error: null, meta: null });
  } catch (err) {
    const code = (err as { code?: string }).code;
    const errStatus = (err as { status?: string }).status;
    if (code === 'NOT_FOUND') {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
    }
    if (code === 'CANNOT_CANCEL') {
      return c.json(
        { data: null, error: { code: 'CANNOT_CANCEL', message: `Cannot cancel a delivery in status: ${errStatus}` }, meta: null },
        422,
      );
    }
    console.error('[POST /deliveries/:id/cancel]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel delivery' }, meta: null },
      500,
    );
  }
});

export default bookingPaymentRoutes;
