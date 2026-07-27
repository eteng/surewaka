import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  initReservation,
  reserveDriver,
  claimDelivery,
} from '../reservation';

// ─── Mock Redis for Reservation Tests ─────────────────────────────────────────

/**
 * Faithfully simulates the Redis commands used by the reservation layer:
 * - eval (Lua script) — atomic check-and-set for reserveDriver
 * - set with NX option — for claimDelivery
 * - get — for reading claim
 * - del — for releases
 * - hgetall — for meta check in the Lua script simulation
 */
function createMockRedis() {
  const hashes = new Map<string, Record<string, string>>();
  const strings = new Map<string, string>();

  return {
    /** Simulate the reserve Lua script atomically */
    async eval(_script: string, numKeys: number, ...args: (string | number)[]) {
      const keys = args.slice(0, numKeys) as string[];
      const argv = args.slice(numKeys) as string[];
      const [metaKey, reservedKey] = keys;
      const [deliveryId, _ttl] = argv;

      // Simulate: check meta status
      const meta = hashes.get(metaKey!);
      const status = meta?.status;
      if (!status || status !== 'available') return 'not_available';

      // Simulate: check if already reserved
      const existing = strings.get(reservedKey!);
      if (existing) return 'already_reserved';

      // Simulate: set reservation with TTL (TTL ignored in mock)
      strings.set(reservedKey!, deliveryId!);
      return 'ok';
    },

    /** SET with NX support for claimDelivery */
    async set(key: string, value: string, ..._opts: (string | number)[]) {
      // Check for NX option
      const optsStr = _opts.map((o) => String(o).toUpperCase());
      const hasNX = optsStr.includes('NX');

      if (hasNX) {
        const existing = strings.get(key);
        if (existing !== undefined) return null; // Key exists — NX fails
      }

      strings.set(key, value);
      return 'OK';
    },

    /** GET for reading claim */
    async get(key: string) {
      return strings.get(key) ?? null;
    },

    /** DEL for releases */
    async del(...keys: string[]) {
      let count = 0;
      for (const key of keys) {
        if (strings.has(key)) {
          strings.delete(key);
          count++;
        }
        if (hashes.has(key)) {
          hashes.delete(key);
          count++;
        }
      }
      return count;
    },

    // ─── Test helpers (not part of Redis interface) ─────────────────────────

    /** Set driver meta hash (test setup helper) */
    _setMeta(driverId: string, meta: Record<string, string>) {
      hashes.set(`driver:${driverId}:meta`, meta);
    },

    /** Check if a reservation key exists (test assertion helper) */
    _hasReservation(driverId: string): boolean {
      return strings.has(`driver:${driverId}:reserved`);
    },

    /** Get the reservation value (test assertion helper) */
    _getReservation(driverId: string): string | undefined {
      return strings.get(`driver:${driverId}:reserved`);
    },

    /** Get the claim value (test assertion helper) */
    _getClaim(deliveryId: string): string | undefined {
      return strings.get(`delivery:${deliveryId}:claim`);
    },
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const driverIdArb = fc.uuid();
const deliveryIdArb = fc.uuid();
const statusArb = fc.constantFrom('available', 'busy', 'offline');
const nonAvailableStatusArb = fc.constantFrom('busy', 'offline');

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Reservation Layer Property Tests', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);
  });

  /**
   * **Property 10: Reservation Guards**
   * Driver not available or already reserved → `{ reserved: false }` with no state change.
   *
   * **Validates: Requirements 5.2, 5.3**
   */
  describe('Property 10: Reservation Guards', () => {
    it('rejects reservation for drivers with status !== available (no state change)', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          deliveryIdArb,
          nonAvailableStatusArb,
          async (driverId, deliveryId, status) => {
            // Fresh mock per iteration
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            // Set driver meta with non-available status
            mockRedis._setMeta(driverId, { status });

            const result = await reserveDriver(driverId, deliveryId, 60);

            // Must be rejected
            expect(result.reserved).toBe(false);
            if (!result.reserved) {
              expect(result.reason).toBe('not_available');
            }

            // No state mutation — reservation key should NOT exist
            expect(mockRedis._hasReservation(driverId)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('rejects reservation for drivers with no meta (missing driver)', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          deliveryIdArb,
          async (driverId, deliveryId) => {
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            // No meta set — driver doesn't exist in Redis
            const result = await reserveDriver(driverId, deliveryId, 60);

            expect(result.reserved).toBe(false);
            if (!result.reserved) {
              expect(result.reason).toBe('not_available');
            }

            // No state mutation
            expect(mockRedis._hasReservation(driverId)).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('rejects reservation for already-reserved drivers (no state change)', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          deliveryIdArb,
          deliveryIdArb,
          async (driverId, existingDeliveryId, newDeliveryId) => {
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            // Set driver as available
            mockRedis._setMeta(driverId, { status: 'available' });

            // First reservation succeeds
            const first = await reserveDriver(driverId, existingDeliveryId, 60);
            expect(first.reserved).toBe(true);

            // Second reservation should be rejected
            const second = await reserveDriver(driverId, newDeliveryId, 60);
            expect(second.reserved).toBe(false);
            if (!second.reserved) {
              expect(second.reason).toBe('already_reserved');
            }

            // Original reservation unchanged
            expect(mockRedis._getReservation(driverId)).toBe(existingDeliveryId);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('succeeds only for available and unreserved drivers', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          deliveryIdArb,
          async (driverId, deliveryId) => {
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            // Set driver as available with no existing reservation
            mockRedis._setMeta(driverId, { status: 'available' });

            const result = await reserveDriver(driverId, deliveryId, 60);

            expect(result.reserved).toBe(true);
            expect(mockRedis._hasReservation(driverId)).toBe(true);
            expect(mockRedis._getReservation(driverId)).toBe(deliveryId);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * **Property 11: Single-Assignment Invariant**
   * Concurrent claims on same delivery → exactly one succeeds.
   *
   * **Validates: Requirements 6.1, 6.3, 7.1**
   */
  describe('Property 11: Single-Assignment Invariant', () => {
    it('exactly one driver succeeds when multiple claim the same delivery', async () => {
      const driverIdsArb = fc.array(fc.uuid(), { minLength: 2, maxLength: 10 });

      await fc.assert(
        fc.asyncProperty(
          driverIdsArb,
          deliveryIdArb,
          async (driverIds, deliveryId) => {
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            // All drivers attempt to claim the same delivery
            // Since Redis SET NX is atomic, sequential execution faithfully
            // simulates concurrent behavior (exactly what Redis does internally)
            const results = await Promise.all(
              driverIds.map((driverId) => claimDelivery(deliveryId, driverId, 300)),
            );

            // Exactly ONE should succeed
            const successes = results.filter((r) => r.claimed === true);
            expect(successes).toHaveLength(1);

            // All others should fail
            const failures = results.filter((r) => r.claimed === false);
            expect(failures).toHaveLength(driverIds.length - 1);

            // The claim key should hold the winning driver's ID
            const claimValue = mockRedis._getClaim(deliveryId);
            expect(claimValue).toBeDefined();
            // The winner is the first driver in the array (sequential execution)
            expect(claimValue).toBe(driverIds[0]);

            // All failures should report the correct claimer
            for (const failure of failures) {
              if (!failure.claimed) {
                expect(failure.claimedBy).toBe(driverIds[0]);
              }
            }
          },
        ),
        { numRuns: 50 },
      );
    });

    it('a single claim always succeeds when no competition exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          deliveryIdArb,
          async (driverId, deliveryId) => {
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            const result = await claimDelivery(deliveryId, driverId, 300);

            expect(result.claimed).toBe(true);
            expect(mockRedis._getClaim(deliveryId)).toBe(driverId);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('repeated claims by the same driver still only succeed once', async () => {
      await fc.assert(
        fc.asyncProperty(
          driverIdArb,
          deliveryIdArb,
          fc.integer({ min: 2, max: 5 }),
          async (driverId, deliveryId, repeatCount) => {
            mockRedis = createMockRedis();
            initReservation(mockRedis as unknown as Parameters<typeof initReservation>[0]);

            const results: Awaited<ReturnType<typeof claimDelivery>>[] = [];
            for (let i = 0; i < repeatCount; i++) {
              results.push(await claimDelivery(deliveryId, driverId, 300));
            }

            // First claim succeeds
            expect(results[0]!.claimed).toBe(true);

            // All subsequent claims fail (idempotent — no double-assignment)
            for (let i = 1; i < results.length; i++) {
              expect(results[i]!.claimed).toBe(false);
            }

            // Claim key holds the driver's ID
            expect(mockRedis._getClaim(deliveryId)).toBe(driverId);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
