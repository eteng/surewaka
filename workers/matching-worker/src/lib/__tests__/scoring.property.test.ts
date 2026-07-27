import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { DriverCandidate } from '@surewaka/shared';
import { scoreDrivers } from '../scoring';

/**
 * Property-based tests for the Scoring Engine.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

// Fixed "now" for deterministic idle-time calculations within property runs
const NOW = Date.now();

// Arbitrary for a single valid DriverCandidate
const driverCandidateArb = fc.record({
  driverId: fc.uuid(),
  distanceKm: fc.double({ min: 0, max: 50, noNaN: true }),
  acceptanceRate: fc.double({ min: 0, max: 1, noNaN: true }),
  completionRate: fc.double({ min: 0, max: 1, noNaN: true }),
  rating: fc.double({ min: 1, max: 5, noNaN: true }),
  lastJobCompletedAt: fc.integer({ min: 0, max: NOW }),
  headingTowardPickup: fc.boolean(),
});

// Arbitrary for an array of 1-50 valid DriverCandidates
const driverCandidatesArb = fc.array(driverCandidateArb, { minLength: 1, maxLength: 50 });

describe('Scoring Engine — Property Tests', () => {
  /**
   * **Validates: Requirements 4.1, 4.3**
   *
   * Property 7: Score Computation Correctness
   * For any valid DriverCandidate, the computed score must be ≥ 0.
   * The scoring formula floors all results at 0 via Math.max(0, score).
   */
  describe('Property 7: Score Computation Correctness', () => {
    it('valid inputs always produce score ≥ 0', () => {
      fc.assert(
        fc.property(driverCandidatesArb, (candidates) => {
          const results = scoreDrivers(candidates, undefined, NOW);

          for (const result of results) {
            expect(result.score).toBeGreaterThanOrEqual(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 4.2, 4.4**
   *
   * Property 8: Score Output Invariants
   * For any array of valid DriverCandidates:
   * - Output length === input length
   * - Output is sorted descending by score
   */
  describe('Property 8: Score Output Invariants', () => {
    it('output length equals input length', () => {
      fc.assert(
        fc.property(driverCandidatesArb, (candidates) => {
          const results = scoreDrivers(candidates, undefined, NOW);
          expect(results).toHaveLength(candidates.length);
        }),
        { numRuns: 100 },
      );
    });

    it('output is sorted descending by score', () => {
      fc.assert(
        fc.property(driverCandidatesArb, (candidates) => {
          const results = scoreDrivers(candidates, undefined, NOW);

          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * Property 9: Score Determinism
   * For any array of valid DriverCandidates:
   * - Calling scoreDrivers twice with the same inputs produces identical output
   * - Order of elements in output is the same
   * - Scores are exactly equal (no floating point drift between calls)
   */
  describe('Property 9: Score Determinism', () => {
    it('identical inputs produce identical output across invocations', () => {
      fc.assert(
        fc.property(driverCandidatesArb, (candidates) => {
          const result1 = scoreDrivers(candidates, undefined, NOW);
          const result2 = scoreDrivers(candidates, undefined, NOW);

          expect(result1).toHaveLength(result2.length);

          for (let i = 0; i < result1.length; i++) {
            expect(result1[i].driverId).toBe(result2[i].driverId);
            expect(result1[i].score).toBe(result2[i].score);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
