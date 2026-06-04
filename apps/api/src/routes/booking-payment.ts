import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, deliveries, escrowHolds } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, creditWallet, debitWallet } from '../lib/wallet-service';
import { bookingConfirmSchema, cancelDeliverySchema } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import { randomUUID } from 'crypto';

type Env = { Variables: { user: SupabaseUser; accessToken: string } };

const bookingPaymentRoutes = new Hono<Env>();
bookingPaymentRoutes.use('*', requireAuth);

// POST /booking/confirm — escrow hold + wallet debit
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

  const { delivery_id, amount } = parsed.data;

  try {
    const wallet = await getWalletByUserId(user.id);
    const reference = `escrow_${delivery_id}_${randomUUID().slice(0, 8)}`;

    await db.transaction(async (tx) => {
      await debitWallet(wallet.id, amount, 'escrow_hold', reference, `Escrow for delivery ${delivery_id}`);

      const [escrow] = await tx
        .insert(escrowHolds)
        .values({
          deliveryId: delivery_id,
          senderWalletId: wallet.id,
          totalAmount: amount,
          status: 'held',
          heldAt: new Date(),
        })
        .returning();

      await tx
        .update(deliveries)
        .set({ status: 'pending', paymentStatus: 'escrowed', escrowHoldId: escrow.id, amountPaid: amount })
        .where(eq(deliveries.id, delivery_id));
    });

    return c.json({ data: { delivery_id, status: 'confirmed' }, error: null, meta: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
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

const NON_CANCELLABLE = new Set(['delivered', 'cancelled', 'failed', 'returned', 'draft']);

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
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));

    if (!delivery || delivery.customerId !== user.id) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
    }

    if (NON_CANCELLABLE.has(delivery.status)) {
      return c.json(
        { data: null, error: { code: 'CANNOT_CANCEL', message: `Cannot cancel a delivery in status: ${delivery.status}` }, meta: null },
        422,
      );
    }

    const rate = REFUND_RATES[delivery.status] ?? 0;
    const amountPaid = Number(delivery.amountPaid ?? 0);
    const refundAmount = Math.floor(amountPaid * rate);

    await db.transaction(async (tx) => {
      await tx
        .update(deliveries)
        .set({ status: 'cancelled', paymentStatus: refundAmount > 0 ? 'refunded' : 'released' })
        .where(eq(deliveries.id, deliveryId));

      if (delivery.escrowHoldId) {
        await tx
          .update(escrowHolds)
          .set({
            status: refundAmount === amountPaid ? 'refunded' : 'partially_refunded',
            refundedAt: new Date(),
          })
          .where(eq(escrowHolds.id, delivery.escrowHoldId));
      }

      if (refundAmount > 0) {
        const wallet = await getWalletByUserId(user.id);
        await creditWallet(
          wallet.id,
          refundAmount,
          'refund',
          `refund_${deliveryId}_${Date.now()}`,
          `Cancellation refund for delivery ${deliveryId} (${Math.round(rate * 100)}%)`,
          { delivery_id: deliveryId, original_amount: amountPaid, refund_rate: rate },
        );
      }
    });

    return c.json({ data: { delivery_id: deliveryId, refund_amount: refundAmount }, error: null, meta: null });
  } catch (err) {
    console.error('[POST /deliveries/:id/cancel]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel delivery' }, meta: null },
      500,
    );
  }
});

export default bookingPaymentRoutes;
