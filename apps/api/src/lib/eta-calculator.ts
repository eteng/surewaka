import { ETA_MINUTES_PER_KM, ETA_BUFFER_MINUTES } from '@surewaka/shared';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
