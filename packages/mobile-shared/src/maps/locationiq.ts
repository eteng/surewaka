const LOCATIONIQ_BASE = 'https://api.locationiq.com/v1';
const API_KEY = process.env.EXPO_PUBLIC_LOCATIONIQ_API_KEY ?? '';

export type LocationIQResult = {
  place_id: string;
  licence: string;
  osm_type: string;
  osm_id: string;
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    town?: string;
    county?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
};

export type LocationSuggestion = {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
  address?: LocationIQResult['address'];
};

export async function searchAddress(query: string): Promise<LocationSuggestion[]> {
  if (!query || query.length < 3) return [];

  const params = new URLSearchParams({
    key: API_KEY,
    q: query,
    limit: '5',
    format: 'json',
    countrycodes: 'ng',
    addressdetails: '1',
  });

  const response = await fetch(`${LOCATIONIQ_BASE}/autocomplete?${params}`);

  if (!response.ok) {
    throw new Error('Failed to search addresses');
  }

  const results = (await response.json()) as LocationIQResult[];

  return results.map((r) => ({
    place_id: r.place_id,
    display_name: r.display_name,
    lat: r.lat,
    lon: r.lon,
    address: r.address,
  }));
}

export async function reverseGeocode(lat: number, lon: number): Promise<LocationSuggestion | null> {
  const params = new URLSearchParams({
    key: API_KEY,
    lat: lat.toString(),
    lon: lon.toString(),
    format: 'json',
  });

  const response = await fetch(`${LOCATIONIQ_BASE}/reverse?${params}`);

  if (!response.ok) {
    return null;
  }

  const result = (await response.json()) as LocationIQResult;
  if (!result.display_name) return null;

  return {
    place_id: result.place_id,
    display_name: result.display_name,
    lat: result.lat,
    lon: result.lon,
    address: result.address,
  };
}

/**
 * Normalize a city name from LocationIQ address fields to match carrier park city values.
 *
 * LocationIQ returns inconsistent city representations for Nigerian locations:
 * - Abuja: no `city` field, falls back to county "Abuja Municipal Area Council" or state "FCT"
 * - Lagos: sometimes "Ikeja" (LGA) instead of "Lagos"
 * - Port Harcourt: sometimes "Obio-Akpor" (LGA)
 *
 * This function maps known variants to the canonical city name used in carrier_parks.
 */
const CITY_NORMALIZATION_MAP: Record<string, string> = {
  // Abuja variants
  'abuja municipal area council': 'Abuja',
  'abuja municipal': 'Abuja',
  'federal capital territory': 'Abuja',
  'fct': 'Abuja',
  'abuja': 'Abuja',
  // Lagos variants
  'lagos': 'Lagos',
  'ikeja': 'Lagos',
  'eti-osa': 'Lagos',
  'lagos island': 'Lagos',
  'lagos mainland': 'Lagos',
  'surulere': 'Lagos',
  'alimosho': 'Lagos',
  'kosofe': 'Lagos',
  'mushin': 'Lagos',
  'oshodi-isolo': 'Lagos',
  'agege': 'Lagos',
  'ifako-ijaiye': 'Lagos',
  'ajeromi-ifelodun': 'Lagos',
  'somolu': 'Lagos',
  'apapa': 'Lagos',
  'amuwo-odofin': 'Lagos',
  'ojo': 'Lagos',
  'badagry': 'Lagos',
  'ibeju-lekki': 'Lagos',
  'epe': 'Lagos',
  'ikorodu': 'Lagos',
  // Port Harcourt variants
  'port harcourt': 'Port Harcourt',
  'obio-akpor': 'Port Harcourt',
  'obio/akpor': 'Port Harcourt',
  'rivers': 'Port Harcourt',
  // Ibadan variants
  'ibadan': 'Ibadan',
  'ibadan north': 'Ibadan',
  'ibadan south-west': 'Ibadan',
  'ibadan south-east': 'Ibadan',
  'ibadan north-east': 'Ibadan',
  'ibadan north-west': 'Ibadan',
};

export function normalizeCity(rawCity: string): string {
  const key = rawCity.trim().toLowerCase();
  return CITY_NORMALIZATION_MAP[key] ?? rawCity;
}
