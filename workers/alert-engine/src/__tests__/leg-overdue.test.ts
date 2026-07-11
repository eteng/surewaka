import { describe, it, expect, vi } from 'vitest';

// leg-overdue uses db.execute (raw SQL) — simpler mock, avoids @surewaka/db init
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
const minsFromNow = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();

describe('evaluateLegOverdue', () => {
  it('returns no results when DB returns no active legs', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    const { evaluate } = await import('../rules/leg-overdue');
    const results = await evaluate(mockSettings);
    expect(results).toHaveLength(0);
  });

  it('returns info when ETA is still in the future', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          leg_id: 'leg-1',
          delivery_id: 'del-1',
          driver_eta_at: minsFromNow(10),
          system_eta_at: null,
          zone: 'Lekki',
          actor_type: 'driver',
        },
      ],
    });
    const { evaluate } = await import('../rules/leg-overdue');
    const results = await evaluate(mockSettings);
    expect(results[0]?.shouldFire).toBe(false);
    expect(results[0]?.severity).toBe('info');
  });

  it('returns warning when overdue by 35 minutes (above warning threshold)', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          leg_id: 'leg-1',
          delivery_id: 'del-1',
          driver_eta_at: minsAgo(35),
          system_eta_at: null,
          zone: 'Ikeja',
          actor_type: 'driver',
        },
      ],
    });
    const { evaluate } = await import('../rules/leg-overdue');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('warning');
    expect(results[0]?.shouldFire).toBe(true);
  });

  it('returns critical when overdue by 65 minutes (above critical threshold)', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          leg_id: 'leg-1',
          delivery_id: 'del-1',
          driver_eta_at: null,
          system_eta_at: minsAgo(65),
          zone: 'VI',
          actor_type: 'carrier',
        },
      ],
    });
    const { evaluate } = await import('../rules/leg-overdue');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('critical');
    expect(results[0]?.shouldFire).toBe(true);
  });

  describe('zone resolution via JOIN', () => {
    it('includes zone name in context when dropoff_zone_id points to an active zone', async () => {
      const { db } = await import('../db');
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            leg_id: 'leg-1',
            delivery_id: 'del-1',
            driver_eta_at: minsAgo(35),
            system_eta_at: null,
            zone: 'Surulere',
            actor_type: 'driver',
          },
        ],
      });
      const { evaluate } = await import('../rules/leg-overdue');
      const results = await evaluate(mockSettings);
      expect(results[0]?.context.zone).toBe('Surulere');
    });

    it('includes zone name in context when dropoff_zone_id points to an inactive zone', async () => {
      // LEFT JOIN doesn't filter by is_active — inactive zones still resolve
      const { db } = await import('../db');
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            leg_id: 'leg-2',
            delivery_id: 'del-2',
            driver_eta_at: minsAgo(40),
            system_eta_at: null,
            zone: 'Decommissioned Zone',
            actor_type: 'driver',
          },
        ],
      });
      const { evaluate } = await import('../rules/leg-overdue');
      const results = await evaluate(mockSettings);
      expect(results[0]?.context.zone).toBe('Decommissioned Zone');
    });

    it('omits zone key from context when dropoff_zone_id is null', async () => {
      // When dropoff_zone_id is null, LEFT JOIN produces null for z.name
      const { db } = await import('../db');
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [
          {
            leg_id: 'leg-3',
            delivery_id: 'del-3',
            driver_eta_at: minsAgo(35),
            system_eta_at: null,
            zone: null,
            actor_type: 'driver',
          },
        ],
      });
      const { evaluate } = await import('../rules/leg-overdue');
      const results = await evaluate(mockSettings);
      expect(results[0]?.shouldFire).toBe(true);
      expect(results[0]?.context).not.toHaveProperty('zone');
    });
  });
});
