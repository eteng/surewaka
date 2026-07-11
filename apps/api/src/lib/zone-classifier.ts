import { db, zones } from '@surewaka/db';
import { eq } from 'drizzle-orm';

type ZoneDef = {
  id: string;
  name: string;
  city: string;
  keywords: string[];
  swLat: number | null;
  swLng: number | null;
  neLat: number | null;
  neLng: number | null;
};

type ClassifyResult = { id: string; name: string } | null;

// In-memory cache
let cachedZones: ZoneDef[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function invalidateZoneCache(): void {
  cachedZones = null;
  cacheExpiry = 0;
}

async function getActiveZones(): Promise<ZoneDef[]> {
  if (cachedZones && Date.now() < cacheExpiry) return cachedZones;
  const rows = await db.select().from(zones).where(eq(zones.isActive, true));
  cachedZones = rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    keywords: r.keywords ?? [],
    swLat: r.swLat,
    swLng: r.swLng,
    neLat: r.neLat,
    neLng: r.neLng,
  }));
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedZones;
}

function isInBoundingBox(lat: number, lng: number, zone: ZoneDef): boolean {
  if (zone.swLat == null || zone.swLng == null || zone.neLat == null || zone.neLng == null) {
    return true; // No bounding box = no pre-filter
  }
  return lat >= zone.swLat && lat <= zone.neLat && lng >= zone.swLng && lng <= zone.neLng;
}

function matchZone(addressText: string, zoneDefs: ZoneDef[], lat: number, lng: number): ClassifyResult {
  const lower = addressText.toLowerCase();
  let bestMatch: ClassifyResult = null;
  let bestKeywordLen = 0;
  let bestIndex = Infinity;

  for (const zone of zoneDefs) {
    if (!isInBoundingBox(lat, lng, zone)) continue;
    for (const kw of zone.keywords) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx === -1) continue;
      if (kw.length > bestKeywordLen || (kw.length === bestKeywordLen && idx < bestIndex)) {
        bestMatch = { id: zone.id, name: zone.name };
        bestKeywordLen = kw.length;
        bestIndex = idx;
      }
    }
  }

  return bestMatch;
}

/**
 * Two-phase zone classification:
 * 1. Local match — keyword match against provided addressText, filtered by bounding box
 * 2. Remote fallback — if no local match and skipRemote !== true, call LocationIQ reverse-geocode
 */
export async function classifyZone(
  addressText: string,
  lat: number,
  lng: number,
  opts?: { skipRemote?: boolean },
): Promise<ClassifyResult> {
  const zoneDefs = await getActiveZones();
  if (zoneDefs.length === 0) return null;

  // Phase 1: Local match using the provided address text
  const localResult = matchZone(addressText, zoneDefs, lat, lng);
  if (localResult) return localResult;

  // Phase 2: Remote fallback via LocationIQ
  if (opts?.skipRemote) return null;

  const apiKey = process.env.LOCATIONIQ_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const params = new URLSearchParams({
      key: apiKey,
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      addressdetails: '1',
    });

    const res = await fetch(`https://api.locationiq.com/v1/reverse?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[zone-classifier] LocationIQ ${res.status} for (${lat}, ${lng})`);
      return null;
    }

    const data = (await res.json()) as { address?: Record<string, string> };
    const remoteAddressText = Object.values(data.address ?? {}).join(' ');
    return matchZone(remoteAddressText, zoneDefs, lat, lng);
  } catch (err) {
    console.error(`[zone-classifier] Failed for (${lat}, ${lng}):`, err);
    return null;
  }
}
