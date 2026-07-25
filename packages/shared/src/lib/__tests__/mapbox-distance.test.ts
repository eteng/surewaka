import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRoadDistanceKm, _resetDistanceCache } from '../mapbox-distance';

// ─── Mock fetch globally ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapboxResponse(distanceMeters: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ routes: [{ distance: distanceMeters }] }),
  };
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _resetDistanceCache();
  vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getRoadDistanceKm', () => {
  it('returns road distance from Mapbox response', async () => {
    mockFetch.mockResolvedValueOnce(mapboxResponse(12500)); // 12.5km

    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    expect(km).toBe(12.5);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toContain('api.mapbox.com/directions/v5/mapbox/driving');
  });

  it('returns cached result on second call with same coordinates', async () => {
    mockFetch.mockResolvedValueOnce(mapboxResponse(8000));

    const first = await getRoadDistanceKm(6.5, 3.4, 6.6, 3.5);
    const second = await getRoadDistanceKm(6.5, 3.4, 6.6, 3.5);

    expect(first).toBe(8.0);
    expect(second).toBe(8.0);
    expect(mockFetch).toHaveBeenCalledOnce(); // only 1 call, second was cached
  });

  it('rounds coordinates to 3 decimals for cache key — close coords share cache', async () => {
    mockFetch.mockResolvedValueOnce(mapboxResponse(5000));

    // Both round to: 6.438,3.422→6.512,3.378 at 3 decimal places
    const first = await getRoadDistanceKm(6.43811, 3.42212, 6.51243, 3.37812);
    const second = await getRoadDistanceKm(6.43849, 3.42249, 6.51201, 3.37842);

    expect(first).toBe(5.0);
    expect(second).toBe(5.0);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns 0 for identical coordinates without calling fetch', async () => {
    const km = await getRoadDistanceKm(6.438, 3.422, 6.438, 3.422);

    expect(km).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to haversine on network timeout (aborted)', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    // Should return a positive number (haversine fallback)
    expect(km).toBeGreaterThan(0);
    expect(km).toBeLessThan(50); // sanity — these coords are close in Lagos
  });

  it('falls back to haversine on HTTP 500', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));

    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    expect(km).toBeGreaterThan(0);
  });

  it('activates backoff on HTTP 429 — subsequent calls skip Mapbox', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(429));

    // First call triggers backoff
    const first = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);
    expect(first).toBeGreaterThan(0); // haversine fallback

    // Second call with different coords — should NOT call fetch (in backoff)
    const second = await getRoadDistanceKm(6.5, 3.5, 6.6, 3.6);
    expect(second).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledOnce(); // only the first call hit fetch
  });

  it('exits backoff after 60 seconds', async () => {
    vi.useFakeTimers();

    mockFetch.mockResolvedValueOnce(errorResponse(429));
    await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    // Advance 61 seconds
    vi.advanceTimersByTime(61_000);

    mockFetch.mockResolvedValueOnce(mapboxResponse(10000));
    const km = await getRoadDistanceKm(6.5, 3.5, 6.6, 3.6);

    expect(km).toBe(10.0);
    expect(mockFetch).toHaveBeenCalledTimes(2); // both calls hit fetch

    vi.useRealTimers();
  });

  it('falls back to haversine on invalid response shape (no routes)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ routes: [] }),
    });

    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    expect(km).toBeGreaterThan(0); // haversine fallback
  });

  it('falls back to haversine on invalid response shape (distance is negative)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ routes: [{ distance: -100 }] }),
    });

    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    expect(km).toBeGreaterThan(0); // haversine fallback
  });

  it('falls back to haversine when MAPBOX_ACCESS_TOKEN is not set', async () => {
    vi.stubEnv('MAPBOX_ACCESS_TOKEN', '');

    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    expect(km).toBeGreaterThan(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('_resetDistanceCache clears cache and backoff', async () => {
    mockFetch.mockResolvedValueOnce(mapboxResponse(7000));
    await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    _resetDistanceCache();

    // After reset, same coords should call fetch again
    mockFetch.mockResolvedValueOnce(mapboxResponse(7500));
    const km = await getRoadDistanceKm(6.438, 3.422, 6.512, 3.378);

    expect(km).toBe(7.5);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
