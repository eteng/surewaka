import { describe, it, expect } from 'vitest';
import { buildGraph, findCheapestRoute, type Park, type RouteEdge } from '../router';
import type { DepartureSlot } from '../schedule';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAILY_SLOT: DepartureSlot = { hour: 8, minute: 0, daysOfWeek: [] }; // 08:00 WAT every day
const AFTERNOON_SLOT: DepartureSlot = { hour: 14, minute: 0, daysOfWeek: [] }; // 14:00 WAT every day

function makePark(id: string, city: string, lat = 6.5, lng = 3.4): Park {
  return { id, city, name: `Park ${id}`, address: `${id} address`, lat, lng };
}

function makeEdge(
  from: Park,
  to: Park,
  priceKobo: number,
  transitHours: number,
  schedule: DepartureSlot[] = [DAILY_SLOT],
): RouteEdge {
  return {
    fromParkId: from.id,
    toParkId: to.id,
    carrierId: `carrier-${from.id}-${to.id}`,
    routeId: `route-${from.id}-${to.id}`,
    basePriceKobo: priceKobo,
    transitHours,
    schedule,
    originPark: from,
    destPark: to,
  };
}

/** Build per-park minute Maps from parallel arrays of parks and minute values. */
function parkMinutes(parks: Park[], minutes: number): Map<string, number> {
  return new Map(parks.map((p) => [p.id, minutes]));
}

// Parks in Lagos (origin) and Abuja (destination)
const lagosA = makePark('lagos-a', 'lagos', 6.517, 3.375);
const lagosB = makePark('lagos-b', 'lagos', 6.601, 3.351);
const abujaA = makePark('abuja-a', 'abuja', 9.057, 7.498);
const abujaB = makePark('abuja-b', 'abuja', 9.072, 7.491);
const phA = makePark('ph-a', 'port_harcourt', 4.815, 7.049);

// bookingTime: 2026-07-22T06:00:00Z = 07:00 WAT
// The 08:00 WAT slot = 07:00 UTC is still ahead at booking time
const BOOKING_TIME = new Date('2026-07-22T06:00:00Z'); // 07:00 WAT

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------

