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

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
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
  return result.display_name ?? null;
}
