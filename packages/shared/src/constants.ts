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
  'weight_correction',
  'broadcast',
  'system_alert',
  'wallet_withdrawal',
  'routing-complete',
  'routing-failed',
] as const;

export const PUSH_TARGET_APPS = ['customer', 'driver', 'admin'] as const;

export const HIGH_PRIORITY_PUSH_TYPES: PushNotificationType[] = [
  'delivery_status_change',
  'delivery_cancelled',
  'driver_arrived',
  'weight_correction',
  'system_alert',
  'routing-complete',
  'routing-failed',
];

export const PUSH_DEEP_LINK_MAP: Record<PushNotificationType, string> = {
  delivery_status_change: '/delivery/:resourceId',
  delivery_cancelled: '/delivery/:resourceId',
  driver_arrived: '/tracking/:resourceId',
  payment_received: '/wallet',
  dispute_opened: '/delivery/:resourceId/dispute',
  delivery_assigned: '/delivery/:resourceId',
  carrier_verified: '/',
  weight_correction: '/delivery/weight-correction',
  broadcast: '/:deepLink',
  system_alert: '/alerts',
  wallet_withdrawal: '/wallet',
  'routing-complete': '/delivery/:resourceId',
  'routing-failed': '/deliveries',
};

export const PUSH_APP_ROUTING: Record<PushNotificationType, PushTargetApp | 'all'> = {
  delivery_status_change: 'customer',
  delivery_cancelled: 'customer',
  driver_arrived: 'customer',
  payment_received: 'driver', // Driver earned the money — NOT 'customer'
  dispute_opened: 'customer', // overridden contextually for driver via targetAppOverride
  delivery_assigned: 'driver',
  carrier_verified: 'driver',
  weight_correction: 'customer',
  broadcast: 'all',
  system_alert: 'admin',
  wallet_withdrawal: 'all', // both customer and driver apps can withdraw
  'routing-complete': 'customer',
  'routing-failed': 'customer',
};

export const MAX_PUSH_TOKENS_PER_USER_PER_APP = 10;
export const PUSH_BATCH_SIZE = 100;
export const PUSH_MAX_RETRIES = 3;
export const PUSH_RETRY_BASE_MS = 1000;
export const PUSH_QUEUE_NAME = 'push-notifications';
export const PUSH_BROADCAST_QUEUE_NAME = 'push-broadcasts';
export const PUSH_BROADCAST_BATCH_SIZE = 500;

// ─── Delivery Model ───────────────────────────────────────────────────────────

export const LEG_TYPES = ['first_mile', 'intercity', 'last_mile'] as const;
export const LEG_ACTOR_TYPES = ['driver', 'carrier'] as const;
export const FAILURE_CAUSES = ['driver', 'carrier', 'route_traffic', 'system'] as const;

export const DEFAULT_SLA_HOURS: Record<string, number> = {
  first_mile: 1,
  intercity: 24,
  last_mile: 2,
};

// Statuses that trigger a customer-facing notification
export const CUSTOMER_FACING_STATUSES = [
  'accepted',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
] as const;

// ETA calculation: minutes per km by vehicle type (server-side use only)
export const ETA_MINUTES_PER_KM: Record<string, number> = {
  motorcycle: 3,
  car: 4,
  van: 5,
  truck: 6,
};
export const ETA_BUFFER_MINUTES = 15;

// Alert engine thresholds (minutes) — all configurable in /settings/alerts
export const ALERT_DRIVER_SILENT_WARNING_MIN = 15;
export const ALERT_DRIVER_SILENT_CRITICAL_MIN = 30;
export const ALERT_LEG_OVERDUE_WARNING_MIN = 30;
export const ALERT_LEG_OVERDUE_CRITICAL_MIN = 60;
export const ALERT_CUSTOMER_UPDATE_GAP_WARNING_MIN = 45;
export const ALERT_CUSTOMER_UPDATE_GAP_CRITICAL_MIN = 90;
export const ALERT_ONTIME_RATE_WARNING_PCT = 80;
export const ALERT_ONTIME_RATE_CRITICAL_PCT = 60;

// ─── Alert System ─────────────────────────────────────────────────────────────

export const ALERT_RULES = [
  'driver_silent',
  'leg_overdue',
  'driver_ghost',
  'dispute_filed',
  'delivery_failed',
  'ontime_rate_drop',
  'customer_update_gap',
] as const;

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

// ─── Fee Engine Error Codes ───────────────────────────────────────────────────

export const FEE_ENGINE_ERRORS = {
  INVALID_VEHICLE_TYPE: 'INVALID_VEHICLE_TYPE',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_MISSING: 'QUOTE_MISSING',
} as const;
