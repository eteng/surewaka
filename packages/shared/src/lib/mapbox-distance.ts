import { haversineKm } from './haversine';

// ─── Types ────────────────────────────────────────────────────────────────────

type CacheEntry = { km: number; expiresAt: number };

// ─── Configuration ────────────────────────────────────────────────────────────

const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REQUEST_TIMEOUT_MS = 3000;
const BACKOFF_DURATION_MS = 60 * 1000; // 60 seconds on 429

// ─── State ────────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
let backoffUntil = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cacheKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `${fromLat.toFixed(3)},${fromLng.toFixed(3)}→${toLat.toFixed(3)},${toLng.toFixed(3)}`;
}

function isInBackoff(): boolean {
  return Date.now() < backoffUntil;
}

function activateBackoff(): void {
  backoffUntil = Date.now() + BACKOFF_DURATION_MS;
}

// ─── Mapbox Fetch ─────────────────────────────────────────────────────────────

async function fetchMapboxDistance(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<number | null> {
  if (isInBackoff()) return null;

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return null;

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?access_token=${token}&overview=false`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 429) {
      activateBackoff();
      return null;
    }

    if (!res.ok) return null;

    const data = (await res.json()) as { routes?: Array<{ distance?: number }> };
    const meters = data.routes?.[0]?.distance;

    if (typeof meters !== 'number' || meters <= 0) return null;

    return Math.round((meters / 1000) * 10) / 10; // km, 1 decimal
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns driving road distance in km between two coordinates via Mapbox Directions API.
 * Falls back to haversine straight-line distance on any failure (timeout, rate limit, network error).
 *
 * Results are cached in-memory (LRU, max 500 entries, 10-min TTL) keyed by coordinates
 * rounded to 3 decimal places (~111m precision).
 */
export async function getRoadDistanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<number> {
  // Short-circuit: same coordinates
  if (
    fromLat.toFixed(3) === toLat.toFixed(3) &&
    fromLng.toFixed(3) === toLng.toFixed(3)
  ) {
    return 0;
  }

  const key = cacheKey(fromLat, fromLng, toLat, toLng);

  // 1. Check cache
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.km;
  }
  if (cached) cache.delete(key); // expired

  // 2. Try Mapbox
  const roadKm = await fetchMapboxDistance(fromLat, fromLng, toLat, toLng);

  if (roadKm !== null) {
    // Cache the result (evict oldest if at capacity)
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, { km: roadKm, expiresAt: Date.now() + CACHE_TTL_MS });
    return roadKm;
  }

  // 3. Fallback to haversine
  const fallbackKm = haversineKm(fromLat, fromLng, toLat, toLng);
  console.warn(
    `[mapbox-distance] Fallback to haversine: ${fallbackKm.toFixed(1)}km (${fromLat},${fromLng} → ${toLat},${toLng})`,
  );
  return Math.round(fallbackKm * 10) / 10;
}

// ─── Test Utilities ───────────────────────────────────────────────────────────

/** Resets the LRU cache and backoff state. Exposed for testing only. */
export function _resetDistanceCache(): void {
  cache.clear();
  backoffUntil = 0;
}
