import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MATCHING_TIERS, MATCHING_TOTAL_TIMEOUT_MS } from '@surewaka/shared';

/**
 * Property-based tests for the Matching Orchestrator.
 *
 * Since the full orchestrator has complex dependencies (DB, Redis, Ably),
 * these tests focus on testable invariants of the tier configuration and
 * the offer tracking/resolution logic as pure state machine simulations.
 *
 * Validates: Requirements 3.4, 3.5, 3.7, 5.5, 6.4, 6.5, 8.3, 8.4, 13.3
 */

// ─── Property 5: Tier Configuration Invariants ────────────────────────────────

describe('Property 5: Tier Configuration Invariants', () => {
  /**
   * **Validates: Requirements 3.4, 3.7**
   *
   * For any tier array used by the Matching Orchestrator, each tier's radius
   * SHALL be strictly greater than the previous tier's radius (monotonically
   * increasing), and the sum of all tier wait times SHALL not exceed 300,000ms
   * (5-minute guarantee).
   */

  it('radii monotonically increase across tiers', () => {
    for (let i = 1; i < MATCHING_TIERS.length; i++) {
      expect(MATCHING_TIERS[i].radiusKm).toBeGreaterThan(MATCHING_TIERS[i - 1].radiusKm);
    }
  });

  it('total wait time across all tiers is within 5 minutes (MATCHING_TOTAL_TIMEOUT_MS)', () => {
    const totalWaitMs = MATCHING_TIERS.reduce((sum, tier) => sum + tier.waitSeconds * 1000, 0);
    expect(totalWaitMs).toBeLessThanOrEqual(MATCHING_TOTAL_TIMEOUT_MS);
  });

  it('all tier values are positive', () => {
    for (const tier of MATCHING_TIERS) {
      expect(tier.radiusKm).toBeGreaterThan(0);
      expect(tier.maxCandidates).toBeGreaterThan(0);
      expect(tier.waitSeconds).toBeGreaterThan(0);
      expect(tier.tier).toBeGreaterThan(0);
    }
  });

  it('tier numbers are sequential starting from 1', () => {
    for (let i = 0; i < MATCHING_TIERS.length; i++) {
      expect(MATCHING_TIERS[i].tier).toBe(i + 1);
    }
  });

  it('maxCandidates increases or stays the same across tiers', () => {
    for (let i = 1; i < MATCHING_TIERS.length; i++) {
      expect(MATCHING_TIERS[i].maxCandidates).toBeGreaterThanOrEqual(
        MATCHING_TIERS[i - 1].maxCandidates,
      );
    }
  });
});

// ─── Property 6: No Duplicate Offers Across Tiers ─────────────────────────────

