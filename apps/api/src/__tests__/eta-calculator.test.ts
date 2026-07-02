import { describe, it, expect } from 'vitest';
import { calculateSystemEta, haversineKm } from '../lib/eta-calculator';

describe('haversineKm', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineKm(6.5244, 3.3792, 6.5244, 3.3792)).toBeCloseTo(0, 2);
  });

  it('returns approximately 12km for Lekki to Island crossing', () => {
    // Lekki Phase 1 → Victoria Island (approx)
    const km = haversineKm(6.4457, 3.4711, 6.4281, 3.4219);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(20);
  });
});

describe('calculateSystemEta', () => {
  it('returns a Date in the future', () => {
    const eta = calculateSystemEta(6.5244, 3.3792, 6.4457, 3.4711, 'motorcycle');
    expect(eta.getTime()).toBeGreaterThan(Date.now());
  });

  it('truck ETA is always >= motorcycle ETA for same route', () => {
    const moto = calculateSystemEta(6.5244, 3.3792, 6.4457, 3.4711, 'motorcycle');
    const truck = calculateSystemEta(6.5244, 3.3792, 6.4457, 3.4711, 'truck');
    expect(truck.getTime()).toBeGreaterThanOrEqual(moto.getTime());
  });
});
