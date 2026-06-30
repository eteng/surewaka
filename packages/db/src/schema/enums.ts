import { pgEnum } from 'drizzle-orm/pg-core';

export const carrierApplicationStatus = pgEnum('carrier_application_status', [
  'pending',
  'under_review',
  'approved',
  'rejected',
]);

export const carrierMemberAction = pgEnum('carrier_member_action', [
  'invited',
  'joined',
  'role_changed',
  'suspended',
  'reactivated',
  'removed',
]);

export const carrierMemberRole = pgEnum('carrier_member_role', [
  'carrier_admin',
  'carrier_driver',
  'carrier_staff',
]);

export const deliveryStatus = pgEnum('delivery_status', [
  'draft',
  'pending',
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returned',
]);

export const escrowStatus = pgEnum('escrow_status', [
  'held',
  'released',
  'refunded',
  'disputed',
  'partially_refunded',
]);

export const nameChangeStatus = pgEnum('name_change_status', ['pending', 'approved', 'rejected']);

export const notificationType = pgEnum('notification_type', [
  'new_user_signup',
  'delivery_issue',
  'carrier_verification_request',
  'carrier_verified',
  'dispute_opened',
  'driver_verification_request',
  'system_alert',
]);

export const packageCategory = pgEnum('package_category', [
  'document',
  'parcel',
  'fragile',
  'heavy',
  'food',
]);

export const transactionType = pgEnum('transaction_type', [
  'fund',
  'escrow_hold',
  'escrow_release',
  'refund',
  'payout',
  'commission',
  'adjustment',
]);

export const userRole = pgEnum('user_role', [
  'customer',
  'driver',
  'carrier_driver',
  'carrier_admin',
  'support_agent',
  'surewaka_admin',
]);

export const vehicleType = pgEnum('vehicle_type', ['motorcycle', 'car', 'van', 'truck']);

export const waitlistUserType = pgEnum('waitlist_user_type', ['sender', 'business', 'driver']);

export const customerTier = pgEnum('customer_tier', ['power', 'regular', 'new', 'dormant']);

export const walletStatus = pgEnum('wallet_status', ['active', 'frozen', 'closed']);