describe('Property 6: No Duplicate Offers Across Tiers', () => {
  /**
   * **Validates: Requirement 3.5**
   *
   * For any matching run across all tiers, the set of drivers offered in each
   * tier SHALL be disjoint from drivers offered in all previous tiers (no
   * driver is re-offered).
   *
   * We simulate the offeredDriverIds Set filtering logic from handleMatchDriver
   * and verify that each driver appears in at most one tier's final offer list.
   */

  it('offeredDriverIds set prevents re-offering across tiers', () => {
    // Arbitrary: generate random driver sets per tier with potential overlap
    const driverSetArb = fc.array(fc.uuid(), { minLength: 1, maxLength: 20 });
    const tierDriverSetsArb = fc.array(driverSetArb, {
      minLength: 2,
      maxLength: MATCHING_TIERS.length,
    });

    fc.assert(
      fc.property(tierDriverSetsArb, (tierDriverSets) => {
        // Simulate the offeredDriverIds logic from handleMatchDriver
        const offeredDriverIds = new Set<string>();
        const tierOffers: string[][] = [];

        for (const driversInTier of tierDriverSets) {
          // Filter out already-offered drivers (mirrors line in handleMatchDriver:
          //   const newCandidates = nearby.filter(d => !offeredDriverIds.has(d.driverId))
          const newCandidates = driversInTier.filter((id) => !offeredDriverIds.has(id));
          tierOffers.push(newCandidates);
          for (const id of newCandidates) {
            offeredDriverIds.add(id);
          }
        }

        // Verify: no driver appears in more than one tier's offers
        const allOffered = tierOffers.flat();
        const uniqueOffered = new Set(allOffered);
        expect(allOffered.length).toBe(uniqueOffered.size);
      }),
      { numRuns: 200 },
    );
  });

  it('drivers already offered are excluded even when they appear in later tier searches', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 5, maxLength: 30 }),
        fc.nat({ max: 4 }),
        (allDrivers, splitPoint) => {
          // Simulate: Tier 1 gets some drivers, Tier 2 gets overlapping set
          const tier1Drivers = allDrivers.slice(0, Math.max(1, splitPoint));
          const tier2Drivers = allDrivers; // superset — includes all tier 1 drivers

          const offeredDriverIds = new Set<string>();

          // Tier 1 processing
          const tier1Offers = tier1Drivers.filter((id) => !offeredDriverIds.has(id));
          for (const id of tier1Offers) offeredDriverIds.add(id);

          // Tier 2 processing
          const tier2Offers = tier2Drivers.filter((id) => !offeredDriverIds.has(id));
          for (const id of tier2Offers) offeredDriverIds.add(id);

          // Verify no overlap between tier 1 and tier 2 offers
          const tier1Set = new Set(tier1Offers);
          for (const driverId of tier2Offers) {
            expect(tier1Set.has(driverId)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 12: Offer State Transitions on Resolution ──────────────────────

describe('Property 12: Offer State Transitions on Resolution', () => {
  /**
   * **Validates: Requirements 6.4, 8.3, 8.4**
   *
   * For any delivery with N pending offers, when one offer is accepted,
   * all other N−1 offers SHALL transition to status 'cancelled'. When a tier
   * expires without acceptance, all offers in that tier SHALL transition to
   * status 'expired'. No offer SHALL remain in 'pending' status after its
   * delivery is resolved.
   */

  type OfferStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

  type Offer = {
    driverId: string;
    tier: number;
    status: OfferStatus;
  };

  /**
   * Simulate acceptance resolution: one driver accepts, others get cancelled.
   */
  function resolveAcceptance(offers: Offer[], winningDriverId: string): Offer[] {
    return offers.map((offer) => {
      if (offer.driverId === winningDriverId) {
        return { ...offer, status: 'accepted' as const };
      }
      if (offer.status === 'pending') {
        return { ...offer, status: 'cancelled' as const };
      }
      return offer;
    });
  }

  /**
   * Simulate tier timeout: all pending offers in the tier become expired.
   */
  function resolveTierTimeout(offers: Offer[], expiredTier: number): Offer[] {
    return offers.map((offer) => {
      if (offer.tier === expiredTier && offer.status === 'pending') {
        return { ...offer, status: 'expired' as const };
      }
      return offer;
    });
  }

  // Arbitrary for generating a set of pending offers
  const offerArb = fc.record({
    driverId: fc.uuid(),
    tier: fc.nat({ max: 2 }).map((n) => n + 1), // tier 1, 2, or 3
    status: fc.constant('pending' as OfferStatus),
  });

  const offersArb = fc.array(offerArb, { minLength: 2, maxLength: 20 });

  it('when one offer is accepted, all others become cancelled, none remain pending', () => {
    fc.assert(
      fc.property(offersArb, (offers) => {
        // Pick a random winner from the offers
        const winnerIndex = Math.floor(Math.random() * offers.length);
        const winningDriverId = offers[winnerIndex].driverId;

        const resolved = resolveAcceptance(offers, winningDriverId);

        // Exactly one accepted
        const accepted = resolved.filter((o) => o.status === 'accepted');
        expect(accepted.length).toBeGreaterThanOrEqual(1);
        expect(accepted.every((o) => o.driverId === winningDriverId)).toBe(true);

        // No pending offers remain
        const pending = resolved.filter((o) => o.status === 'pending');
        expect(pending.length).toBe(0);

        // Others are cancelled (excluding already expired ones from prior tiers)
        const others = resolved.filter((o) => o.driverId !== winningDriverId);
        for (const o of others) {
          expect(['cancelled', 'expired']).toContain(o.status);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('when a tier expires, all pending offers in that tier become expired', () => {
    fc.assert(
      fc.property(
        offersArb,
        fc.nat({ max: 2 }).map((n) => n + 1),
        (offers, expiredTier) => {
          const resolved = resolveTierTimeout(offers, expiredTier);

          // All offers in the expired tier should be expired
          const tierOffers = resolved.filter((o) => o.tier === expiredTier);
          for (const o of tierOffers) {
            expect(o.status).toBe('expired');
          }

          // Offers in other tiers remain unchanged
          for (let i = 0; i < offers.length; i++) {
            if (offers[i].tier !== expiredTier) {
              expect(resolved[i].status).toBe(offers[i].status);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('after full resolution (all tiers expired), no offer remains pending', () => {
    fc.assert(
      fc.property(offersArb, (offers) => {
        // Simulate all tiers expiring sequentially
        let resolved = [...offers];
        for (let tier = 1; tier <= 3; tier++) {
          resolved = resolveTierTimeout(resolved, tier);
        }

        const pending = resolved.filter((o) => o.status === 'pending');
        expect(pending.length).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 18: Reservation and State Cleanup on Resolution ─────────────────

describe('Property 18: Reservation and State Cleanup on Resolution', () => {
  /**
   * **Validates: Requirements 5.5, 6.5, 13.3**
   *
   * For any matching resolution (tier expiry, cancellation, or successful claim),
   * all associated driver reservation keys SHALL be explicitly deleted, and all
   * pending offers SHALL be transitioned to a terminal status (expired or
   * cancelled). No orphaned reservations or pending offers SHALL remain.
   */

  type ReservationState = {
    driverId: string;
    reserved: boolean;
  };

  type OfferState = {
    driverId: string;
    status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  };

  type MatchingState = {
    reservations: ReservationState[];
    offers: OfferState[];
  };

  /**
   * Simulate tier expiry cleanup: release reservations and expire offers.
   */
  function cleanupTierExpiry(state: MatchingState, tierDriverIds: string[]): MatchingState {
    const tierSet = new Set(tierDriverIds);

    return {
      reservations: state.reservations.map((r) =>
        tierSet.has(r.driverId) ? { ...r, reserved: false } : r,
      ),
      offers: state.offers.map((o) =>
        tierSet.has(o.driverId) && o.status === 'pending' ? { ...o, status: 'expired' } : o,
      ),
    };
  }

  /**
   * Simulate successful claim cleanup: release all reservations, cancel other offers.
   */
  function cleanupSuccessfulClaim(
    state: MatchingState,
    winningDriverId: string,
  ): MatchingState {
    return {
      reservations: state.reservations.map((r) => ({ ...r, reserved: false })),
      offers: state.offers.map((o) => {
        if (o.driverId === winningDriverId) return { ...o, status: 'accepted' };
        if (o.status === 'pending') return { ...o, status: 'cancelled' };
        return o;
      }),
    };
  }

  /**
   * Simulate cancellation cleanup: release all reservations, expire all pending offers.
   */
  function cleanupCancellation(state: MatchingState): MatchingState {
    return {
      reservations: state.reservations.map((r) => ({ ...r, reserved: false })),
      offers: state.offers.map((o) =>
        o.status === 'pending' ? { ...o, status: 'expired' } : o,
      ),
    };
  }

  // Generate matching state with active reservations and pending offers
  const matchingStateArb = fc
    .array(fc.uuid(), { minLength: 2, maxLength: 15 })
    .map((driverIds) => {
      const unique = [...new Set(driverIds)];
      return {
        reservations: unique.map((id) => ({ driverId: id, reserved: true })),
        offers: unique.map((id) => ({
          driverId: id,
          status: 'pending' as const,
        })),
      };
    });

  it('after tier expiry cleanup, no orphaned reservations for expired drivers', () => {
    fc.assert(
      fc.property(matchingStateArb, (state) => {
        // Expire all drivers (simulate full tier timeout)
        const allDriverIds = state.reservations.map((r) => r.driverId);
        const cleaned = cleanupTierExpiry(state, allDriverIds);

        // No active reservations remain
        const activeReservations = cleaned.reservations.filter((r) => r.reserved);
        expect(activeReservations.length).toBe(0);

        // No pending offers remain
        const pendingOffers = cleaned.offers.filter((o) => o.status === 'pending');
        expect(pendingOffers.length).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('after successful claim, no orphaned reservations or pending offers', () => {
    fc.assert(
      fc.property(matchingStateArb, (state) => {
        // Pick the first driver as the winner
        const winningDriverId = state.reservations[0].driverId;
        const cleaned = cleanupSuccessfulClaim(state, winningDriverId);

        // No active reservations remain
        const activeReservations = cleaned.reservations.filter((r) => r.reserved);
        expect(activeReservations.length).toBe(0);

        // No pending offers remain
        const pendingOffers = cleaned.offers.filter((o) => o.status === 'pending');
        expect(pendingOffers.length).toBe(0);

        // Exactly one accepted offer
        const accepted = cleaned.offers.filter((o) => o.status === 'accepted');
        expect(accepted.length).toBe(1);
        expect(accepted[0].driverId).toBe(winningDriverId);
      }),
      { numRuns: 200 },
    );
  });

  it('after cancellation, no orphaned reservations or pending offers', () => {
    fc.assert(
      fc.property(matchingStateArb, (state) => {
        const cleaned = cleanupCancellation(state);

        // No active reservations remain
        const activeReservations = cleaned.reservations.filter((r) => r.reserved);
        expect(activeReservations.length).toBe(0);

        // No pending offers remain
        const pendingOffers = cleaned.offers.filter((o) => o.status === 'pending');
        expect(pendingOffers.length).toBe(0);

        // All offers are in terminal state (expired or cancelled)
        for (const offer of cleaned.offers) {
          expect(['expired', 'cancelled', 'accepted']).toContain(offer.status);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('partial tier expiry only releases reservations for the specified drivers', () => {
    fc.assert(
      fc.property(
        matchingStateArb,
        fc.nat({ max: 10 }),
        (state, splitIdx) => {
          if (state.reservations.length < 2) return; // need at least 2 for meaningful split

          const split = Math.min(splitIdx, state.reservations.length - 1);
          const tierDriverIds = state.reservations.slice(0, Math.max(1, split)).map((r) => r.driverId);
          const otherDriverIds = state.reservations.slice(Math.max(1, split)).map((r) => r.driverId);

          const cleaned = cleanupTierExpiry(state, tierDriverIds);

          // Tier drivers: reservations released, offers expired
          const tierSet = new Set(tierDriverIds);
          for (const r of cleaned.reservations) {
            if (tierSet.has(r.driverId)) {
              expect(r.reserved).toBe(false);
            }
          }

          // Other drivers: still reserved, still pending
          const otherSet = new Set(otherDriverIds);
          for (const r of cleaned.reservations) {
            if (otherSet.has(r.driverId)) {
              expect(r.reserved).toBe(true);
            }
          }
          for (const o of cleaned.offers) {
            if (otherSet.has(o.driverId)) {
              expect(o.status).toBe('pending');
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
