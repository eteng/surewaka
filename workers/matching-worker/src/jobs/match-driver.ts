import type { Job } from 'bullmq';
import type { MatchDriverJobData, MatchResult, DriverCandidate, ScoredDriver } from '@surewaka/shared';
import { MATCHING_TIERS, MATCHING_TOTAL_TIMEOUT_MS } from '@surewaka/shared';
import { getConfig } from '@surewaka/shared/server';
import { createAblyProvider, findNearbyDrivers } from '@surewaka/realtime';
import { reserveDriver, releaseReservations } from '../lib/reservation';
import { scoreDrivers } from '../lib/scoring';
import { waitForAcceptance } from '../lib/wait-for-acceptance';
import { db, deliveries, deliveryOffers, drivers } from '@surewaka/db';
import { and, eq, inArray } from 'drizzle-orm';
import { connection } from '../queue';
import { triggerSelfDropFallback } from './self-drop-fallback';
import { cleanupCancelledMatching } from './cancel-matching';
import { enqueuePushFromWorker } from '../push-enqueue';
import { logger } from '../lib/logger';

/**
 * Core matching orchestrator — BullMQ job handler.
 *
 * Implements the three-tier broadcast algorithm:
 * - Tier 1: 5km radius, top 5 scored drivers, 30s wait
 * - Tier 2: 8km radius, next 10 scored drivers, 30s wait
 * - Tier 3: 12km radius, all eligible (up to 50), 3min wait
 *
 * Composes: Location Store (find) → Scoring Engine (rank) → Reservation Layer (lock)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 13.1
 */
