import { describe, it, expect, vi } from 'vitest';

// driver-silent uses db.execute for simpler mocking
vi.mock('../db', () => ({ db: { execute: vi.fn() } }));

const mockSettings = {
  driverSilentWarningMin: 15,
  driverSilentCriticalMin: 30,
  legOverdueWarningMin: 30,
  legOverdueCriticalMin: 60,
  customerUpdateGapWarningMin: 45,
  customerUpdateGapCriticalMin: 90,
  ontimeRateWarningPct: 80,
  ontimeRateCriticalPct: 60,
  pumbleWebhookUrl: null,
  pushEnabled: true,
  pumbleEnabled: false,
};

const now = new Date();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe('evaluateDriverSilent', () => {
  it('returns no results when DB returns no active legs', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    const { evaluate } = await import('../rules/driver-silent');
    const results = await evaluate(mockSettings);
    expect(results).toHaveLength(0);
  });

  it('returns warning when last ping was 20 minutes ago', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          leg_id: 'leg-1',
          delivery_id: 'del-1',
          driver_name: 'Emeka N.',
          zone: 'Lekki',
          last_ping: minsAgo(20),
        },
      ],
    });
    const { evaluate } = await import('../rules/driver-silent');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('warning');
    expect(results[0]?.shouldFire).toBe(true);
  });

  it('returns critical when last ping was 35 minutes ago', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          leg_id: 'leg-1',
          delivery_id: 'del-1',
          driver_name: 'Emeka N.',
          zone: 'Lekki',
          last_ping: minsAgo(35),
        },
      ],
    });
    const { evaluate } = await import('../rules/driver-silent');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('critical');
  });

  describe('zone resolution via JOIN', () => {
    it('includes zone name in context when dropoff_zone_id points to an active zone', async () => {
      const { db } = await import('../db');
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            leg_id: 'leg-1',
            delivery_id: 'del-1',
            driver_name: 'Chidi O.',
            zone: 'Lekki',
            last_ping: minsAgo(20),
          },
        ],
      });
      const { evaluate } = await import('../rules/driver-silent');
      const results = await evaluate(mockSettings);
      expect(results[0]?.context.zone).toBe('Lekki');
    });

    it('includes zone name in context when dropoff_zone_id points to an inactive zone', async () => {
      // LEFT JOIN doesn't filter by is_active — inactive zones still resolve
      const { db } = await import('../db');
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            leg_id: 'leg-2',
            delivery_id: 'del-2',
            driver_name: 'Ada K.',
            zone: 'Old Deactivated Zone',
            last_ping: minsAgo(20),
          },
        ],
      });
      const { evaluate } = await import('../rules/driver-silent');
      const results = await evaluate(mockSettings);
      expect(results[0]?.context.zone).toBe('Old Deactivated Zone');
    });

    it('omits zone key from context when dropoff_zone_id is null', async () => {
      // When dropoff_zone_id is null, LEFT JOIN produces null for z.name
      const { db } = await import('../db');
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            leg_id: 'leg-3',
            delivery_id: 'del-3',
            driver_name: 'Bola T.',
            zone: null,
            last_ping: minsAgo(20),
          },
        ],
      });
      const { evaluate } = await import('../rules/driver-silent');
      const results = await evaluate(mockSettings);
      expect(results[0]?.shouldFire).toBe(true);
      expect(results[0]?.context).not.toHaveProperty('zone');
    });
  });
});
