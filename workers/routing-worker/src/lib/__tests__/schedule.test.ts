import { describe, it, expect } from 'vitest';
import { nextDeparture, type DepartureSlot } from '../schedule';

// WAT = UTC+1. A 6:00 WAT departure = 05:00 UTC.
// notBefore is constructed as a UTC Date; returned Date's UTC hours are verified.

describe('nextDeparture', () => {
  it('returns null when slots array is empty', () => {
    const notBefore = new Date('2026-07-22T08:00:00Z'); // 09:00 WAT
    expect(nextDeparture([], notBefore)).toBeNull();
  });

  it('slot later today — returns today at that WAT hour (UTC = WAT - 1)', () => {
    // notBefore = 09:00 WAT (08:00 UTC), slot = 14:00 WAT → should return today at 13:00 UTC
    const notBefore = new Date('2026-07-22T08:00:00Z'); // 09:00 WAT Tuesday
    const slots: DepartureSlot[] = [{ hour: 14, minute: 0, daysOfWeek: [] }];

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // 14:00 WAT = 13:00 UTC on the same date
    expect(result!.toISOString()).toBe('2026-07-22T13:00:00.000Z');
  });

  it('slot at exact notBefore minute is skipped (exclusive lower bound)', () => {
    // notBefore = 14:00 WAT (13:00 UTC), slot = 14:00 WAT → that slot is skipped (<=)
    const notBefore = new Date('2026-07-22T13:00:00Z'); // 14:00 WAT
    const slots: DepartureSlot[] = [
      { hour: 14, minute: 0, daysOfWeek: [] },
      { hour: 16, minute: 0, daysOfWeek: [] },
    ];

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // 14:00 slot is skipped, next is 16:00 WAT = 15:00 UTC
    expect(result!.toISOString()).toBe('2026-07-22T15:00:00.000Z');
  });

  it('slot earlier today — returns tomorrow at that slot', () => {
    // notBefore = 15:00 WAT (14:00 UTC), slot = 06:00 WAT → should return tomorrow at 05:00 UTC
    const notBefore = new Date('2026-07-22T14:00:00Z'); // 15:00 WAT Tuesday
    const slots: DepartureSlot[] = [{ hour: 6, minute: 0, daysOfWeek: [] }];

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // 06:00 WAT tomorrow (Wednesday 2026-07-23) = 05:00 UTC on 2026-07-23
    expect(result!.toISOString()).toBe('2026-07-23T05:00:00.000Z');
  });

  it('day-of-week filter excludes today, advances to next matching day', () => {
    // 2026-07-22 is a Wednesday (ISO weekday 3)
    // notBefore = 09:00 WAT (08:00 UTC) on Wednesday
    // slot = 06:00 WAT, Fridays only (ISO 5) → should skip Wednesday + Thursday, return Friday
    const notBefore = new Date('2026-07-22T08:00:00Z'); // Wednesday 09:00 WAT
    const slots: DepartureSlot[] = [{ hour: 6, minute: 0, daysOfWeek: [5] }]; // Fridays only

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // Next Friday = 2026-07-24, 06:00 WAT = 05:00 UTC
    expect(result!.toISOString()).toBe('2026-07-24T05:00:00.000Z');
  });

  it('handles multiple day-of-week values, picks nearest matching day', () => {
    // 2026-07-22 is Wednesday (ISO 3)
    // notBefore = 09:00 WAT, slot 06:00 WAT on Mon+Fri
    // Today (Wed) doesn't match; nearest is Friday
    const notBefore = new Date('2026-07-22T08:00:00Z'); // Wednesday
    const slots: DepartureSlot[] = [{ hour: 6, minute: 0, daysOfWeek: [1, 5] }]; // Mon + Fri

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // Friday 2026-07-24, 06:00 WAT = 05:00 UTC
    expect(result!.toISOString()).toBe('2026-07-24T05:00:00.000Z');
  });

  it('returns slot with correct minutes', () => {
    // notBefore = 09:00 WAT (08:00 UTC), slot = 14:30 WAT
    const notBefore = new Date('2026-07-22T08:00:00Z');
    const slots: DepartureSlot[] = [{ hour: 14, minute: 30, daysOfWeek: [] }];

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // 14:30 WAT = 13:30 UTC
    expect(result!.toISOString()).toBe('2026-07-22T13:30:00.000Z');
  });

  it('picks the first slot that qualifies (in slot order) when multiple slots today', () => {
    // notBefore = 07:00 WAT (06:00 UTC)
    // slots: 06:00 WAT (already passed), 10:00 WAT (future), 14:00 WAT (future)
    const notBefore = new Date('2026-07-22T06:00:00Z'); // 07:00 WAT
    const slots: DepartureSlot[] = [
      { hour: 6, minute: 0, daysOfWeek: [] },  // passed
      { hour: 10, minute: 0, daysOfWeek: [] }, // future → picked first
      { hour: 14, minute: 0, daysOfWeek: [] },
    ];

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // 10:00 WAT = 09:00 UTC
    expect(result!.toISOString()).toBe('2026-07-22T09:00:00.000Z');
  });

  it('handles midnight WAT slot correctly', () => {
    // notBefore = 23:30 WAT (22:30 UTC) on 2026-07-22
    // slot = 00:00 WAT on every day → next day 00:00 WAT = 23:00 UTC on 2026-07-22
    const notBefore = new Date('2026-07-22T22:30:00Z'); // 23:30 WAT
    const slots: DepartureSlot[] = [{ hour: 0, minute: 0, daysOfWeek: [] }];

    const result = nextDeparture(slots, notBefore);
    expect(result).not.toBeNull();
    // 00:00 WAT on 2026-07-23 = 23:00 UTC on 2026-07-22
    expect(result!.toISOString()).toBe('2026-07-22T23:00:00.000Z');
  });
});
