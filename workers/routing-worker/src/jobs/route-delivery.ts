import type { Job } from 'bullmq';
import { latLngToCell, gridDisk } from 'h3-js';
import {
  db,
  deliveries,
  deliveryLegs,
  quotes,
  carrierRoutes,
  carrierParks,
  carrierRouteSchedules,
  carriers,
  feeSettings,
  vehicleTypeRates,
} from '@surewaka/db';
import { eq, and, inArray } from 'drizzle-orm';
import { classifyZone } from '@surewaka/db';
import { createAblyProvider } from '@surewaka/realtime';
import { buildGraph, findCheapestRoute } from '../lib/router';
import type { RouteEdge, Park } from '../lib/router';
import { enqueuePushFromWorker } from '../push-enqueue';
import type { RouteDeliveryJobData } from '../queue';
import { getRoadDistanceKm, haversineKm } from '@surewaka/shared';
import { logger } from '../lib/logger';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const FIRST_LAST_MILE_SPEED_KMH = 20;

type LineItem = { label: string; amountKobo: number };

function calcOnDemandLeg(
  distanceKm: number,
  weightKg: number,
  baseRateKobo: number,
  perKgRateKobo: number,
  perKmRateKobo: number,
  multiplier: number,
  taxRatePct: number,
): { totalKobo: number; lineItems: LineItem[] } {
  const baseFee = Math.round(baseRateKobo);
  const weightSurcharge = Math.round(weightKg * perKgRateKobo);
  const distSurcharge = Math.round(distanceKm * perKmRateKobo);
  const subtotalBefore = baseFee + weightSurcharge + distSurcharge;
  const subtotalAfter = Math.round(subtotalBefore * multiplier);
  const vehicleDiff = subtotalAfter - subtotalBefore;
  const tax = Math.round(subtotalAfter * taxRatePct / 100);
  const lineItems: LineItem[] = [
    { label: 'Base fee', amountKobo: baseFee },
    { label: `Weight surcharge (${weightKg}kg)`, amountKobo: weightSurcharge },
    { label: `Distance surcharge (${distanceKm.toFixed(1)}km)`, amountKobo: distSurcharge },
    { label: `Vehicle type (motorcycle × ${multiplier})`, amountKobo: vehicleDiff },
  ];
  if (tax > 0) lineItems.push({ label: 'Tax', amountKobo: tax });
  return { totalKobo: lineItems.reduce((s, i) => s + i.amountKobo, 0), lineItems };
}

function calcCarrierLeg(
  basePriceKobo: number,
  carrierName: string,
  commissionRatePct: number,
  taxRatePct: number,
): { totalKobo: number; lineItems: LineItem[] } {
  const carrierRate = Math.round(basePriceKobo);
  const serviceFee = Math.round(basePriceKobo * commissionRatePct / 100);
  const tax = Math.round(serviceFee * taxRatePct / 100);
  const lineItems: LineItem[] = [
    { label: `Carrier rate (${carrierName})`, amountKobo: carrierRate },
    { label: 'SureWaka service fee', amountKobo: serviceFee },
  ];
  if (tax > 0) lineItems.push({ label: 'Tax', amountKobo: tax });
  return { totalKobo: lineItems.reduce((s, i) => s + i.amountKobo, 0), lineItems };
}

