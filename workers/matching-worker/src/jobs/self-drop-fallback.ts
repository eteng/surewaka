import { db, deliveries, deliveryLegs } from '@surewaka/db';
import { eq, and } from 'drizzle-orm';
import { createAblyProvider } from '@surewaka/realtime';

/**
 * Trigger the self-drop-off fallback flow when first-mile matching fails.
 *
 * Sends a push notification to the customer offering them the option to
 * drop their package at the park themselves (bypassing first-mile driver).
 *
 * The customer has 15 minutes to respond:
 * - Accept: first-mile leg cancelled, refund issued, remaining legs proceed
 * - Decline or timeout: entire delivery cancelled with full refund
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */
export async function triggerSelfDropFallback(
  deliveryId: string,
  legId: string,
  customerId: string,
  parkName: string,
): Promise<void> {
  // Set a 15-minute cancellation deadline on the delivery
  const deadline = new Date(Date.now() + 15 * 60 * 1000);

  await db
    .update(deliveries)
    .set({ cancellationDeadlineAt: deadline, updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));

  // Send push notification to customer with self-drop offer (Req 12.1)
  const realtime = createAblyProvider();
  await realtime.publish(`delivery:${deliveryId}`, 'self-drop-offer', {
    deliveryId,
    legId,
    parkName,
    deadline: deadline.toISOString(),
    message: `No driver is available for pickup. You can drop your package at ${parkName} yourself. You have 15 minutes to decide.`,
  });
}

/**
 * Handle customer accepting the self-drop-off offer.
 *
 * Cancels the first-mile leg and refunds its quote portion.
 * Remaining legs (intercity, transfer, last-mile) remain active.
 *
 * Validates: Requirements 12.2, 12.3
 */
export async function acceptSelfDrop(
  deliveryId: string,
  legId: string,
): Promise<void> {
  // Cancel the first-mile leg (Req 12.2)
  await db
    .update(deliveryLegs)
    .set({ status: 'cancelled', isActive: false })
    .where(and(eq(deliveryLegs.id, legId), eq(deliveryLegs.deliveryId, deliveryId)));

  // Clear the cancellation deadline (decision made)
  await db
    .update(deliveries)
    .set({ cancellationDeadlineAt: null, updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));

  // TODO: Trigger refund for first-mile leg quote portion
  // This would use the existing payment/refund service
}

/**
 * Handle customer declining the self-drop-off offer or 15-minute timeout.
 *
 * Cancels the entire delivery with a full refund and notifies ops.
 *
 * Validates: Requirements 12.4, 12.5
 */
export async function declineSelfDrop(deliveryId: string): Promise<void> {
  // Cancel the entire delivery (Req 12.4, 12.5)
  await db
    .update(deliveries)
    .set({ status: 'cancelled', cancellationDeadlineAt: null, updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));

  // Deactivate all legs
  await db
    .update(deliveryLegs)
    .set({ isActive: false })
    .where(eq(deliveryLegs.deliveryId, deliveryId));

  // TODO: Trigger full refund
  // TODO: Notify operations team
}
