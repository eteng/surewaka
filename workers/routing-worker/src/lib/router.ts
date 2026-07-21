import { nextDeparture, type DepartureSlot } from './schedule';

export type Park = {
  id: string;
  city: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export type RouteEdge = {
  fromParkId: string;
  toParkId: string;
  carrierId: string;
  routeId: string;
  basePriceKobo: number;
  transitHours: number;
  schedule: DepartureSlot[];
  originPark: Park;
  destPark: Park;
};

export type ResolvedHop = RouteEdge & {
  nextDeparture: Date;
  arrivalAtDest: Date;
  transferMinutesBefore: number;
};

export type RoutePath = {
  hops: ResolvedHop[];
  totalBasePriceKobo: number;
  estimatedDeliveryAt: Date;
};

/** Haversine distance in km */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Transfer time between two parks at 20 km/h (returns minutes) */
function transferMinutes(from: Park, to: Park): number {
  if (from.id === to.id) return 0;
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return Math.ceil((km / 20) * 60);
}

export function buildGraph(routes: RouteEdge[]): Map<string, RouteEdge[]> {
  const graph = new Map<string, RouteEdge[]>();
  for (const route of routes) {
    if (route.schedule.length === 0) continue; // exclude routes with no active schedules
    const edges = graph.get(route.fromParkId) ?? [];
    edges.push(route);
    graph.set(route.fromParkId, edges);
  }
  return graph;
}

type PathState = {
  parkId: string;
  arrivalAtPark: Date;
  totalBasePriceKobo: number;
  hops: ResolvedHop[];
};

export function findCheapestRoute(
  graph: Map<string, RouteEdge[]>,
  originParks: Park[],
  destParks: Park[],
  bookingTime: Date,
  firstMileMinutesPerPark: Map<string, number>,
  lastMileMinutesPerPark: Map<string, number>,
  maxHops: number,
): RoutePath | null {
  const destParkIds = new Set(destParks.map((p) => p.id));

  // --- Phase 1: find direct routes (1 hop) ---
  let bestDirect: RoutePath | null = null;
  for (const originPark of originParks) {
    const firstMins = firstMileMinutesPerPark.get(originPark.id) ?? 30;
    const arrivalAtOrigin = new Date(bookingTime.getTime() + firstMins * 60 * 1000);
    const edges = graph.get(originPark.id) ?? [];
    for (const edge of edges) {
      if (!destParkIds.has(edge.toParkId)) continue;
      const dep = nextDeparture(edge.schedule, arrivalAtOrigin);
      if (!dep) continue;
      const arrivalAtDest = new Date(dep.getTime() + edge.transitHours * 60 * 60 * 1000);
      const lastMins = lastMileMinutesPerPark.get(edge.toParkId) ?? 30;
      const estimatedDeliveryAt = new Date(arrivalAtDest.getTime() + lastMins * 60 * 1000);
      const hop: ResolvedHop = {
        ...edge,
        nextDeparture: dep,
        arrivalAtDest,
        transferMinutesBefore: 0,
      };
      const candidate: RoutePath = {
        hops: [hop],
        totalBasePriceKobo: edge.basePriceKobo,
        estimatedDeliveryAt,
      };
      if (
        !bestDirect ||
        candidate.totalBasePriceKobo < bestDirect.totalBasePriceKobo ||
        (candidate.totalBasePriceKobo === bestDirect.totalBasePriceKobo &&
          candidate.estimatedDeliveryAt < bestDirect.estimatedDeliveryAt)
      ) {
        bestDirect = candidate;
      }
    }
  }
  // Direct routes always preferred — return immediately if found
  if (bestDirect) return bestDirect;

  // --- Phase 2: multi-hop Dijkstra (only when no direct route exists) ---
  if (maxHops <= 1) return null;

  // Priority queue (min-heap by totalBasePriceKobo, then estimatedDelivery)
  // Simple array-based; acceptable for small carrier networks
  const queue: PathState[] = [];

  for (const originPark of originParks) {
    const firstMins = firstMileMinutesPerPark.get(originPark.id) ?? 30;
    queue.push({
      parkId: originPark.id,
      arrivalAtPark: new Date(bookingTime.getTime() + firstMins * 60 * 1000),
      totalBasePriceKobo: 0,
      hops: [],
    });
  }

  let best: RoutePath | null = null;

  while (queue.length > 0) {
    // Find and remove the lowest-cost state
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.totalBasePriceKobo < queue[minIdx]!.totalBasePriceKobo) minIdx = i;
    }
    const state = queue.splice(minIdx, 1)[0]!;

    if (state.hops.length >= maxHops) continue;

    const edges = graph.get(state.parkId) ?? [];
    for (const edge of edges) {
      // Compute transfer time from previous dest park to this edge's origin park
      const prevDestPark =
        state.hops.length > 0 ? state.hops[state.hops.length - 1]!.destPark : null;
      const xferMins = prevDestPark ? transferMinutes(prevDestPark, edge.originPark) : 0;
      const arrivalAtPark = new Date(state.arrivalAtPark.getTime() + xferMins * 60 * 1000);

      const dep = nextDeparture(edge.schedule, arrivalAtPark);
      if (!dep) continue;

      const arrivalAtDest = new Date(dep.getTime() + edge.transitHours * 60 * 60 * 1000);
      const hop: ResolvedHop = {
        ...edge,
        nextDeparture: dep,
        arrivalAtDest,
        transferMinutesBefore: xferMins,
      };
      const newHops = [...state.hops, hop];
      const newCost = state.totalBasePriceKobo + edge.basePriceKobo;

      if (destParkIds.has(edge.toParkId)) {
        const lastMins = lastMileMinutesPerPark.get(edge.toParkId) ?? 30;
        const estimatedDeliveryAt = new Date(arrivalAtDest.getTime() + lastMins * 60 * 1000);
        const candidate: RoutePath = {
          hops: newHops,
          totalBasePriceKobo: newCost,
          estimatedDeliveryAt,
        };
        if (
          !best ||
          newCost < best.totalBasePriceKobo ||
          (newCost === best.totalBasePriceKobo && newHops.length < best.hops.length) ||
          (newCost === best.totalBasePriceKobo &&
            newHops.length === best.hops.length &&
            estimatedDeliveryAt < best.estimatedDeliveryAt)
        ) {
          best = candidate;
        }
      } else {
        queue.push({
          parkId: edge.toParkId,
          arrivalAtPark: arrivalAtDest,
          totalBasePriceKobo: newCost,
          hops: newHops,
        });
      }
    }
  }

  return best;
}
