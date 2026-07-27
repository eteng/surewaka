import type IORedis from 'ioredis';
import { MATCHING_RESERVATION_TTL_SECONDS, MATCHING_CLAIM_TTL_SECONDS } from '@surewaka/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReservationResult = { reserved: true } | { reserved: false; reason: string };
export type ClaimResult = { claimed: true } | { claimed: false; claimedBy: string };

// ─── Dependency Injection ─────────────────────────────────────────────────────

let redis: IORedis;

export function initReservation(redisClient: IORedis): void {
  redis = redisClient;
}

function getRedis(): IORedis {
  if (!redis) {
    throw new Error('Reservation layer not initialized. Call initReservation() first.');
  }
  return redis;
}

// ─── Lua Script ───────────────────────────────────────────────────────────────

/**
 * Atomically reserves a driver for a delivery.
 *
 * KEYS[1] = driver:{driverId}:meta   — hash with driver status
 * KEYS[2] = driver:{driverId}:reserved — reservation key
 * ARGV[1] = deliveryId
 * ARGV[2] = ttlSeconds
 *
 * Returns:
 *   'ok'               — reservation granted
 *   'not_available'    — driver status is not 'available'
 *   'already_reserved' — driver already reserved by another delivery
 */
const RESERVE_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status or status ~= 'available' then
  return 'not_available'
end

local existing = redis.call('GET', KEYS[2])
if existing then
  return 'already_reserved'
end

redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 'ok'
`;

// ─── reserveDriver ────────────────────────────────────────────────────────────

/**
 * Atomically reserve a driver for a delivery using a Redis Lua script.
 *
 * The Lua script ensures no TOCTOU race:
 * 1. Checks driver:{driverId}:meta hash — status must be 'available'
 * 2. Checks driver:{driverId}:reserved key — must not exist
 * 3. Sets driver:{driverId}:reserved with the deliveryId and TTL
 *
 * TTL auto-expires zombie reservations (default 60s).
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */
export async function reserveDriver(
  driverId: string,
  deliveryId: string,
  ttlSeconds: number = MATCHING_RESERVATION_TTL_SECONDS,
): Promise<ReservationResult> {
  const client = getRedis();

  const metaKey = `driver:${driverId}:meta`;
  const reservedKey = `driver:${driverId}:reserved`;

  const result = await client.eval(
    RESERVE_SCRIPT,
    2, // number of KEYS
    metaKey,
    reservedKey,
    deliveryId,
    ttlSeconds.toString(),
  );

  if (result === 'ok') {
    return { reserved: true };
  }

  return { reserved: false, reason: result as string };
}

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
  deliveryId: string,
  driverId: string,
  ttlSeconds: number = MATCHING_CLAIM_TTL_SECONDS,
): Promise<ClaimResult> {
  const client = getRedis();
  const claimKey = `delivery:${deliveryId}:claim`;

  const result = await client.set(claimKey, driverId, 'EX', ttlSeconds, 'NX');

  if (result === 'OK') {
    return { claimed: true };
  }

  // Key already exists — another driver claimed first
  const claimedBy = await client.get(claimKey);
  return { claimed: false, claimedBy: claimedBy ?? 'unknown' };
}

// ─── releaseReservation ───────────────────────────────────────────────────────

/**
 * Release a single driver reservation.
 *
 * Validates: Requirements 5.5
 */
export async function releaseReservation(driverId: string): Promise<void> {
  const client = getRedis();
  await client.del(`driver:${driverId}:reserved`);
}

// ─── releaseReservations ──────────────────────────────────────────────────────

/**
 * Release all reservations for a batch of drivers.
 *
 * Validates: Requirements 5.5
 */
export async function releaseReservations(driverIds: string[]): Promise<void> {
  if (driverIds.length === 0) {
    return;
  }

  const client = getRedis();
  const keys = driverIds.map((id) => `driver:${id}:reserved`);
  await client.del(...keys);
}