export async function handleMatchDriver(job: Job<MatchDriverJobData>): Promise<MatchResult> {
  const { deliveryId, pickupLng, pickupLat, vehicleType, legType, legId } = job.data;
  const startTime = Date.now();
  const offeredDriverIds = new Set<string>();

  const log = logger.child({ jobId: job.id ?? 'unknown', deliveryId });
  log.info('Starting driver matching', {
    legType,
    legId,
    vehicleType,
    pickupLat,
    pickupLng,
    attempt: job.attemptsMade + 1,
    totalTimeout: `${MATCHING_TOTAL_TIMEOUT_MS / 1000}s`,
    tiers: MATCHING_TIERS.length,
  });

  // Load admin-configurable scoring weights (Req 14.3)
  const scoringWeights = await log.time('config:load-scoring-weights', () =>
    getConfig('matching.scoring_weights'),
  );

  for (const tierConfig of MATCHING_TIERS) {
    const tierStart = Date.now();

    // 1. Check absolute timeout (5 minutes max — Req 3.7)
    const elapsedTotal = Date.now() - startTime;
    if (elapsedTotal >= MATCHING_TOTAL_TIMEOUT_MS) {
      log.warn('Absolute timeout reached — exiting matching loop', {
        elapsedMs: elapsedTotal,
        timeoutMs: MATCHING_TOTAL_TIMEOUT_MS,
        tiersCompleted: tierConfig.tier - 1,
        offeredCount: offeredDriverIds.size,
      });
      return { matched: false, reason: 'timeout' };
    }

    log.info(`━━━ Tier ${tierConfig.tier} starting`, {
      tier: tierConfig.tier,
      radiusKm: tierConfig.radiusKm,
      maxCandidates: tierConfig.maxCandidates,
      waitSeconds: tierConfig.waitSeconds,
      offeredSoFar: offeredDriverIds.size,
    });

    // 2. Check delivery status at tier boundary — exit if cancelled (Req 13.1)
    const [delivery] = await log.time(`tier${tierConfig.tier}:db:check-delivery-status`, () =>
      db
        .select({ status: deliveries.status })
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId))
        .limit(1),
    );

    if (!delivery || delivery.status === 'cancelled') {
      log.warn('Delivery cancelled — cleaning up and exiting', {
        tier: tierConfig.tier,
        status: delivery?.status ?? 'NOT_FOUND',
      });
      await log.time('cleanup:cancelled-matching', () =>
        cleanupCancelledMatching(deliveryId),
      );
      return { matched: false, reason: 'all_declined' };
    }

    // 3. Find nearby drivers via Redis GEOSEARCH (Req 3.4 — radius expands per tier)
    const nearby = await log.time(`tier${tierConfig.tier}:redis:geosearch`, () =>
      findNearbyDrivers(pickupLng, pickupLat, tierConfig.radiusKm, { vehicleType }),
      { radiusKm: tierConfig.radiusKm, vehicleType },
    );

    log.debug(`Tier ${tierConfig.tier}: GEOSEARCH results`, {
      tier: tierConfig.tier,
      found: nearby.length,
      radiusKm: tierConfig.radiusKm,
    });

    // 4. Filter out already-offered drivers (Req 3.5 — no re-offering across tiers)
    const newCandidates = nearby.filter((d) => !offeredDriverIds.has(d.driverId));

    if (newCandidates.length === 0) {
      log.info(`Tier ${tierConfig.tier}: No new candidates after filtering — advancing`, {
        tier: tierConfig.tier,
        totalNearby: nearby.length,
        alreadyOffered: nearby.length - newCandidates.length,
        durationMs: Date.now() - tierStart,
      });
      continue;
    }

    log.info(`Tier ${tierConfig.tier}: New candidates found`, {
      tier: tierConfig.tier,
      newCandidates: newCandidates.length,
      filtered: nearby.length - newCandidates.length,
    });

    // 5. Enrich with DB stats for scoring
    const driverIds = newCandidates.map((d) => d.driverId);
    const stats = await log.time(`tier${tierConfig.tier}:db:load-driver-stats`, () =>
      db
        .select({
          id: drivers.id,
          acceptanceRate: drivers.acceptanceRate,
          completionRate: drivers.completionRate,
          rating: drivers.rating,
          lastJobCompletedAt: drivers.lastJobCompletedAt,
        })
        .from(drivers)
        .where(inArray(drivers.id, driverIds)),
      { driverCount: driverIds.length },
    );

    const statsMap = new Map(stats.map((s) => [s.id, s]));

    // 6. Build DriverCandidate array for scoring
    const candidates: DriverCandidate[] = newCandidates
      .filter((d) => statsMap.has(d.driverId))
      .map((d) => {
        const s = statsMap.get(d.driverId)!;
        return {
          driverId: d.driverId,
          distanceKm: d.distanceKm,
          acceptanceRate: s.acceptanceRate ?? 1.0,
          completionRate: s.completionRate ?? 1.0,
          rating: s.rating ?? 0,
          lastJobCompletedAt: s.lastJobCompletedAt?.getTime() ?? 0,
          headingTowardPickup: false,
        };
      });

    if (candidates.length === 0) {
      log.info(`Tier ${tierConfig.tier}: No candidates with DB stats — advancing`, {
        tier: tierConfig.tier,
        nearbyWithoutStats: newCandidates.length - candidates.length,
        durationMs: Date.now() - tierStart,
      });
      continue;
    }

    // 7. Score and select top N for this tier (Req 3.1, 3.2, 3.3)
    const scoringStart = Date.now();
    const scored = scoreDrivers(candidates, scoringWeights);
    const selected = scored.slice(0, tierConfig.maxCandidates);

    log.info(`Tier ${tierConfig.tier}: Drivers scored and selected`, {
      tier: tierConfig.tier,
      totalScored: scored.length,
      selected: selected.length,
      topScore: selected[0]?.score ?? 0,
      bottomScore: selected[selected.length - 1]?.score ?? 0,
      scoringMs: Date.now() - scoringStart,
    });

    // 8. Reserve each driver atomically (prevent double-assignment)
    const reservedDrivers: string[] = [];
    const reservationStart = Date.now();

    for (const driver of selected) {
      const result = await reserveDriver(driver.driverId, deliveryId);
      if (result.reserved) {
        reservedDrivers.push(driver.driverId);
        offeredDriverIds.add(driver.driverId);
      } else {
        log.debug(`Tier ${tierConfig.tier}: Reservation failed`, {
          tier: tierConfig.tier,
          driverId: driver.driverId.slice(0, 8),
          reason: 'reason' in result ? result.reason : 'unknown',
        });
      }
    }

    log.info(`Tier ${tierConfig.tier}: Reservations complete`, {
      tier: tierConfig.tier,
      reserved: reservedDrivers.length,
      attempted: selected.length,
      rejected: selected.length - reservedDrivers.length,
      durationMs: Date.now() - reservationStart,
    });

    if (reservedDrivers.length === 0) {
      log.info(`Tier ${tierConfig.tier}: All reservations failed — advancing`, {
        tier: tierConfig.tier,
        durationMs: Date.now() - tierStart,
      });
      continue;
    }

    // 9. Record offers and send notifications (Req 7.3, 8.1)
    await log.time(`tier${tierConfig.tier}:record-offers-notify`, () =>
      recordOffersAndNotify(job.data, reservedDrivers, scored, tierConfig.tier, log),
    );

    // 10. Wait for acceptance within tier timeout
    log.info(`Tier ${tierConfig.tier}: Waiting for driver acceptance`, {
      tier: tierConfig.tier,
      waitSeconds: tierConfig.waitSeconds,
      driversNotified: reservedDrivers.length,
    });

    const accepted = await waitForAcceptance(connection, deliveryId, tierConfig.waitSeconds * 1000);

    if (accepted) {
      const totalDurationMs = Date.now() - startTime;
      log.info(`★ MATCH FOUND — driver accepted`, {
        tier: tierConfig.tier,
        driverId: accepted,
        totalDurationMs,
        offeredTotal: offeredDriverIds.size,
      });
      return { matched: true, driverId: accepted, tier: tierConfig.tier };
    }

    // 11. Expire offers for this tier (Req 8.3)
    await log.time(`tier${tierConfig.tier}:expire-offers`, () =>
      expireOffers(deliveryId, tierConfig.tier),
    );

    // 12. Release reservations for this tier (drivers didn't accept in time)
    await log.time(`tier${tierConfig.tier}:release-reservations`, () =>
      releaseReservations(reservedDrivers),
      { count: reservedDrivers.length },
    );

    log.info(`Tier ${tierConfig.tier} complete — no acceptance`, {
      tier: tierConfig.tier,
      durationMs: Date.now() - tierStart,
      offeredThisTier: reservedDrivers.length,
      offeredTotal: offeredDriverIds.size,
    });
  }

  // All tiers exhausted — no match found (Req 3.6, 12.1)
  const totalDurationMs = Date.now() - startTime;

  // Self-drop is a surewaka_way (multi-leg) mechanism only: the customer drops
  // at the park so the downstream intercity/transfer/last-mile legs can still
  // proceed (Req 12.3). It is meaningless for a single-leg on-demand delivery,
  // where the first-mile leg IS the whole trip — there are no remaining legs to
  // keep active. Gate on the delivery's mode so on-demand no-matches fall
  // through to the cancel/routing_failed path (Req 3.6) instead.
  const [deliveryRow] = await log.time('db:load-delivery-mode', () =>
    db
      .select({ deliveryMode: deliveries.deliveryMode })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1),
  );
  const isSurewakaWay = deliveryRow?.deliveryMode === 'surewaka_way';

  if (job.data.legType === 'first_mile' && job.data.legId && isSurewakaWay) {
    log.warn('All tiers exhausted — triggering self-drop fallback', {
      totalDurationMs,
      offeredTotal: offeredDriverIds.size,
      legType: 'first_mile',
      legId: job.data.legId,
    });
    await log.time('fallback:self-drop', () =>
      triggerSelfDropFallback(
        deliveryId,
        job.data.legId!,
        job.data.customerId,
        'the park',
      ),
    );
    return { matched: false, reason: 'no_drivers' };
  } else {
    log.warn('All tiers exhausted — marking delivery routing_failed (no self-drop for this delivery)', {
      totalDurationMs,
      offeredTotal: offeredDriverIds.size,
      legType: job.data.legType,
      deliveryMode: deliveryRow?.deliveryMode ?? null,
    });
    await log.time('cancel:no-match', () =>
      cancelDeliveryNoMatch(deliveryId, job.data.customerId),
    );
    return { matched: false, reason: 'no_drivers' };
  }
}

