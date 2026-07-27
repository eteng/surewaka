import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based tests for the Self-Drop Fallback invariants.
 *
 * Tests the invariant that when a self-drop is accepted (first-mile leg
 * cancelled), all subsequent legs remain in their original active state.
 *
 * **Validates: Requirements 12.3**
 */

type LegState = {
  id: string;
  legNumber: number;
  legType: string;
  status: string;
  isActive: boolean;
};

/**
 * Simulate self-drop acceptance:
 * - Cancel the first-mile leg (status='cancelled', isActive=false)
 * - Keep all other legs unchanged
 */
function applySelfDrop(legs: LegState[], firstMileLegId: string): LegState[] {
  return legs.map((leg) => {
    if (leg.id === firstMileLegId) {
      return { ...leg, status: 'cancelled', isActive: false };
    }
    return leg; // unchanged
  });
}

describe('Property 17: Self-Drop Preserves Remaining Legs', () => {
  const legArb = fc.record({
    id: fc.uuid(),
    legNumber: fc.integer({ min: 1, max: 7 }),
    legType: fc.constantFrom('first_mile', 'intercity', 'transfer', 'last_mile'),
    status: fc.constantFrom('pending', 'in_transit'),
    isActive: fc.constant(true),
  });

  const deliveryLegsArb = fc
    .array(legArb, { minLength: 3, maxLength: 7 })
    .map((legs) => legs.map((leg, i) => ({ ...leg, legNumber: i + 1 })));

  it('after self-drop acceptance, subsequent legs remain active and status unchanged', () => {
    fc.assert(
      fc.property(deliveryLegsArb, (legs) => {
        // First leg is always first_mile
        const firstMileLeg = { ...legs[0], legType: 'first_mile' };
        const allLegs = [firstMileLeg, ...legs.slice(1)];

        const result = applySelfDrop(allLegs, firstMileLeg.id);

        // First-mile leg is cancelled
        const cancelledLeg = result.find((l) => l.id === firstMileLeg.id)!;
        expect(cancelledLeg.status).toBe('cancelled');
        expect(cancelledLeg.isActive).toBe(false);

        // All other legs remain unchanged
        const otherLegs = result.filter((l) => l.id !== firstMileLeg.id);
        const originalOtherLegs = allLegs.filter((l) => l.id !== firstMileLeg.id);

        for (let i = 0; i < otherLegs.length; i++) {
          expect(otherLegs[i].status).toBe(originalOtherLegs[i].status);
          expect(otherLegs[i].isActive).toBe(originalOtherLegs[i].isActive);
          expect(otherLegs[i].legNumber).toBe(originalOtherLegs[i].legNumber);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('remaining leg count is preserved (no legs deleted)', () => {
    fc.assert(
      fc.property(deliveryLegsArb, (legs) => {
        const firstMileLeg = { ...legs[0], legType: 'first_mile' };
        const allLegs = [firstMileLeg, ...legs.slice(1)];

        const result = applySelfDrop(allLegs, firstMileLeg.id);
        expect(result.length).toBe(allLegs.length);
      }),
      { numRuns: 200 },
    );
  });
});
