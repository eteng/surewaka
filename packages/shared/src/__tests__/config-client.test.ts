import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: { select: vi.fn() },
  systemConfig: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

// Import after mocks
const { getConfig, invalidateConfig, _resetConfigCache } = await import('../config/client');
const { db } = await import('@surewaka/db');

type SelectChain = {
  from: ReturnType<typeof vi.fn>;
};

function mockDbRow(value: unknown) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ key: 'test', value }]),
      }),
    }),
  } as unknown as SelectChain);
}

function mockDbEmpty() {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as unknown as SelectChain);
}

describe('getConfig', () => {
  beforeEach(() => {
    _resetConfigCache();
    vi.clearAllMocks();
  });

  it('returns registry default when no DB row exists', async () => {
    mockDbEmpty();
    const val = await getConfig('matching.first_mile_dispatch_buffer_min');
    expect(val).toBe(45);
  });

  it('returns parsed DB value when row exists', async () => {
    mockDbRow(60);
    const val = await getConfig('matching.first_mile_dispatch_buffer_min');
    expect(val).toBe(60);
  });

  it('returns default for scoring_weights when no DB row', async () => {
    mockDbEmpty();
    const val = await getConfig('matching.scoring_weights');
    expect(val).toEqual({
      distancePerKm: -10,
      acceptanceRate: 20,
      completionRate: 15,
      highRatingBonus: 10,
      lowRatingPenalty: -15,
      idleBonus30min: 10,
      idleBonus60min: 5,
      headingBonus: 8,
    });
  });

  it('caches the result — skips DB on second call within TTL', async () => {
    mockDbRow(5);
    await getConfig('matching.tier1_radius_km');
    await getConfig('matching.tier1_radius_km');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('re-fetches from DB after invalidateConfig clears cache entry', async () => {
    mockDbRow(5);
    await getConfig('matching.tier1_radius_km');
    invalidateConfig('matching.tier1_radius_km');
    mockDbRow(8);
    const val = await getConfig('matching.tier1_radius_km');
    expect(val).toBe(8);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('throws a ZodError when DB value fails schema validation', async () => {
    mockDbRow('not-a-number');
    await expect(getConfig('matching.tier1_radius_km')).rejects.toThrow();
  });
});
