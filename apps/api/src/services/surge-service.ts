import { db, deliveries, drivers } from '@surewaka/db';
import { eq, and, inArray, isNotNull } from 'drizzle-orm';
import { getH3Cell, getH3Neighborhood, H3_RESOLUTION } from '@surewaka/shared';

/**
 * Surge Pricing Service
 *
 * Computes a price multiplier based on demand/supply ratio in the H3 cell
 * surrounding a given location.
 *
 * Demand = active deliveries in the cell (pending_routing, accepted, en_route_pickup, picked_up, en_route_dropoff)
 * Supply = available drivers in the cell
 *
 * Ratio thresholds:
 *   - ratio > 8:1 → 2.5x
 *   - ratio > 5:1 → 2.0x
 *   - ratio > 3:1 → 1.5x
 *   - otherwise   → 1.0x (no surge)
 *
 * If no data (new area, no drivers), returns 1.0 (no penalty for new areas).
 */

const ACTIVE_STATUSES = [
  'pending_routing',
  'accepted',
  'en_route_pickup',
  'picked_up',
  'en_route_dropoff',
] as const;

/** Maximum surge multiplier */
const MAX_SURGE = 2.5;

type SurgeResult = {
  multiplier: number;
  demandCount: number;
  supplyCount: number;
  h3Index: string;
};

/**
 * Get the surge multiplier for a given location.
 *
 * @param lat - Pickup latitude
 * @param lng - Pickup longitude
 * @returns Surge result with multiplier and supporting data
 */
export async function getSurgeMultiplier(lat: number, lng: number): Promise<SurgeResult> {
  const h3Index = getH3Cell(lat, lng, H3_RESOLUTION);
  // Include immediate neighbors (k=1 → 7 cells) for a smoother signal
  const neighborhood = getH3Neighborhood(lat, lng, 1, H3_RESOLUTION);

  // Count active deliveries in the neighborhood
  const demandRows = await db
    .select({ pickupLat: deliveries.pickupLat, pickupLng: deliveries.pickupLng })
    .from(deliveries)
    .where(inArray(deliveries.status, [...ACTIVE_STATUSES]));

  // Filter in-memory by H3 cell membership (faster than SQL for small datasets)
  const neighborhoodSet = new Set(neighborhood);
  const demandCount = demandRows.filter((d) => {
    const cell = getH3Cell(d.pickupLat, d.pickupLng, H3_RESOLUTION);
    return neighborhoodSet.has(cell);
  }).length;

  // Count available drivers in the neighborhood
  const supplyRows = await db
    .select({ h3Index: drivers.h3Index })
    .from(drivers)
    .where(
      and(
        eq(drivers.available, true),
        isNotNull(drivers.h3Index),
      ),
    );

  const supplyCount = supplyRows.filter((d) => d.h3Index && neighborhoodSet.has(d.h3Index)).length;

  // Compute multiplier
  const multiplier = computeMultiplier(demandCount, supplyCount);

  return { multiplier, demandCount, supplyCount, h3Index };
}

function computeMultiplier(demand: number, supply: number): number {
  // No demand → no surge
  if (demand === 0) return 1.0;

  // No supply but there's demand → max surge
  if (supply === 0 && demand > 0) return MAX_SURGE;

  const ratio = demand / supply;

  if (ratio > 8) return 2.5;
  if (ratio > 5) return 2.0;
  if (ratio > 3) return 1.5;
  return 1.0;
}
