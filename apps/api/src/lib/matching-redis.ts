import type IORedis from 'ioredis';
import { MATCHING_CLAIM_TTL_SECONDS } from '@surewaka/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClaimResult = { claimed: true } | { claimed: false; claimedBy: string };

// ─── claimDelivery ────────────────────────────────────────────────────────────

/**
 * Atomic first-accept-wins claim for a delivery.
 *
 * Uses Redis SET NX (set-if-not-exists) to ensure only one driver can claim
 * a delivery. If the key already exists, the existing claimant is returned.
 *
 * Validates: Requirements 6.1, 5.5
 */
export async function claimDelivery(
  redis: IORedis,
  deliveryId: string,
  driverId: string,
  ttlSeconds: number = MATCHING_CLAIM_TTL_SECONDS,
): Promise<ClaimResult> {
  const claimKey = `delivery:${deliveryId}:claim`;

  const result = await redis.set(claimKey, driverId, 'EX', ttlSeconds, 'NX');

  if (result === 'OK') {
    return { claimed: true };
  }

  // Key already exists — another driver claimed first
  const claimedBy = await redis.get(claimKey);
  return { claimed: false, claimedBy: claimedBy ?? 'unknown' };
}

// ─── releaseReservations ──────────────────────────────────────────────────────

/**
 * Release all reservations for a batch of drivers.
 *
 * Validates: Requirements 5.5, 6.5
 */
export async function releaseReservations(
  redis: IORedis,
  driverIds: string[],
): Promise<void> {
  if (driverIds.length === 0) {
    return;
  }

  const keys = driverIds.map((id) => `driver:${id}:reserved`);
  await redis.del(...keys);
}
