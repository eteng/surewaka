// Feature: push-notifications
// Push Triggers — integration point functions that fire push notifications
// for business events. Wire these into the corresponding handlers when they are built.
// Requirements: 3.1, 3.9, 10.2, 10.3, 10.5, 10.6

import { db, deliveries, drivers, carrierMembers } from '@surewaka/db';
import { eq, and } from 'drizzle-orm';
import { enqueuePush } from './push-service';
import {
  PUSH_DEEP_LINK_MAP,
  type PushNotificationType,
  type PushNotificationPayload,
} from '@surewaka/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDeepLink(type: PushNotificationType, resourceId: string): string {
  const template = PUSH_DEEP_LINK_MAP[type];
  return template.replace(':resourceId', resourceId);
}

function buildPayload(
  type: PushNotificationType,
  title: string,
  body: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): PushNotificationPayload {
  return {
    title,
    body,
    data: {
      type,
      resourceId,
      deepLink: buildDeepLink(type, resourceId),
      ...(metadata ? { metadata } : {}),
    },
  };
}

// ─── Delivery Status Change ──────────────────────────────────────────────────

/**
 * Notify customer when delivery status transitions to picked_up, en_route_dropoff, or delivered.
 *
 * Call this from the delivery status update handler when the new status is one of:
 * - picked_up
 * - en_route_dropoff
 * - delivered
 *
 * Requirements: 3.1, 10.2
 */
export async function notifyDeliveryStatusChange(
  deliveryId: string,
  customerId: string,
  newStatus: 'picked_up' | 'en_route_dropoff' | 'delivered',
): Promise<boolean> {
  const statusMessages: Record<string, { title: string; body: string }> = {
    picked_up: {
      title: 'Package Picked Up',
      body: 'Your package has been picked up and is on its way.',
    },
    en_route_dropoff: {
      title: 'Out for Delivery',
      body: 'Your package is en route to the drop-off location.',
    },
    delivered: {
      title: 'Delivery Complete',
      body: 'Your package has been delivered successfully.',
    },
  };

  const msg = statusMessages[newStatus];
  const payload = buildPayload(
    'delivery_status_change',
    msg.title,
    msg.body,
    deliveryId,
    { status: newStatus },
  );

  return enqueuePush(customerId, 'delivery_status_change', payload);
}

// ─── Delivery Cancelled ──────────────────────────────────────────────────────

/**
 * Notify customer when their delivery is cancelled.
 *
 * If the cancellation is initiated by the customer themselves, the caller should
 * skip this notification (they already know). If triggered by driver/carrier/admin,
 * always send.
 *
 * @param deliveryId - The delivery UUID (used as resourceId)
 * @param customerId - The customer's user UUID
 * @param cancelledBy - Who initiated the cancellation ('customer' | 'driver' | 'carrier' | 'admin')
 *
 * Requirements: 3.1, 3.9, 10.2
 */
export async function notifyDeliveryCancelled(
  deliveryId: string,
  customerId: string,
  cancelledBy: 'customer' | 'driver' | 'carrier' | 'admin',
): Promise<boolean> {
  // Skip notification if customer cancelled themselves — they already know
  if (cancelledBy === 'customer') {
    return false;
  }

  const payload = buildPayload(
    'delivery_cancelled',
    'Delivery Cancelled',
    'Your delivery has been cancelled. A refund will be processed shortly.',
    deliveryId,
    { cancelledBy },
  );

  return enqueuePush(customerId, 'delivery_cancelled', payload);
}

// ─── Driver Assigned ─────────────────────────────────────────────────────────

/**
 * Notify driver when they are assigned to a delivery.
 *
 * Call this from the driver assignment handler (when delivery transitions
 * from pending → accepted and a driverId is set).
 *
 * @param deliveryId - The delivery UUID (used as resourceId)
 * @param driverUserId - The driver's user UUID (from drivers.userId)
 *
 * Requirements: 3.1, 10.3
 */
export async function notifyDriverAssigned(
  deliveryId: string,
  driverUserId: string,
): Promise<boolean> {
  const payload = buildPayload(
    'delivery_assigned',
    'New Delivery Assignment',
    'You have been assigned a new delivery. Tap to view details.',
    deliveryId,
  );

  return enqueuePush(driverUserId, 'delivery_assigned', payload);
}

// ─── Driver Arrived ──────────────────────────────────────────────────────────

/**
 * Notify customer when driver arrives at pickup or dropoff.
 *
 * This push fires when delivery status transitions to `arrived_pickup` or
 * `arrived_dropoff`. Wire it into whatever handler performs that transition.
 *
 * NOTE: No driver status transition endpoint exists yet (driver app is a
 * placeholder). The trigger mechanism (manual "I've arrived" button vs.
 * geofence) is out of scope for push notifications. When the driver delivery
 * flow is implemented, call this function on the relevant status transition.
 *
 * @param deliveryId - The delivery UUID (used as resourceId)
 * @param customerId - The customer's user UUID
 * @param arrivalType - 'arrived_pickup' or 'arrived_dropoff'
 *
 * Requirements: 3.1, 10.2
 */
