import { describe, it, expect } from 'vitest';
import type { DriverCandidate } from '@surewaka/shared';
import { scoreDrivers } from '../scoring';

// Fixed "now" for deterministic idle-time calculations
const NOW = Date.now();
const THIRTY_ONE_MIN_AGO = NOW - 31 * 60 * 1000;
const SIXTY_ONE_MIN_AGO = NOW - 61 * 60 * 1000;
const FIVE_MIN_AGO = NOW - 5 * 60 * 1000;

function makeCandidate(overrides: Partial<DriverCandidate> = {}): DriverCandidate {
  return {
    driverId: 'driver-1',
    distanceKm: 2,
    acceptanceRate: 0.8,
    completionRate: 0.9,
    rating: 4.6,
    lastJobCompletedAt: FIVE_MIN_AGO,
    headingTowardPickup: false,
    ...overrides,
  };
}

describe('scoreDrivers', () => {
  describe('basic scoring formula', () => {
    it('computes correct score for a typical candidate', () => {
      const candidate = makeCandidate({
        distanceKm: 2,
        acceptanceRate: 0.8,
        completionRate: 0.9,
        rating: 4.6,
        lastJobCompletedAt: FIVE_MIN_AGO, // <30min idle
        headingTowardPickup: false,
      });

      const [result] = scoreDrivers([candidate], undefined, NOW);

      // base 100 + (-10×2) + (20×0.8) + (15×0.9) + 10 (rating≥4.5) + 0 (idle<30m) + 0 (not heading)
      // = 100 - 20 + 16 + 13.5 + 10 + 0 + 0 = 119.5
      expect(result.score).toBeCloseTo(119.5);
    });

    it('applies distance penalty correctly', () => {
      const near = makeCandidate({ driverId: 'near', distanceKm: 1 });
      const far = makeCandidate({ driverId: 'far', distanceKm: 8 });

      const results = scoreDrivers([far, near], undefined, NOW);

      // Near driver should score higher
      expect(results[0].driverId).toBe('near');
      expect(results[1].driverId).toBe('far');
    });

    it('applies acceptance rate bonus', () => {
      const high = makeCandidate({ driverId: 'high', acceptanceRate: 1.0 });
      const low = makeCandidate({ driverId: 'low', acceptanceRate: 0.2 });

      const results = scoreDrivers([low, high], undefined, NOW);
      expect(results[0].driverId).toBe('high');
    });

    it('applies completion rate bonus', () => {
      const high = makeCandidate({ driverId: 'high', completionRate: 1.0 });
      const low = makeCandidate({ driverId: 'low', completionRate: 0.2 });

      const results = scoreDrivers([low, high], undefined, NOW);
      expect(results[0].driverId).toBe('high');
    });
  });

  describe('rating bonus/penalty', () => {
    it('gives +10 bonus for rating >= 4.5', () => {
      const high = makeCandidate({ driverId: 'high', rating: 4.5 });
      const mid = makeCandidate({ driverId: 'mid', rating: 4.2 });

      const [highResult] = scoreDrivers([high], undefined, NOW);
      const [midResult] = scoreDrivers([mid], undefined, NOW);

      // Difference should be highRatingBonus (10), since mid gets 0 (4.0 <= rating < 4.5)
      expect(highResult.score - midResult.score).toBeCloseTo(10);
    });

    it('gives -15 penalty for rating < 4.0', () => {
      const mid = makeCandidate({ driverId: 'mid', rating: 4.0 });
      const low = makeCandidate({ driverId: 'low', rating: 3.9 });

      const [midResult] = scoreDrivers([mid], undefined, NOW);
      const [lowResult] = scoreDrivers([low], undefined, NOW);

      // mid gets 0 bonus, low gets -15 penalty → difference is 15
      expect(midResult.score - lowResult.score).toBeCloseTo(15);
    });
  });

  describe('idle time bonus', () => {
    it('gives +10 for idle > 30 minutes', () => {
      const idle = makeCandidate({ driverId: 'idle', lastJobCompletedAt: THIRTY_ONE_MIN_AGO });
      const recent = makeCandidate({ driverId: 'recent', lastJobCompletedAt: FIVE_MIN_AGO });

      const results = scoreDrivers([recent, idle], undefined, NOW);
      const idleResult = results.find((r) => r.driverId === 'idle')!;
      const recentResult = results.find((r) => r.driverId === 'recent')!;

      expect(idleResult.score - recentResult.score).toBeCloseTo(10);
    });

    it('gives +15 (stacked: +10 + +5) for idle > 60 minutes', () => {
      const veryIdle = makeCandidate({ driverId: 'very-idle', lastJobCompletedAt: SIXTY_ONE_MIN_AGO });
      const recent = makeCandidate({ driverId: 'recent', lastJobCompletedAt: FIVE_MIN_AGO });

      const results = scoreDrivers([recent, veryIdle], undefined, NOW);
      const veryIdleResult = results.find((r) => r.driverId === 'very-idle')!;
      const recentResult = results.find((r) => r.driverId === 'recent')!;

      expect(veryIdleResult.score - recentResult.score).toBeCloseTo(15);
    });
  });

  describe('heading bonus', () => {
    it('gives +8 for heading toward pickup', () => {
      const heading = makeCandidate({ driverId: 'heading', headingTowardPickup: true });
      const notHeading = makeCandidate({ driverId: 'not', headingTowardPickup: false });

      const results = scoreDrivers([notHeading, heading], undefined, NOW);
      const headingResult = results.find((r) => r.driverId === 'heading')!;
      const notResult = results.find((r) => r.driverId === 'not')!;

      expect(headingResult.score - notResult.score).toBeCloseTo(8);
    });
  });

  describe('score floor', () => {
    it('floors scores at 0 (never negative)', () => {
      // Very far driver should have negative raw score but floors at 0
      const farAway = makeCandidate({
        distanceKm: 50, // -500 from distance alone
        acceptanceRate: 0,
        completionRate: 0,
        rating: 3.0, // -15 penalty
        headingTowardPickup: false,
      });

      const [result] = scoreDrivers([farAway], undefined, NOW);
      expect(result.score).toBe(0);
    });
  });

  describe('sorting', () => {
    it('returns results sorted descending by score', () => {
      const candidates: DriverCandidate[] = [
        makeCandidate({ driverId: 'far', distanceKm: 10 }),
        makeCandidate({ driverId: 'near', distanceKm: 1 }),
        makeCandidate({ driverId: 'mid', distanceKm: 5 }),
      ];

      const results = scoreDrivers(candidates, undefined, NOW);

      expect(results[0].driverId).toBe('near');
      expect(results[1].driverId).toBe('mid');
      expect(results[2].driverId).toBe('far');

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('output invariants', () => {
    it('returns array with same length as input', () => {
      const candidates = [
        makeCandidate({ driverId: '1' }),
        makeCandidate({ driverId: '2' }),
        makeCandidate({ driverId: '3' }),
      ];

      const results = scoreDrivers(candidates, undefined, NOW);
      expect(results).toHaveLength(candidates.length);
    });

    it('returns empty array for empty input', () => {
      const results = scoreDrivers([], undefined, NOW);
      expect(results).toEqual([]);
    });

    it('is deterministic — same inputs produce same output', () => {
      const candidates = [
        makeCandidate({ driverId: '1', distanceKm: 3 }),
        makeCandidate({ driverId: '2', distanceKm: 1 }),
        makeCandidate({ driverId: '3', distanceKm: 5 }),
      ];

      const result1 = scoreDrivers(candidates, undefined, NOW);
      const result2 = scoreDrivers(candidates, undefined, NOW);

      expect(result1).toEqual(result2);
    });
  });

  describe('custom weights', () => {
    it('accepts partial weight overrides', () => {
      const candidate = makeCandidate({ distanceKm: 5 });

      const defaultResult = scoreDrivers([candidate], undefined, NOW);
      const customResult = scoreDrivers([candidate], { distancePerKm: -5 }, NOW);

      // With -5/km instead of -10/km at 5km distance, score should be 25 points higher
      expect(customResult[0].score - defaultResult[0].score).toBeCloseTo(25);
    });

    it('merges partial weights with defaults', () => {
      const candidate = makeCandidate({ distanceKm: 2, headingTowardPickup: true });

      // Only override headingBonus, all others should use defaults
      const result = scoreDrivers([candidate], { headingBonus: 20 }, NOW);

      // base 100 + (-10×2) + (20×0.8) + (15×0.9) + 10 (rating≥4.5) + 0 (idle<30m) + 20 (heading)
      // = 100 - 20 + 16 + 13.5 + 10 + 0 + 20 = 139.5
      expect(result[0].score).toBeCloseTo(139.5);
    });
  });
});
