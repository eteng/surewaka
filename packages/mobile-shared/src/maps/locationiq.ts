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