export async function handleRouteDelivery(job: Job<RouteDeliveryJobData>): Promise<void> {
  const { deliveryId, bookingTime } = job.data;
  const bookingAt = new Date(bookingTime);
  const now = new Date();
  const jobStart = Date.now();

  const log = logger.child({ jobId: job.id ?? 'unknown', deliveryId });
  log.info('Starting route computation', {
    bookingTime,
    vehicleType: job.data.vehicleType,
    attempt: job.attemptsMade + 1,
  });

  // 1. Load delivery — idempotency
  const [delivery] = await log.time('db:load-delivery', () =>
    db.select().from(deliveries).where(eq(deliveries.id, deliveryId)),
  );

  if (!delivery) {
    log.warn('Delivery not found — skipping', { reason: 'NOT_FOUND' });
    return;
  }
  if (delivery.status !== 'pending_routing') {
    log.info('Delivery not in pending_routing status — skipping', {
      currentStatus: delivery.status,
      reason: 'WRONG_STATUS',
    });
    return;
  }

  log.debug('Delivery loaded', {
    pickupCity: delivery.pickupCity,
    dropoffCity: delivery.dropoffCity,
    customerId: delivery.customerId,
  });

  // 2. Staleness: if job is >2h old, reset and re-enqueue with fresh bookingTime
  const ageMs = now.getTime() - bookingAt.getTime();
  if (ageMs > STALE_THRESHOLD_MS) {
    log.warn('Job is stale — re-enqueueing with fresh bookingTime', {
      ageMinutes: Math.round(ageMs / 60_000),
      threshold: '2h',
    });
    await db.update(deliveries)
      .set({ status: 'pending_routing', updatedAt: now })
      .where(eq(deliveries.id, deliveryId));
    const { routingQueue } = await import('../queue');
    await routingQueue.add('route-delivery', {
      deliveryId,
      bookingTime: now.toISOString(),
      vehicleType: 'motorcycle',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    return;
  }

  try {
    // 3. Load active routes + carrier names
    const routeRows = await log.time('db:load-carrier-routes', () =>
      db
        .select({
          id: carrierRoutes.id,
          carrierId: carrierRoutes.carrierId,
          carrierName: carriers.name,
          basePriceKobo: carrierRoutes.basePriceKobo,
          estimatedTransitHrs: carrierRoutes.estimatedTransitHrs,
          originParkId: carrierRoutes.originParkId,
          destinationParkId: carrierRoutes.destinationParkId,
        })
        .from(carrierRoutes)
        .innerJoin(carriers, eq(carrierRoutes.carrierId, carriers.id))
        .where(eq(carrierRoutes.isActive, true)),
    );

    log.debug('Carrier routes loaded', { count: routeRows.length });

    if (routeRows.length === 0) {
      log.warn('No active carrier routes found — marking failed', { reason: 'NO_ROUTES' });
      await markFailed(deliveryId, delivery.customerId, 'NO_ROUTES', log);
      return;
    }

    // 4. Load all parks referenced by these routes
    const parkIdSet = new Set<string>();
    for (const r of routeRows) {
      parkIdSet.add(r.originParkId);
      parkIdSet.add(r.destinationParkId);
    }
    const parkIdList = [...parkIdSet];

    const parkRows = await log.time('db:load-parks', () =>
      parkIdList.length > 0
        ? db.select().from(carrierParks).where(
            and(inArray(carrierParks.id, parkIdList), eq(carrierParks.isActive, true)),
          )
        : Promise.resolve([]),
      { parkCount: parkIdList.length },
    );

    const parkMap = new Map(parkRows.map((p) => [p.id, p]));
    log.debug('Parks loaded', { total: parkIdList.length, active: parkRows.length });

    // 5. Load active schedules for all routes
    const routeIds = routeRows.map((r) => r.id);
    const scheduleRows = await log.time('db:load-schedules', () =>
      routeIds.length > 0
        ? db.select().from(carrierRouteSchedules).where(
            and(inArray(carrierRouteSchedules.carrierRouteId, routeIds), eq(carrierRouteSchedules.isActive, true)),
          )
        : Promise.resolve([]),
      { routeCount: routeIds.length },
    );

    const schedByRoute = new Map<string, typeof scheduleRows>();
    for (const s of scheduleRows) {
      const arr = schedByRoute.get(s.carrierRouteId) ?? [];
      arr.push(s);
      schedByRoute.set(s.carrierRouteId, arr);
    }
    log.debug('Schedules loaded', { count: scheduleRows.length, routesWithSchedules: schedByRoute.size });

    // 6. Build graph edges
    const carrierNameMap = new Map(routeRows.map((r) => [r.carrierId, r.carrierName]));
    const edges: RouteEdge[] = [];
    for (const r of routeRows) {
      const op = parkMap.get(r.originParkId);
      const dp = parkMap.get(r.destinationParkId);
      if (!op || !dp) continue;
      const scheds = schedByRoute.get(r.id) ?? [];
      if (scheds.length === 0) continue;
      edges.push({
        fromParkId: r.originParkId,
        toParkId: r.destinationParkId,
        carrierId: r.carrierId,
        routeId: r.id,
        basePriceKobo: r.basePriceKobo,
        transitHours: r.estimatedTransitHrs,
        schedule: scheds.map((s) => ({
          hour: s.hour,
          minute: s.minute,
          daysOfWeek: (s.daysOfWeek ?? []) as number[],
        })),
        originPark: { id: op.id, city: op.city, name: op.name, address: op.address, lat: op.lat, lng: op.lng },
        destPark: { id: dp.id, city: dp.city, name: dp.name, address: dp.address, lat: dp.lat, lng: dp.lng },
      });
    }

    const graph = buildGraph(edges);
    log.info('Route graph built', { edges: edges.length, nodes: graph.size });

    // 7. Find origin/dest parks by H3 hexagonal proximity
    //    Resolution 7 ≈ 5.16 km² per hex. k-ring 2 covers ~15km radius.
    const H3_RESOLUTION = 7;
    const K_RING_SIZE = 2;

    const pickupH3 = latLngToCell(delivery.pickupLat, delivery.pickupLng, H3_RESOLUTION);
    const dropoffH3 = latLngToCell(delivery.dropoffLat, delivery.dropoffLng, H3_RESOLUTION);
    const pickupHexes = new Set(gridDisk(pickupH3, K_RING_SIZE));
    const dropoffHexes = new Set(gridDisk(dropoffH3, K_RING_SIZE));

    const originParks: Park[] = parkRows
      .filter((p) => p.h3Index && pickupHexes.has(p.h3Index))
      .map((p) => ({ id: p.id, city: p.city, name: p.name, address: p.address, lat: p.lat, lng: p.lng }));
    const destParks: Park[] = parkRows
      .filter((p) => p.h3Index && dropoffHexes.has(p.h3Index))
      .map((p) => ({ id: p.id, city: p.city, name: p.name, address: p.address, lat: p.lat, lng: p.lng }));

    log.debug('H3 park matching', {
      pickupH3,
      dropoffH3,
      pickupHexCount: pickupHexes.size,
      dropoffHexCount: dropoffHexes.size,
      originParksFound: originParks.length,
      destParksFound: destParks.length,
    });

    if (originParks.length === 0 || destParks.length === 0) {
      log.warn('No parks found near pickup/dropoff — marking failed', {
        reason: 'NO_PARKS_IN_RANGE',
        pickupH3,
        dropoffH3,
        originParksFound: originParks.length,
        destParksFound: destParks.length,
      });
      await markFailed(deliveryId, delivery.customerId, 'NO_PARKS_IN_RANGE', log);
      return;
    }

    // 8. Compute per-park first/last mile minutes so Dijkstra uses accurate arrival times
    const firstMileMinutesPerPark = new Map<string, number>();
    for (const p of originParks) {
      const km = haversineKm(delivery.pickupLat, delivery.pickupLng, p.lat, p.lng);
      firstMileMinutesPerPark.set(p.id, Math.max(1, Math.ceil((km / FIRST_LAST_MILE_SPEED_KMH) * 60)));
    }
    const lastMileMinutesPerPark = new Map<string, number>();
    for (const p of destParks) {
      const km = haversineKm(p.lat, p.lng, delivery.dropoffLat, delivery.dropoffLng);
      lastMileMinutesPerPark.set(p.id, Math.max(1, Math.ceil((km / FIRST_LAST_MILE_SPEED_KMH) * 60)));
    }

    // 9. Find cheapest route
    const routeStart = Date.now();
    const path = findCheapestRoute(graph, originParks, destParks, bookingAt, firstMileMinutesPerPark, lastMileMinutesPerPark, 3);
    log.info('Dijkstra route computation', {
      durationMs: Date.now() - routeStart,
      found: !!path,
      hops: path?.hops.length ?? 0,
      totalBasePriceKobo: path?.totalBasePriceKobo ?? 0,
    });

    if (!path) {
      log.warn('No route found by Dijkstra — marking failed', { reason: 'NO_ROUTE_FOUND' });
      await markFailed(deliveryId, delivery.customerId, 'NO_ROUTE_FOUND', log);
      return;
    }

    // 10. Load fee settings + motorcycle multiplier
    const [settings] = await log.time('db:load-fee-settings', () =>
      db.select().from(feeSettings),
    );
    if (!settings) throw new Error('fee_settings not found');

    const [motoRow] = await log.time('db:load-vehicle-rates', () =>
      db
        .select({ multiplier: vehicleTypeRates.multiplier })
        .from(vehicleTypeRates)
        .where(eq(vehicleTypeRates.vehicleType, 'motorcycle')),
    );
    const motoMultiplier = motoRow ? parseFloat(String(motoRow.multiplier)) : 1.0;
    const commissionPct = parseFloat(String(settings.carrierCommissionRatePct));
    const taxPct = parseFloat(String(settings.taxRatePct));
    const packageWeight = delivery.packageWeight ?? 0;

    // 11. Compute cancellation deadline = first departure − 60 min
    const firstDep = path.hops[0]!.nextDeparture;
    const cancellationDeadlineAt = new Date(firstDep.getTime() - 60 * 60 * 1000);
    const expiresAt = cancellationDeadlineAt;

    // 11b. Derive actual first/last mile km from the selected path's park coordinates
    const firstHopOrigin = path.hops[0]!.originPark;
    const lastHopDest = path.hops[path.hops.length - 1]!.destPark;

    const firstMileDistKm = await log.time('api:first-mile-road-distance', () =>
      getRoadDistanceKm(
        delivery.pickupLat, delivery.pickupLng,
        firstHopOrigin.lat, firstHopOrigin.lng,
      ),
    );
    const lastMileDistKm = await log.time('api:last-mile-road-distance', () =>
      getRoadDistanceKm(
        lastHopDest.lat, lastHopDest.lng,
        delivery.dropoffLat, delivery.dropoffLng,
      ),
    );

    log.debug('Mile distances computed', {
      firstMileKm: firstMileDistKm.toFixed(2),
      lastMileKm: lastMileDistKm.toFixed(2),
    });

    // 12. Build ordered leg definitions
    type LegDef = {
      legType: string;
      actorType: string;
      actorId: string;
      carrierId: string | null;
      pickupAddress: string; pickupLat: number; pickupLng: number;
      dropoffAddress: string; dropoffLat: number; dropoffLng: number;
      systemEtaAt: Date;
      distanceKm: number;
      hopIdx?: number;
    };

    const legDefs: LegDef[] = [];

    legDefs.push({
      legType: 'first_mile', actorType: 'driver', actorId: NIL_UUID, carrierId: null,
      pickupAddress: delivery.pickupAddress, pickupLat: delivery.pickupLat, pickupLng: delivery.pickupLng,
      dropoffAddress: firstHopOrigin.address, dropoffLat: firstHopOrigin.lat, dropoffLng: firstHopOrigin.lng,
      systemEtaAt: path.hops[0]!.nextDeparture,
      distanceKm: firstMileDistKm,
    });

    for (let i = 0; i < path.hops.length; i++) {
      const hop = path.hops[i]!;

      if (i > 0) {
        const prevHop = path.hops[i - 1]!;
        const transferDist = await getRoadDistanceKm(
          prevHop.destPark.lat, prevHop.destPark.lng,
          hop.originPark.lat, hop.originPark.lng,
        );
        legDefs.push({
          legType: 'transfer', actorType: 'driver', actorId: NIL_UUID, carrierId: null,
          pickupAddress: prevHop.destPark.address, pickupLat: prevHop.destPark.lat, pickupLng: prevHop.destPark.lng,
          dropoffAddress: hop.originPark.address, dropoffLat: hop.originPark.lat, dropoffLng: hop.originPark.lng,
          systemEtaAt: hop.nextDeparture,
          distanceKm: transferDist,
        });
      }

      legDefs.push({
        legType: 'intercity', actorType: 'carrier', actorId: hop.carrierId, carrierId: hop.carrierId,
        pickupAddress: hop.originPark.address, pickupLat: hop.originPark.lat, pickupLng: hop.originPark.lng,
        dropoffAddress: hop.destPark.address, dropoffLat: hop.destPark.lat, dropoffLng: hop.destPark.lng,
        systemEtaAt: hop.arrivalAtDest,
        distanceKm: 0,
        hopIdx: i,
      });
    }

    const lastHop = path.hops[path.hops.length - 1]!;
    legDefs.push({
      legType: 'last_mile', actorType: 'driver', actorId: NIL_UUID, carrierId: null,
      pickupAddress: lastHop.destPark.address, pickupLat: lastHop.destPark.lat, pickupLng: lastHop.destPark.lng,
      dropoffAddress: delivery.dropoffAddress, dropoffLat: delivery.dropoffLat, dropoffLng: delivery.dropoffLng,
      systemEtaAt: path.estimatedDeliveryAt,
      distanceKm: lastMileDistKm,
    });

    log.info('Leg definitions built', {
      totalLegs: legDefs.length,
      legTypes: legDefs.map((l) => l.legType),
    });

    // 13. Zone classify driver legs (best-effort; null is safe)
    const zoneStart = Date.now();
    const zonified = await Promise.all(legDefs.map(async (leg) => {
      if (leg.actorType !== 'driver') return { ...leg, pickupZoneId: null, dropoffZoneId: null };
      const pz = await classifyZone(leg.pickupAddress, leg.pickupLat, leg.pickupLng, { skipRemote: true }).catch(() => null);
      const dz = await classifyZone(leg.dropoffAddress, leg.dropoffLat, leg.dropoffLng, { skipRemote: true }).catch(() => null);
      return { ...leg, pickupZoneId: pz?.id ?? null, dropoffZoneId: dz?.id ?? null };
    }));
    log.info('Zone classification', { durationMs: Date.now() - zoneStart, driverLegs: legDefs.filter((l) => l.actorType === 'driver').length });

    // 14. Transaction: insert legs + quotes + update delivery
    let totalKobo = 0;
    const legSummaries: Array<{ legType: string; totalKobo: number }> = [];

    await log.time('db:transaction-insert-legs-quotes', async () => {
      await db.transaction(async (tx) => {
        for (let i = 0; i < zonified.length; i++) {
          const leg = zonified[i]!;

          const [inserted] = await tx.insert(deliveryLegs).values({
            deliveryId,
            legNumber: i + 1,
            legType: leg.legType,
            actorType: leg.actorType,
            actorId: leg.actorId,
            pickupAddress: leg.pickupAddress,
            pickupLat: leg.pickupLat,
            pickupLng: leg.pickupLng,
            pickupZoneId: leg.pickupZoneId,
            dropoffAddress: leg.dropoffAddress,
            dropoffLat: leg.dropoffLat,
            dropoffLng: leg.dropoffLng,
            dropoffZoneId: leg.dropoffZoneId,
            status: 'pending',
            systemEtaAt: leg.systemEtaAt,
            isActive: true,
          }).returning({ id: deliveryLegs.id });

          let qTotalKobo: number;
          let qLineItems: LineItem[];
          let qCarrierId: string | null = null;

          if (leg.legType === 'intercity') {
            const cName = carrierNameMap.get(leg.carrierId!) ?? 'Carrier';
            const result = calcCarrierLeg(
              path.hops[leg.hopIdx!]!.basePriceKobo,
              cName,
              commissionPct,
              taxPct,
            );
            qTotalKobo = result.totalKobo;
            qLineItems = result.lineItems;
            qCarrierId = leg.carrierId;
          } else {
            const result = calcOnDemandLeg(
              leg.distanceKm,
              packageWeight,
              settings.baseRateKobo,
              settings.perKgRateKobo,
              settings.perKmRateKobo,
              motoMultiplier,
              taxPct,
            );
            qTotalKobo = result.totalKobo;
            qLineItems = result.lineItems;
          }

          await tx.insert(quotes).values({
            deliveryLegId: inserted!.id,
            deliveryId,
            carrierId: qCarrierId,
            lineItems: qLineItems as unknown as Record<string, unknown>[],
            totalKobo: qTotalKobo,
            distanceKm: leg.actorType === 'driver' ? leg.distanceKm : null,
            packageWeightKg: leg.actorType === 'driver' ? packageWeight : null,
            expiresAt,
          });

          totalKobo += qTotalKobo;
          legSummaries.push({ legType: leg.legType, totalKobo: qTotalKobo });
        }

        await tx.update(deliveries).set({
          status: 'draft',
          priceKobo: totalKobo,
          deliveryMode: 'surewaka_way',
          cancellationDeadlineAt,
          systemEtaAt: path.estimatedDeliveryAt,
          updatedAt: now,
        }).where(eq(deliveries.id, deliveryId));
      });
    }, { legsInserted: zonified.length });

    log.info('Transaction committed', {
      totalKobo,
      totalNaira: (totalKobo / 100).toFixed(2),
      legsInserted: zonified.length,
      legBreakdown: legSummaries,
    });

    // 15. Publish Ably routed event (fire-and-forget; delivery is already draft)
    try {
      await log.time('ably:publish-routed-event', async () => {
        const realtime = createAblyProvider();
        await realtime.publish(`delivery:${deliveryId}`, 'routed', {
          deliveryId,
          compositeTotalKobo: totalKobo,
          expiresAt: expiresAt.toISOString(),
          estimatedDeliveryAt: path.estimatedDeliveryAt.toISOString(),
          cancellationDeadlineAt: cancellationDeadlineAt.toISOString(),
          legs: legSummaries,
          hops: path.hops.map((h) => ({
            carrierId: h.carrierId,
            carrierName: carrierNameMap.get(h.carrierId) ?? 'Carrier',
            originParkName: h.originPark.name,
            destParkName: h.destPark.name,
            nextDepartureAt: h.nextDeparture.toISOString(),
            arrivalAt: h.arrivalAtDest.toISOString(),
          })),
        });
        realtime.close();
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Ably publish failed (non-fatal)', { error: error.message, channel: `delivery:${deliveryId}` });
    }

    // 16. Push: "Your route is ready"
    await log.time('push:enqueue-routing-complete', () =>
      enqueuePushFromWorker(delivery.customerId, 'routing-complete', {
        title: 'Your route is ready!',
        body: 'Tap to confirm your delivery.',
        data: {
          type: 'routing-complete',
          resourceId: deliveryId,
          deepLink: `/delivery/${deliveryId}`,
        },
      }),
    );

    const totalDurationMs = Date.now() - jobStart;
    log.info('Route computation complete', {
      durationMs: totalDurationMs,
      hops: path.hops.length,
      totalNaira: (totalKobo / 100).toFixed(2),
      estimatedDeliveryAt: path.estimatedDeliveryAt.toISOString(),
      cancellationDeadlineAt: cancellationDeadlineAt.toISOString(),
      carriers: path.hops.map((h) => carrierNameMap.get(h.carrierId) ?? h.carrierId),
    });

  } catch (err) {
    const totalDurationMs = Date.now() - jobStart;
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Route computation failed — will retry', {
      durationMs: totalDurationMs,
      error: error.message,
      stack: error.stack,
    });
    throw err;
  }
}

async function markFailed(
  deliveryId: string,
  customerId: string,
  reason: string,
  log: InstanceType<typeof import('../lib/logger').WorkerLogger>,
): Promise<void> {
  await log.time('db:mark-delivery-failed', () =>
    db.update(deliveries)
      .set({ status: 'routing_failed', updatedAt: new Date() })
      .where(eq(deliveries.id, deliveryId)),
  );

  try {
    await log.time('ably:publish-routing-failed', async () => {
      const realtime = createAblyProvider();
      await realtime.publish(`delivery:${deliveryId}`, 'routing_failed', { deliveryId, reason });
      realtime.close();
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Ably publish failed (routing_failed)', { error: error.message });
  }

  await log.time('push:enqueue-routing-failed', () =>
    enqueuePushFromWorker(customerId, 'routing-failed', {
      title: 'Route not found',
      body: "We couldn't find a route for your delivery. Tap to choose a carrier manually.",
      data: {
        type: 'routing-failed',
        resourceId: deliveryId,
        deepLink: `/deliveries`,
      },
    }),
  );

  log.warn('Delivery marked as routing_failed', { reason });
}
