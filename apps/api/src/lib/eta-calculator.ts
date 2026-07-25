import { ETA_MINUTES_PER_KM, ETA_BUFFER_MINUTES, haversineKm } from '@surewaka/shared';

// Re-export so existing imports from this file continue to work
export { haversineKm };

export function calculateSystemEta(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  vehicleType: string,
): Date {
  const km = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const minsPerKm = ETA_MINUTES_PER_KM[vehicleType] ?? ETA_MINUTES_PER_KM['motorcycle'];
  const totalMinutes = Math.ceil(km * minsPerKm) + ETA_BUFFER_MINUTES;
  return new Date(Date.now() + totalMinutes * 60_000);
}