describe('buildGraph', () => {
  it('excludes routes with empty schedule', () => {
    const edgeWithSchedule = makeEdge(lagosA, abujaA, 10_000_00, 8, [DAILY_SLOT]);
    const edgeNoSchedule = makeEdge(lagosB, abujaA, 5_000_00, 8, []);

    const graph = buildGraph([edgeWithSchedule, edgeNoSchedule]);

    expect(graph.has('lagos-a')).toBe(true);
    expect(graph.has('lagos-b')).toBe(false); // excluded — no schedule
  });

  it('groups multiple edges from the same park', () => {
    const e1 = makeEdge(lagosA, abujaA, 10_000_00, 8);
    const e2 = makeEdge(lagosA, abujaB, 12_000_00, 8);

    const graph = buildGraph([e1, e2]);
    expect(graph.get('lagos-a')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findCheapestRoute — direct routes
// ---------------------------------------------------------------------------

describe('findCheapestRoute — direct route', () => {
  it('returns direct route when one exists', () => {
    const edge = makeEdge(lagosA, abujaA, 10_000_00, 8);
    const graph = buildGraph([edge]);

    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 30), parkMinutes([abujaA], 30), 3,
    );

    expect(result).not.toBeNull();
    expect(result!.hops).toHaveLength(1);
    expect(result!.hops[0]!.routeId).toBe(edge.routeId);
    expect(result!.totalBasePriceKobo).toBe(10_000_00);
  });

  it('prefers direct route over a cheaper multi-hop when direct exists', () => {
    // Direct Lagos→Abuja at ₦10,000
    const directEdge = makeEdge(lagosA, abujaA, 10_000_00, 8);
    // Multi-hop Lagos→PH→Abuja at ₦8,000 total (cheaper!) — but direct is always preferred
    const lagosToPhEdge = makeEdge(lagosA, phA, 4_000_00, 4);
    const phToAbujaEdge = makeEdge(phA, abujaA, 4_000_00, 4);

    const graph = buildGraph([directEdge, lagosToPhEdge, phToAbujaEdge]);

    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 30), parkMinutes([abujaA], 30), 3,
    );

    expect(result).not.toBeNull();
    // Must be direct, even though multi-hop is cheaper
    expect(result!.hops).toHaveLength(1);
    expect(result!.hops[0]!.routeId).toBe(directEdge.routeId);
  });

  it('picks the cheaper of two direct routes to the same destination', () => {
    const cheapEdge = makeEdge(lagosA, abujaA, 8_000_00, 8); // ₦8,000
    const expensiveEdge = makeEdge(lagosB, abujaA, 12_000_00, 8); // ₦12,000

    const graph = buildGraph([cheapEdge, expensiveEdge]);

    const result = findCheapestRoute(
      graph, [lagosA, lagosB], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA, lagosB], 30), parkMinutes([abujaA], 30), 3,
    );

    expect(result).not.toBeNull();
    expect(result!.totalBasePriceKobo).toBe(8_000_00);
    expect(result!.hops[0]!.fromParkId).toBe('lagos-a');
  });

  it('returns null when no route exists within maxHops=1', () => {
    // Only multi-hop exists, but maxHops is 1
    const lagosToPhEdge = makeEdge(lagosA, phA, 5_000_00, 4);
    const phToAbujaEdge = makeEdge(phA, abujaA, 5_000_00, 4);

    const graph = buildGraph([lagosToPhEdge, phToAbujaEdge]);

    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 30), parkMinutes([abujaA], 30), 1,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findCheapestRoute — multi-hop
// ---------------------------------------------------------------------------

describe('findCheapestRoute — multi-hop', () => {
  it('returns two-hop path when no direct route exists', () => {
    const lagosToPhEdge = makeEdge(lagosA, phA, 5_000_00, 4);
    const phToAbujaEdge = makeEdge(phA, abujaA, 5_000_00, 6);

    const graph = buildGraph([lagosToPhEdge, phToAbujaEdge]);

    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 30), parkMinutes([abujaA], 30), 3,
    );

    expect(result).not.toBeNull();
    expect(result!.hops).toHaveLength(2);
    expect(result!.totalBasePriceKobo).toBe(10_000_00);
    // Second hop's transfer minutes should be 0 (same park) since ph-a is both dest and origin
    expect(result!.hops[1]!.transferMinutesBefore).toBe(0);
  });

  it('correctly propagates departure times across hops', () => {
    // Lagos→PH: departs 08:00 WAT (07:00 UTC), 4 hrs transit → arrives 11:00 WAT (10:00 UTC)
    // PH→Abuja: departs 14:00 WAT (13:00 UTC) [afternoon slot], 6 hrs → arrives 20:00 WAT (19:00 UTC)
    const lagosToPhEdge = makeEdge(lagosA, phA, 5_000_00, 4, [DAILY_SLOT]); // 08:00 WAT
    const phToAbujaEdge = makeEdge(phA, abujaA, 5_000_00, 6, [AFTERNOON_SLOT]); // 14:00 WAT

    const graph = buildGraph([lagosToPhEdge, phToAbujaEdge]);

    // bookingTime = 2026-07-22T06:00:00Z (07:00 WAT), firstMileMinutes=0
    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 0), parkMinutes([abujaA], 0), 3,
    );

    expect(result).not.toBeNull();
    const [hop1, hop2] = result!.hops;

    // Hop 1: departs 08:00 WAT = 07:00 UTC, arrives 11:00 WAT = 10:00 UTC
    expect(hop1!.nextDeparture.toISOString()).toBe('2026-07-22T07:00:00.000Z');
    expect(hop1!.arrivalAtDest.toISOString()).toBe('2026-07-22T11:00:00.000Z'); // +4h

    // Hop 2: arrives at PH at 10:00 UTC (WAT 11:00), next 14:00 WAT departure = 13:00 UTC
    expect(hop2!.nextDeparture.toISOString()).toBe('2026-07-22T13:00:00.000Z');
    expect(hop2!.arrivalAtDest.toISOString()).toBe('2026-07-22T19:00:00.000Z'); // +6h
  });

  it('booking after last slot of the day — waits for next day first slot', () => {
    // Only an 08:00 WAT daily slot on the route
    // bookingTime = 2026-07-22T08:00:00Z = 09:00 WAT (after 08:00 WAT slot)
    const lateBooking = new Date('2026-07-22T08:00:00Z'); // 09:00 WAT
    const edge = makeEdge(lagosA, abujaA, 10_000_00, 8, [DAILY_SLOT]); // 08:00 WAT

    const graph = buildGraph([edge]);

    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], lateBooking,
      parkMinutes([lagosA], 0), parkMinutes([abujaA], 0), 3,
    );

    expect(result).not.toBeNull();
    // Next departure should be tomorrow: 2026-07-23 08:00 WAT = 07:00 UTC
    expect(result!.hops[0]!.nextDeparture.toISOString()).toBe('2026-07-23T07:00:00.000Z');
  });

  it('returns null when no path exists at all', () => {
    // No edges at all for the requested cities
    const edge = makeEdge(lagosA, phA, 5_000_00, 4); // Only Lagos→PH, nothing to Abuja
    const graph = buildGraph([edge]);

    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 30), parkMinutes([abujaA], 30), 3,
    );
    expect(result).toBeNull();
  });

  it('respects maxHops limit — returns null when path requires more hops', () => {
    // Chain: lagos→a1→a2→abuja (3 edges, needs maxHops≥3)
    const a1 = makePark('a1', 'city1', 7.0, 4.0);
    const a2 = makePark('a2', 'city2', 8.0, 5.0);
    const e1 = makeEdge(lagosA, a1, 3_000_00, 2);
    const e2 = makeEdge(a1, a2, 3_000_00, 2);
    const e3 = makeEdge(a2, abujaA, 3_000_00, 2);

    const graph = buildGraph([e1, e2, e3]);

    // maxHops=2 → too short for this chain
    const result2 = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 0), parkMinutes([abujaA], 0), 2,
    );
    expect(result2).toBeNull();

    // maxHops=3 → succeeds
    const result3 = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 0), parkMinutes([abujaA], 0), 3,
    );
    expect(result3).not.toBeNull();
    expect(result3!.hops).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

