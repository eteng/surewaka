import { db, deliveries, escrowHolds, wallets } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import type { EscrowReleaseJobData } from '../queue';

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
  const commissionAmount = Math.floor(hold.totalAmount * commissionRate);
  const driverAmount = hold.totalAmount - commissionAmount;

  await db.transaction(async (tx) => {
    // Credit driver wallet
    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${driverAmount}`, updatedAt: new Date() })
      .where(eq(wallets.id, data.driverWalletId));

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

  return { commissionAmount, driverAmount };
}
