import { db, wallets, escrowHolds, deliveries, walletTransactions } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import type { RefundJobData } from '../queue';

export async function handleRefund(data: RefundJobData) {
  const refundAmount = Math.floor(data.amount * data.rate);
  if (refundAmount <= 0) return { refundAmount: 0 };

  await db.transaction(async (tx) => {
    // Refund to sender wallet and capture new balance for audit
    const [updatedWallet] = await tx
      .update(wallets)
      .set({ balance: sql`balance + ${refundAmount}`, updatedAt: new Date() })
      .where(eq(wallets.id, data.walletId))
      .returning({ balance: wallets.balance });

    if (!updatedWallet) throw new Error(`Sender wallet not found: ${data.walletId}`);

    // Insert wallet transaction audit record
    await tx
      .insert(walletTransactions)
      .values({
        walletId: data.walletId,
        type: 'refund',
        amount: refundAmount,
        balanceAfter: updatedWallet.balance,
        description: `Refund for delivery ${data.deliveryId}`,
        reference: `refund_${data.deliveryId}`,
      });

    // Mark escrow hold as refunded if deliveryId links to one
    await tx
      .update(escrowHolds)
      .set({ status: 'refunded', refundedAt: new Date() })
      .where(eq(escrowHolds.deliveryId, data.deliveryId));

    // Update delivery payment status
    await tx
      .update(deliveries)
      .set({ paymentStatus: 'refunded', updatedAt: new Date() })
      .where(eq(deliveries.id, data.deliveryId));
  });

  return { refundAmount };
}