describe('findCheapestRoute — tie-breaking', () => {
  it('when equal cost: fewer hops wins over more hops', () => {
    // Two completely separate paths to abujaA, both costing ₦10,000 total.
    // The 2-hop path uses phA as intermediate.
    // The 3-hop path uses mid+ph2 as intermediates — ph2 is a DIFFERENT park from phA
    // so the two paths share no edges and cannot be mixed by Dijkstra.

    const mid = makePark('mid', 'city_mid', 6.9, 4.1);
    const ph2 = makePark('ph-2', 'port_harcourt', 4.9, 7.1); // separate from phA

    // 2-hop path: lagosA → phA (₦5,000) → abujaA (₦5,000) = ₦10,000 total
    const twoHop1 = makeEdge(lagosA, phA, 5_000_00, 4, [DAILY_SLOT]);
    const twoHop2 = makeEdge(phA, abujaA, 5_000_00, 4, [AFTERNOON_SLOT]);

    // 3-hop path: lagosB → mid (₦3,000) → ph2 (₦3,500) → abujaA (₦3,500) = ₦10,000 total
    // ph2 is distinct from phA so phA→abujaA (twoHop2) is NOT reachable from the 3-hop path
    const threeHop1 = makeEdge(lagosB, mid, 3_000_00, 2, [DAILY_SLOT]);
    const threeHop2 = makeEdge(mid, ph2, 3_500_00, 2, [DAILY_SLOT]);
    const threeHop3 = makeEdge(ph2, abujaA, 3_500_00, 4, [AFTERNOON_SLOT]);

    // Build graph: no direct routes from either origin to abujaA
    const graph = buildGraph([twoHop1, twoHop2, threeHop1, threeHop2, threeHop3]);

    const result = findCheapestRoute(
      graph,
      [lagosA, lagosB],
      [abujaA],
      BOOKING_TIME,
      parkMinutes([lagosA, lagosB], 0),
      parkMinutes([abujaA], 0),
      3,
    );

    // Both paths cost ₦10,000 — tie on cost, 2 hops wins over 3 hops
    expect(result).not.toBeNull();
    expect(result!.hops).toHaveLength(2);
    expect(result!.totalBasePriceKobo).toBe(10_000_00);
  });

  it('among direct routes with equal cost — earlier delivery wins', () => {
    // Two direct routes from different parks, same price, different transit hours
    const fastEdge = makeEdge(lagosA, abujaA, 10_000_00, 6, [DAILY_SLOT]); // 6h transit
    const slowEdge = makeEdge(lagosB, abujaA, 10_000_00, 10, [DAILY_SLOT]); // 10h transit

    const graph = buildGraph([fastEdge, slowEdge]);

    const result = findCheapestRoute(
      graph,
      [lagosA, lagosB],
      [abujaA],
      BOOKING_TIME,
      parkMinutes([lagosA, lagosB], 0),
      parkMinutes([abujaA], 0),
      3,
    );

    expect(result).not.toBeNull();
    expect(result!.totalBasePriceKobo).toBe(10_000_00);
    // Fast route (6h) should be preferred — earlier estimatedDeliveryAt
    expect(result!.hops[0]!.fromParkId).toBe('lagos-a');
  });
});