// ─── Offer Recording & Notifications (Req 7.3, 8.1) ──────────────────────────

async function recordOffersAndNotify(
  jobData: MatchDriverJobData,
  reservedDriverIds: string[],
  scored: ScoredDriver[],
  tier: number,
  log: InstanceType<typeof import('../lib/logger').WorkerLogger>,
): Promise<void> {
  const { deliveryId } = jobData;

  const offerRows = reservedDriverIds.map((driverId) => {
    const driverScore = scored.find((s) => s.driverId === driverId);
    return {
      deliveryId,
      driverId,
      tier,
      score: driverScore?.score ?? 0,
      distanceKm: driverScore?.distanceKm ?? 0,
      status: 'pending' as const,
    };
  });

  // Insert offers into Postgres before sending notifications (Req 7.3)
  await log.time(`tier${tier}:db:insert-offers`, () =>
    db.insert(deliveryOffers).values(offerRows),
    { count: offerRows.length },
  );

  // Send push notifications to each reserved driver via Ably
  const ablyStart = Date.now();
  const realtime = createAblyProvider();
  let published = 0;

  for (const driverId of reservedDriverIds) {
    try {
      await realtime.publish(`driver-offers:${driverId}`, 'new-offer', {
        deliveryId,
        tier,
        pickupLng: jobData.pickupLng,
        pickupLat: jobData.pickupLat,
        vehicleType: jobData.vehicleType,
      });
      published++;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`Ably publish failed for driver`, {
        tier,
        driverId: driverId.slice(0, 8),
        error: error.message,
      });
    }
  }

  log.info(`Tier ${tier}: Notifications sent`, {
    tier,
    published,
    total: reservedDriverIds.length,
    durationMs: Date.now() - ablyStart,
  });
}

