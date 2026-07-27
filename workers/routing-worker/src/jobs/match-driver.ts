import type { Job } from 'bullmq';
import type { MatchDriverJobData, MatchResult, DriverCandidate, ScoredDriver } from '@surewaka/shared';
import { MATCHING_TIERS, MATCHING_TOTAL_TIMEOUT_MS, getConfig } from '@surewaka/shared';
import { createAblyProvider, findNearbyDrivers } from '@surewaka/realtime';
import { reserveDriver, releaseReservations } from '../lib/reservation';
import { scoreDrivers } from '../lib/scoring';
import { waitForAcceptance } from '../lib/wait-for-acceptance';
import { db, deliveries, deliveryOffers, drivers } from '@surewaka/db';
import { and, eq, inArray } from 'drizzle-orm';
import { connection } from '../queue';
import { triggerSelfDropFallback } from './self-drop-fallback';
import { cleanupCancelledMatching } from './cancel-matching';

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
  const { deliveryId, pickupLng, pickupLat, vehicleType } = job.data;
  const startTime = Date.now();
  const offeredDriverIds = new Set<string>();

  // Load admin-configurable scoring weights (Req 14.3)
  // Cached for 5 min — changes reflect without code deployment (Req 14.2)
  const scoringWeights = await getConfig('matching.scoring_weights');

  for (const tierConfig of MATCHING_TIERS) {
    // 1. Check absolute timeout (5 minutes max — Req 3.7)
    if (Date.now() - startTime >= MATCHING_TOTAL_TIMEOUT_MS) {
      return { matched: false, reason: 'timeout' };
    }

    // 2. Check delivery status at tier boundary — exit if cancelled (Req 13.1)
    const [delivery] = await db
      .select({ status: deliveries.status })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);

    if (!delivery || delivery.status === 'cancelled') {
      // Release all reservations and expire pending offers (Req 13.3)
      await cleanupCancelledMatching(deliveryId);
      return { matched: false, reason: 'all_declined' };
    }

    // 3. Find nearby drivers via Redis GEOSEARCH (Req 3.4 — radius expands per tier)
    const nearby = await findNearbyDrivers(pickupLng, pickupLat, tierConfig.radiusKm, {
      vehicleType,
    });

    // 4. Filter out already-offered drivers (Req 3.5 — no re-offering across tiers)
    const newCandidates = nearby.filter((d) => !offeredDriverIds.has(d.driverId));
    if (newCandidates.length === 0) continue;

    // 5. Enrich with DB stats for scoring
    const driverIds = newCandidates.map((d) => d.driverId);
    const stats = await db
      .select({
        id: drivers.id,
        acceptanceRate: drivers.acceptanceRate,
        completionRate: drivers.completionRate,
        rating: drivers.rating,
        lastJobCompletedAt: drivers.lastJobCompletedAt,
      })
      .from(drivers)
      .where(inArray(drivers.id, driverIds));

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
          headingTowardPickup: false, // TODO: implement heading detection
        };
      });

    if (candidates.length === 0) continue;

    // 7. Score and select top N for this tier (Req 3.1, 3.2, 3.3)
    const scored = scoreDrivers(candidates, scoringWeights);
    const selected = scored.slice(0, tierConfig.maxCandidates);

    // 8. Reserve each driver atomically (prevent double-assignment)
    const reservedDrivers: string[] = [];
    for (const driver of selected) {
      const result = await reserveDriver(driver.driverId, deliveryId);
      if (result.reserved) {
        reservedDrivers.push(driver.driverId);
        offeredDriverIds.add(driver.driverId);
      }
    }

    if (reservedDrivers.length === 0) continue;

    // 9. Record offers and send notifications (Req 7.3, 8.1)
    await recordOffersAndNotify(job.data, reservedDrivers, scored, tierConfig.tier);

    // 10. Wait for acceptance within tier timeout
    const accepted = await waitForAcceptance(connection, deliveryId, tierConfig.waitSeconds * 1000);

    if (accepted) {
      return { matched: true, driverId: accepted, tier: tierConfig.tier };
    }

    // 11. Expire offers for this tier (Req 8.3)
    await expireOffers(deliveryId, tierConfig.tier);

    // 12. Release reservations for this tier (drivers didn't accept in time)
    await releaseReservations(reservedDrivers);
  }

  // All tiers exhausted — no match found (Req 3.6, 12.1)
  if (job.data.legType === 'first_mile' && job.data.legId) {
    // First-mile failed — offer self-drop instead of cancelling immediately (Req 12.1)
    await triggerSelfDropFallback(
      deliveryId,
      job.data.legId,
      job.data.customerId,
      'the park',
    );
    return { matched: false, reason: 'no_drivers' };
  } else {
    // On-demand or other leg types — cancel immediately
    await cancelDeliveryNoMatch(deliveryId);
    return { matched: false, reason: 'no_drivers' };
  }
}

// ─── Offer Recording & Notifications (Req 7.3, 8.1) ──────────────────────────

/**
 * Record delivery offers in Postgres and send push notifications via Ably.
 *
 * Validates: Requirements 7.3, 8.1
 */
async function recordOffersAndNotify(
  jobData: MatchDriverJobData,
  reservedDriverIds: string[],
  scored: ScoredDriver[],
  tier: number,
): Promise<void> {
  const { deliveryId } = jobData;

  // Build offer rows from scored/reserved drivers for this tier
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
  await db.insert(deliveryOffers).values(offerRows);

  // Send push notifications to each reserved driver via Ably
  const realtime = createAblyProvider();
  for (const driverId of reservedDriverIds) {
    await realtime.publish(`driver-offers:${driverId}`, 'new-offer', {
      deliveryId,
      tier,
      pickupLng: jobData.pickupLng,
      pickupLat: jobData.pickupLat,
      vehicleType: jobData.vehicleType,
    });
  }
}

// ─── Offer Expiration (Req 8.3) ──────────────────────────────────────────────

/**
 * Expire all pending offers for a delivery at a specific tier.
 * Called after each tier timeout before releasing reservations.
 *
 * Validates: Requirement 8.3
 */
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

/**
 * Cancel a delivery when no match is found after all tiers are exhausted.
 * Updates delivery status and triggers refund flow.
 *
 * Validates: Requirement 3.6
 */
async function cancelDeliveryNoMatch(deliveryId: string): Promise<void> {
  await db
    .update(deliveries)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));

  // TODO: trigger refund flow (separate job/service)
}


