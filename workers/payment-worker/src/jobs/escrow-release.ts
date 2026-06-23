import { db, deliveries, escrowHolds, walletTransactions, wallets } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import { drivers } from '@surewaka/db';
import type { EscrowReleaseJobData } from '../queue';
import { enqueuePushFromWorker } from '../push-enqueue';
import { PUSH_DEEP_LINK_MAP, type PushNotificationPayload } from '@surewaka/shared';

export async function handleEscrowRelease(data: EscrowReleaseJobData) {
  // Fetch the escrow hold to get total amount and commission rate
  const [hold] = await db
    .select({
      id: escrowHolds.id,
      totalAmount: escrowHolds.totalAmount,
      commissionRate: escrowHolds.commissionRate,
      status: escrowHolds.status,
    })
    .from(escrowHolds)
    .where(eq(escrowHolds.id, data.escrowHoldId));

  if (!hold) throw new Error(`Escrow hold not found: ${data.escrowHoldId}`);
  if (hold.status !== 'held') throw new Error(`Escrow hold is not in held state: ${hold.status}`);

  const commissionRate = Number(hold.commissionRate);
  if (isNaN(commissionRate)) throw new Error(`Invalid commission rate on hold ${data.escrowHoldId}`);
  const commissionAmount = Math.floor(hold.totalAmount * commissionRate);
  const driverAmount = hold.totalAmount - commissionAmount;

  await db.transaction(async (tx) => {
    // Credit driver wallet and capture new balance for audit
    const [updatedWallet] = await tx
      .update(wallets)
      .set({ balance: sql`balance + ${driverAmount}`, updatedAt: new Date() })
      .where(eq(wallets.id, data.driverWalletId))
      .returning({ balance: wallets.balance });

    if (!updatedWallet) throw new Error(`Driver wallet not found: ${data.driverWalletId}`);

    // Insert wallet transaction audit record
    await tx
      .insert(walletTransactions)
      .values({
        walletId: data.driverWalletId,
        type: 'escrow_release',
        amount: driverAmount,
        balanceAfter: updatedWallet.balance,
        description: `Delivery ${data.deliveryId} payment released`,
        reference: `release_${data.escrowHoldId}`,
      });

    // Update escrow hold: mark released, record amounts and driver wallet
    await tx
      .update(escrowHolds)
      .set({
        status: 'released',
        driverWalletId: data.driverWalletId,
        commissionAmount,
        driverAmount,
        releasedAt: new Date(),
      })
      .where(eq(escrowHolds.id, data.escrowHoldId));

    // Update delivery payment status
    await tx
      .update(deliveries)
      .set({ paymentStatus: 'released', updatedAt: new Date() })
      .where(eq(deliveries.id, data.deliveryId));
  });

  // Push notification: notify driver of payment received
  // Resolve the driver's userId from the delivery's driverId.
  // Fire-and-forget — push failure should not affect payment processing.
  // Uses deliveryId as resourceId (the user-facing entity, not escrow hold ID).
  // Requirements: 3.1, 10.3
  try {
    const [delivery] = await db
      .select({ driverId: deliveries.driverId })
      .from(deliveries)
      .where(eq(deliveries.id, data.deliveryId))
      .limit(1);

    if (delivery?.driverId) {
      const [driver] = await db
        .select({ userId: drivers.userId })
        .from(drivers)
        .where(eq(drivers.id, delivery.driverId))
        .limit(1);

      if (driver) {
        const formattedAmount = `₦${driverAmount.toLocaleString('en-NG')}`;
        const payload: PushNotificationPayload = {
          title: 'Payment Received',
          body: `${formattedAmount} has been released to your wallet for delivery completion.`,
          data: {
            type: 'payment_received',
            resourceId: data.deliveryId,
            deepLink: PUSH_DEEP_LINK_MAP.payment_received,
          },
        };

        await enqueuePushFromWorker(driver.userId, 'payment_received', payload);
      }
    }
  } catch (err) {
    // Push failure is non-critical — log and continue
    console.error('[EscrowRelease:Push] Failed to enqueue payment_received push:', err);
  }

  return { commissionAmount, driverAmount };
}
