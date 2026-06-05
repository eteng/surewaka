import { db, deliveries, escrowHolds } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { EscrowHoldJobData } from '../queue';

export async function handleEscrowHold(data: EscrowHoldJobData) {
  const [hold] = await db
    .insert(escrowHolds)
    .values({
      deliveryId: data.deliveryId,
      senderWalletId: data.walletId,
      totalAmount: data.amount,
      status: 'held',
      heldAt: new Date(),
    })
    .returning();

  await db
    .update(deliveries)
    .set({ paymentStatus: 'escrowed', escrowHoldId: hold.id, amountPaid: data.amount })
    .where(eq(deliveries.id, data.deliveryId));

  return { escrowHoldId: hold.id };
}
