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
export const USER_ROLES = ['customer', 'driver', 'carrier', 'admin', 'surewaka_admin', 'carrier_driver', 'carrier_admin'] as const;

export const ALLOWED_AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
export const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
