import { db, wallets, escrowHolds, deliveries } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import type { RefundJobData } from '../queue';

export async function handleRefund(data: RefundJobData) {
  const refundAmount = Math.floor(data.amount * data.rate);
  if (refundAmount <= 0) return { refundAmount: 0 };

  await db.transaction(async (tx) => {
    // Refund to sender wallet
    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${refundAmount}`, updatedAt: new Date() })
      .where(eq(wallets.id, data.walletId));

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
