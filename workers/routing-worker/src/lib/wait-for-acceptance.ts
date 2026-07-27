import type IORedis from 'ioredis';

/**
 * Wait for a driver to accept (claim) the delivery within the timeout.
 *
 * Polls the Redis claim key at 500ms intervals. When a driver accepts
 * via the acceptance API route, it sets `delivery:{deliveryId}:claim`
 * via SET NX. This function detects that key and returns the winner.
 *
 * Returns the winning driver ID if claimed, or null on timeout.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */
export async function waitForAcceptance(
  redis: IORedis,
  deliveryId: string,
  timeoutMs: number,
): Promise<string | null> {
  const claimKey = `delivery:${deliveryId}:claim`;
  const pollIntervalMs = 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const claimedBy = await redis.get(claimKey);
    if (claimedBy) {
      return claimedBy;
    }

    // Wait before next poll (don't exceed deadline)
    const remaining = deadline - Date.now();
    const waitMs = Math.min(pollIntervalMs, remaining);
    if (waitMs <= 0) break;

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  return null;
}
