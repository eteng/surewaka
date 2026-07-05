import { describe, it, expect, vi } from 'vitest';

// customer-update-gap uses db.execute (raw SQL with dynamic status list)
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

describe('evaluateCustomerUpdateGap', () => {
  it('returns no results when DB returns no rows', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    const { evaluate } = await import('../rules/customer-update-gap');
    const results = await evaluate(mockSettings);
    expect(results).toHaveLength(0);
  });

  it('returns warning when update gap is 50 minutes (above warning, below critical)', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          delivery_id: 'del-1',
          customer_name: 'Ngozi O.',
          minutes_since_update: 50,
        },
      ],
    });
    const { evaluate } = await import('../rules/customer-update-gap');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('warning');
    expect(results[0]?.shouldFire).toBe(true);
  });

  it('returns critical when update gap is 95 minutes (above critical threshold)', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          delivery_id: 'del-1',
          customer_name: 'Ngozi O.',
          minutes_since_update: 95,
        },
      ],
    });
    const { evaluate } = await import('../rules/customer-update-gap');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('critical');
    expect(results[0]?.shouldFire).toBe(true);
  });

  it('returns info when update gap is below warning threshold', async () => {
    const { db } = await import('../db');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        {
          delivery_id: 'del-1',
          customer_name: 'Ngozi O.',
          minutes_since_update: 20,
        },
      ],
    });
    const { evaluate } = await import('../rules/customer-update-gap');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('info');
    expect(results[0]?.shouldFire).toBe(false);
  });
});