export async function notifyDriverArrived(
  deliveryId: string,
  customerId: string,
  arrivalType: 'arrived_pickup' | 'arrived_dropoff',
): Promise<boolean> {
  const messages = {
    arrived_pickup: {
      title: 'Driver at Pickup',
      body: 'Your driver has arrived at the pickup location.',
    },
    arrived_dropoff: {
      title: 'Driver at Drop-off',
      body: 'Your driver has arrived at the drop-off location.',
    },
  };

  const msg = messages[arrivalType];
  const payload = buildPayload(
    'driver_arrived',
    msg.title,
    msg.body,
    deliveryId,
    { arrivalType },
  );

  return enqueuePush(customerId, 'driver_arrived', payload);
}

// ─── Payment Received (Escrow Release) ──────────────────────────────────────

/**
 * Notify driver when their payment is released from escrow.
 *
 * PUSH_APP_ROUTING resolves 'payment_received' to 'driver' tokens automatically —
 * no targetAppOverride needed.
 *
 * @param deliveryId - The delivery UUID (used as resourceId — the user-facing entity)
 * @param driverUserId - The driver's user UUID (from drivers.userId)
 * @param amount - The amount released (for display in notification body)
 *
 * Requirements: 3.1, 10.3
 */
export async function notifyPaymentReceived(
  deliveryId: string,
  driverUserId: string,
  amount: number,
): Promise<boolean> {
  const formattedAmount = `₦${amount.toLocaleString('en-NG')}`;
  const payload = buildPayload(
    'payment_received',
    'Payment Received',
    `${formattedAmount} has been released to your wallet for delivery completion.`,
    deliveryId,
  );

  return enqueuePush(driverUserId, 'payment_received', payload);
}

// ─── Dispute Opened ──────────────────────────────────────────────────────────

/**
 * Notify both customer and driver (if assigned) when a dispute is opened.
 *
 * Two push calls:
 * 1. Customer (sender) — always notified via 'customer' app
 * 2. Driver — only notified if delivery.driverId is non-null (resolve
 *    driver's userId from drivers table). Skip entirely for pre-assignment
 *    disputes.
 *
 * @param deliveryId - The delivery UUID (used as resourceId)
 * @param customerId - The customer's user UUID (delivery sender)
 * @param driverId - The driver ID (from deliveries.driverId) — may be null
 *
 * Requirements: 3.1, 10.5, 10.6
 */
export async function notifyDisputeOpened(
  deliveryId: string,
  customerId: string,
  driverId: string | null,
): Promise<{ customerNotified: boolean; driverNotified: boolean }> {
  const customerPayload = buildPayload(
    'dispute_opened',
    'Dispute Opened',
    'A dispute has been opened for your delivery. We will review and respond shortly.',
    deliveryId,
  );

  // Notify customer (sender) — target customer app tokens
  const customerNotified = await enqueuePush(
    customerId,
    'dispute_opened',
    customerPayload,
    'customer',
  );

  // Notify driver only if one was assigned
  let driverNotified = false;
  if (driverId) {
    // Resolve driver's userId from the drivers table
    const [driver] = await db
      .select({ userId: drivers.userId })
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (driver) {
      const driverPayload = buildPayload(
        'dispute_opened',
        'Dispute Opened',
        'A dispute has been opened for a delivery you handled. We will review shortly.',
        deliveryId,
      );

      driverNotified = await enqueuePush(
        driver.userId,
        'dispute_opened',
        driverPayload,
        'driver',
      );
    }
  }

  return { customerNotified, driverNotified };
}

// ─── Carrier Verified ────────────────────────────────────────────────────────

/**
 * Notify carrier admin when their carrier account is verified.
 *
 * Resolves the carrier admin's userId via the carrier_members table
 * (role = 'carrier_admin'). Uses carrierId as resourceId — doesn't drive
 * navigation today (deep links to `/`) but future-proofs for a carrier
 * profile deep link.
 *
 * @param carrierId - The carrier UUID (from route params, used as resourceId)
 *
 * Requirements: 3.1, 10.3
 */
export async function notifyCarrierVerified(carrierId: string): Promise<boolean> {
  // Find the carrier admin's userId via carrier_members table
  const [admin] = await db
    .select({ userId: carrierMembers.userId })
    .from(carrierMembers)
    .where(
      and(
        eq(carrierMembers.carrierId, carrierId),
        eq(carrierMembers.role, 'carrier_admin'),
        eq(carrierMembers.isActive, true),
      ),
    )
    .limit(1);

  if (!admin) {
    console.warn(
      `[PushTriggers] No active carrier_admin found for carrier ${carrierId}, skipping push`,
    );
    return false;
  }

  const payload = buildPayload(
    'carrier_verified',
    'Carrier Verified',
    'Congratulations! Your carrier account has been verified. You can now receive deliveries.',
    carrierId,
  );

  return enqueuePush(admin.userId, 'carrier_verified', payload);
}
