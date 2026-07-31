/**
 * H3 Spatial Utilities
 *
 * Shared H3 hexagonal grid helpers used across the platform:
 * - Routing worker (park matching)
 * - Coverage gap detection (demand heatmaps)
 * - Driver density tracking
 * - Surge pricing computation
 * - Admin coverage map API
 *
 * Resolution 7 ≈ 5.16 km² per hex — good for intra-city operations in Lagos.
 * Resolution 5 ≈ 252 km² per hex — good for intercity/regional views.
 */

import { latLngToCell, gridDisk, cellToBoundary, cellToLatLng, gridDistance } from 'h3-js';

/** Default resolution for intra-city operations (parks, drivers, surge). ~5 km² per hex. */
export const H3_RESOLUTION = 7;

/** Resolution for regional/intercity views (coverage map zoom-out). ~252 km² per hex. */
export const H3_RESOLUTION_REGIONAL = 5;

/** Default k-ring size for proximity matching. k=2 at res 7 ≈ 15km radius. */
export const H3_K_RING_DEFAULT = 2;

/**
 * Get the H3 cell index for a lat/lng at the default resolution.
 */
export function getH3Cell(lat: number, lng: number, resolution = H3_RESOLUTION): string {
  return latLngToCell(lat, lng, resolution);
}

/**
 * Get all H3 cells within k rings of a center cell (including the center).
 * k=1 → 7 cells, k=2 → 19 cells, k=3 → 37 cells.
 */
export function getH3Neighborhood(lat: number, lng: number, k = H3_K_RING_DEFAULT, resolution = H3_RESOLUTION): string[] {
  const center = latLngToCell(lat, lng, resolution);
  return gridDisk(center, k);
}

/**
 * Get the GeoJSON polygon boundary of an H3 cell.
 * Returns an array of [lat, lng] pairs forming the hexagon.
 */
export function getH3Boundary(h3Index: string): [number, number][] {
  return cellToBoundary(h3Index);
}

/**
 * Get the center lat/lng of an H3 cell.
 */
export function getH3Center(h3Index: string): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(h3Index);
  return { lat, lng };
}

/**
 * Get the grid distance (in hex steps) between two H3 cells.
 * Returns -1 if cells are not comparable (different resolutions).
 */
export function getH3Distance(a: string, b: string): number {
  return gridDistance(a, b);
}

/**
 * Convert an array of H3 cell indexes to GeoJSON FeatureCollection
 * for rendering on a map.
 */
export function h3CellsToGeoJSON(
  cells: { h3Index: string; properties?: Record<string, unknown> }[],
): { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Polygon'; coordinates: [number, number][][] } }> } {
  return {
    type: 'FeatureCollection',
    features: cells.map((cell) => {
      const boundary = cellToBoundary(cell.h3Index);
      // cellToBoundary returns [lat, lng], GeoJSON needs [lng, lat]
      const coordinates = boundary.map(([lat, lng]) => [lng, lat] as [number, number]);
      // Close the polygon
      coordinates.push(coordinates[0]);

      return {
        type: 'Feature' as const,
        properties: {
          h3Index: cell.h3Index,
          ...cell.properties,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [coordinates],
        },
      };
    }),
  };
}

// Re-export h3-js primitives for direct use where needed
export { latLngToCell, gridDisk, cellToBoundary, cellToLatLng, gridDistance } from 'h3-js';