// ─── Offer Expiration (Req 8.3) ──────────────────────────────────────────────

async function expireOffers(deliveryId: string, tier: number): Promise<void> {
  await db
    .update(deliveryOffers)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(deliveryOffers.deliveryId, deliveryId),
        eq(deliveryOffers.tier, tier),
        eq(deliveryOffers.status, 'pending'),
      ),
    );
}

// ─── Cancel Delivery on Total Timeout (Req 3.6) ──────────────────────────────

async function cancelDeliveryNoMatch(deliveryId: string, customerId: string): Promise<void> {
  // Mark as routing_failed (not a bare 'cancelled') and notify the client, so
  // the matching-progress screen leaves its "Finding your driver" state and
  // shows the failed + retry affordance. Mirrors the retry-exhaustion path in
  // index.ts: routing_failed status + a 'matching-failed' event on the delivery
  // channel + a push. The confirmed screen already handles both signals.
  await db
    .update(deliveries)
    .set({ status: 'routing_failed', updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));

  try {
    await enqueuePushFromWorker(customerId, 'routing-failed', {
      title: 'Unable to find a driver',
      body: 'We could not match a driver for your delivery. Our team has been notified and will assist you shortly.',
      data: {
        type: 'routing-failed',
        resourceId: deliveryId,
        deepLink: `/deliveries`,
      },
    });
  } catch (err) {
    logger.error('Failed to enqueue routing-failed push', {
      deliveryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const realtime = createAblyProvider();
    await realtime.publish(`delivery:${deliveryId}`, 'matching-failed', { deliveryId });
    realtime.close();
  } catch (err) {
    logger.error('Failed to publish matching-failed event', {
      deliveryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
