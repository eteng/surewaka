import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: { execute: vi.fn().mockResolvedValue([]) },
}));

import { periodToDates } from '../analytics-service';

describe('periodToDates', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
  });

  it('today: start is midnight, end is now', () => {
    const { start, end } = periodToDates('today');
    expect(start.toISOString()).toBe('2026-07-03T00:00:00.000Z');
    expect(end.getTime()).toBeGreaterThanOrEqual(new Date('2026-07-03T12:00:00Z').getTime());
  });

  it('week: start is 7 days ago', () => {
    const { start } = periodToDates('week');
    expect(start.toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });

  it('month: start is 30 days ago', () => {
    const { start } = periodToDates('month');
    expect(start.toISOString()).toBe('2026-06-03T00:00:00.000Z');
  });

  it('custom: parses from/to strings', () => {
    const { start, end } = periodToDates('custom', '2026-06-01', '2026-06-30');
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('custom without dates falls back to week', () => {
    const { start } = periodToDates('custom');
    expect(start.toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });
});