// ---------------------------------------------------------------------------
// estimatedDeliveryAt includes last-mile minutes
// ---------------------------------------------------------------------------

describe('findCheapestRoute — delivery time calculation', () => {
  it('estimatedDeliveryAt = arrivalAtDest + lastMileMinutes', () => {
    const edge = makeEdge(lagosA, abujaA, 10_000_00, 8, [DAILY_SLOT]);
    const graph = buildGraph([edge]);

    const lastMileMinutes = 45;
    const result = findCheapestRoute(
      graph,
      [lagosA],
      [abujaA],
      BOOKING_TIME,
      parkMinutes([lagosA], 0),
      parkMinutes([abujaA], lastMileMinutes),
      3,
    );

    expect(result).not.toBeNull();
    const lastHop = result!.hops[result!.hops.length - 1]!;
    const expectedDelivery = new Date(
      lastHop.arrivalAtDest.getTime() + lastMileMinutes * 60 * 1000,
    );
    expect(result!.estimatedDeliveryAt.getTime()).toBe(expectedDelivery.getTime());
  });

  it('firstMileMinutes delays arrival at origin park before checking departures', () => {
    // bookingTime = 07:00 WAT (06:00 UTC), firstMileMinutes = 90
    // → arrival at park = 08:30 WAT; 08:00 WAT slot already missed → next is next day
    const edge = makeEdge(lagosA, abujaA, 10_000_00, 8, [DAILY_SLOT]); // 08:00 WAT
    const graph = buildGraph([edge]);

    // bookingTime such that adding 90 min pushes past 08:00 WAT slot
    // BOOKING_TIME = 07:00 WAT (06:00 UTC); +90m = 08:30 WAT → 08:00 slot missed
    const result = findCheapestRoute(
      graph, [lagosA], [abujaA], BOOKING_TIME,
      parkMinutes([lagosA], 90), parkMinutes([abujaA], 0), 3,
    );

    expect(result).not.toBeNull();
    // Should depart next day at 08:00 WAT = 07:00 UTC on 2026-07-23
    expect(result!.hops[0]!.nextDeparture.toISOString()).toBe('2026-07-23T07:00:00.000Z');
  });
});
