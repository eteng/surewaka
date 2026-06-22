// SureWaka constants

export const APP_NAME = 'SureWaka';
export const APP_DESCRIPTION = 'Move goods across Nigeria — reliably, affordably, instantly.';

export const SUPPORTED_CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan'] as const;
export type SupportedCity = (typeof SUPPORTED_CITIES)[number];

export const COMMISSION_RATE = 0.15; // 15% commission on deliveries

export const MAX_DELIVERY_WEIGHT_KG = 500;
export const MIN_DELIVERY_PRICE_NGN = 500;

export const VEHICLE_TYPES = ['motorcycle', 'car', 'van', 'truck'] as const;
export const PACKAGE_CATEGORIES = ['document', 'parcel', 'fragile', 'heavy', 'food'] as const;
export const USER_ROLES = ['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent'] as const;

export const NOTIFICATION_TYPES = [
  'new_user_signup',
  'delivery_issue',
  'carrier_verification_request',
  'carrier_verified',
  'dispute_opened',
  'driver_verification_request',
  'system_alert',
] as const;

export const ALLOWED_AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
export const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Push Notifications ──────────────────────────────────────────────────────

import type { PushNotificationType, PushTargetApp } from './types';

export const PUSH_NOTIFICATION_TYPES = [
  'delivery_status_change',
  'delivery_cancelled',
  'driver_arrived',
  'payment_received',
  'dispute_opened',
  'delivery_assigned',
  'carrier_verified',
  'broadcast',
] as const;

export const PUSH_TARGET_APPS = ['customer', 'driver'] as const;

export const HIGH_PRIORITY_PUSH_TYPES: PushNotificationType[] = [
  'delivery_status_change',
  'delivery_cancelled',
  'driver_arrived',
];

export const PUSH_DEEP_LINK_MAP: Record<PushNotificationType, string> = {
  delivery_status_change: '/delivery/:resourceId',
  delivery_cancelled: '/delivery/:resourceId',
  driver_arrived: '/tracking/:resourceId',
  payment_received: '/wallet',
  dispute_opened: '/delivery/:resourceId/dispute',
  delivery_assigned: '/delivery/:resourceId',
  carrier_verified: '/',
  broadcast: '/:deepLink',
};

export const PUSH_APP_ROUTING: Record<PushNotificationType, PushTargetApp | 'all'> = {
  delivery_status_change: 'customer',
  delivery_cancelled: 'customer',
  driver_arrived: 'customer',
  payment_received: 'driver', // Driver earned the money — NOT 'customer'
  dispute_opened: 'customer', // overridden contextually for driver via targetAppOverride
  delivery_assigned: 'driver',
  carrier_verified: 'driver',
  broadcast: 'all',
};

export const MAX_PUSH_TOKENS_PER_USER_PER_APP = 10;
export const PUSH_BATCH_SIZE = 100;
export const PUSH_MAX_RETRIES = 3;
export const PUSH_RETRY_BASE_MS = 1000;
export const PUSH_QUEUE_NAME = 'push:notifications';
export const PUSH_BROADCAST_QUEUE_NAME = 'push:broadcasts';
export const PUSH_BROADCAST_BATCH_SIZE = 500;
