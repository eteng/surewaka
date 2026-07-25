import { describe, it, expect } from 'vitest';
import { haversineKm } from '../haversine';

describe('haversineKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineKm(6.5, 3.4, 6.5, 3.4)).toBe(0);
  });

  it('computes distance between Lagos Mainland and Lagos Island (~8-12km)', () => {
    // Yaba (mainland) → Victoria Island
    const km = haversineKm(6.5095, 3.3711, 6.4281, 3.4219);
    expect(km).toBeGreaterThan(7);
    expect(km).toBeLessThan(15);
  });

  it('computes distance between Lagos and Abuja (~500-600km straight-line)', () => {
    // Lagos (6.52, 3.38) → Abuja (9.06, 7.49)
    const km = haversineKm(6.52, 3.38, 9.06, 7.49);
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(650);
  });

  it('is symmetric — A→B equals B→A', () => {
    const ab = haversineKm(6.5, 3.4, 9.0, 7.5);
    const ba = haversineKm(9.0, 7.5, 6.5, 3.4);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('handles negative coordinates (southern/western hemisphere)', () => {
    // Sao Paulo → Lagos (cross-Atlantic)
    const km = haversineKm(-23.55, -46.63, 6.52, 3.38);
    expect(km).toBeGreaterThan(5000);
    expect(km).toBeLessThan(7000);
  });
});
