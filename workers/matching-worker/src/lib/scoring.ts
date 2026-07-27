import type { DriverCandidate, ScoredDriver, ScoringWeights } from '@surewaka/shared';
import { DEFAULT_SCORING_WEIGHTS } from '@surewaka/shared';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_SCORE = 100;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const SIXTY_MINUTES_MS = 60 * 60 * 1000;

// ─── scoreDrivers ─────────────────────────────────────────────────────────────

/**
 * Compute a composite score for each driver candidate and return the list
 * sorted descending by score.
 *
 * This is a **pure function** — deterministic, no side effects, no async.
 * Same inputs always produce identical output.
 *
 * Formula (base = 100):
 *   + distancePerKm × distanceKm          (default: −10/km)
 *   + acceptanceRate × rate                (default: +20 × rate)
 *   + completionRate × rate                (default: +15 × rate)
 *   + highRatingBonus if rating ≥ 4.5      (default: +10)
 *   + lowRatingPenalty if rating < 4.0     (default: −15)
 *   + idleBonus30min if idle > 30min       (default: +10)
 *   + idleBonus60min if idle > 60min       (default: +5, stacks with 30min)
 *   + headingBonus if heading toward pickup (default: +8)
 *
 * All scores are floored at 0.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 14.3
 *
 * @param candidates - Array of driver candidates to score
 * @param weights - Optional partial overrides for scoring weights
 * @param now - Optional timestamp for idle calculation (defaults to Date.now(), exposed for deterministic testing)
 * @returns Scored drivers sorted descending by score
 */
export function scoreDrivers(
  candidates: DriverCandidate[],
  weights?: Partial<ScoringWeights>,
  now?: number,
): ScoredDriver[] {
  const w: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, ...weights };
  const currentTime = now ?? Date.now();

  const scored = candidates.map((candidate) => {
    let score = BASE_SCORE;

    // Distance penalty: closer is better
    score += w.distancePerKm * candidate.distanceKm;

    // Acceptance rate bonus
    score += w.acceptanceRate * candidate.acceptanceRate;

    // Completion rate bonus
    score += w.completionRate * candidate.completionRate;

    // Rating bonus/penalty
    if (candidate.rating >= 4.5) {
      score += w.highRatingBonus;
    } else if (candidate.rating < 4.0) {
      score += w.lowRatingPenalty; // negative value
    }

    // Idle time bonus (stacks: >60min gets BOTH 30min and 60min bonuses)
    const idleMs = currentTime - candidate.lastJobCompletedAt;
    if (idleMs > SIXTY_MINUTES_MS) {
      score += w.idleBonus30min + w.idleBonus60min;
    } else if (idleMs > THIRTY_MINUTES_MS) {
      score += w.idleBonus30min;
    }

    // Heading bonus
    if (candidate.headingTowardPickup) {
      score += w.headingBonus;
    }

    // Floor at 0
    score = Math.max(0, score);

    return { ...candidate, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
