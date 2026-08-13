/**
 * Actor Simulator — driver bot state machine.
 *
 * One bot = one loop: idle (pinging location, watching for an offer) →
 * accept/ignore decision → walk the leg through its real status sequence
 * with GPS interpolated toward pickup then dropoff → back to idle.
 *
 * Discovery (which offer is mine, which leg did I get) is read-only DB
 * polling. Every state-changing action — location pings, accept, leg status
 * — goes through the real authenticated API via apiFetch, never a direct
 * write. See .kiro/specs/actor-simulator/design.md, Component 3.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db, deliveryOffers, deliveryLegs } from '@surewaka/db';
import { haversineKm } from '@surewaka/shared';
import { apiFetch, type BotSession } from './bot-session.ts';
import { sleep, randomBetween } from './util.ts';

const LOCATION_PING_INTERVAL_MS = 2_000; // matches the API's own rate limit
const BASELINE_SPEED_KMH = 25; // plausible urban driving speed at --speed 1
const MIN_TRAVEL_MS = 3_000; // floor so even very short hops are observable
const ARRIVAL_PAUSE_MS = 5_000; // "confirming pickup/dropoff" dwell time

/** Mirrors ALLOWED_LEG_STATUSES in apps/api/src/routes/delivery-legs.ts. */
const LEG_STATUS_SEQUENCE = [
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
] as const;

export type DriverBotConfig = {
  label: string; // e.g. "driver-bot-1", used to prefix log lines
  driverId: string;
  startLat: number;
  startLng: number;
};

export type DriverBotOptions = {
  speed: number;
  acceptRate: number;
  signal: AbortSignal;
  log?: (line: string) => void;
};

type Point = { lat: number; lng: number };

/** Runs the bot until `options.signal` aborts. */
export async function runDriverBot(
  session: BotSession,
  bot: DriverBotConfig,
  options: DriverBotOptions,
): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(`[${bot.label}] ${line}`));
  let pos: Point = { lat: bot.startLat, lng: bot.startLng };

  while (!options.signal.aborted) {
    try {
      const offer = await idleUntilOffer(session, bot, pos, options);
      if (!offer) break; // aborted while idle

      await sleep(randomBetween(500, 2000) / options.speed, options.signal);
      if (options.signal.aborted) break;

      if (Math.random() >= options.acceptRate) {
        log(`ignored offer for delivery ${offer.deliveryId}`);
        continue;
      }

      const acceptResult = await apiFetch<{ matched: boolean }>(
        session,
        `/api/v1/deliveries/${offer.deliveryId}/accept`,
        { method: 'POST' },
      );

      if (!acceptResult.ok) {
        log(`accept failed for delivery ${offer.deliveryId}: ${acceptResult.error?.message ?? acceptResult.status}`);
        continue;
      }
      if (!acceptResult.data.matched) {
        log(`lost the race for delivery ${offer.deliveryId}`);
        continue;
      }
      log(`accepted delivery ${offer.deliveryId}`);

      const leg = await findAssignedLeg(bot.driverId, offer.deliveryId);
      if (!leg) {
        log(`accepted delivery ${offer.deliveryId} but couldn't find its assigned leg — skipping`);
        continue;
      }

      pos = await runLeg(session, bot, leg, pos, options, log);
    } catch (err) {
      // A DB hiccup (Postgres momentarily unreachable, etc.) shouldn't take
      // down the whole simulator — log it and keep this bot's loop going.
      log(`unexpected error, retrying: ${err instanceof Error ? err.message : err}`);
      await sleep(2_000, options.signal);
    }
  }
}

// ─── Idle ───────────────────────────────────────────────────────────────────

type PendingOffer = { id: string; deliveryId: string };

async function idleUntilOffer(
  session: BotSession,
  bot: DriverBotConfig,
  pos: Point,
  options: DriverBotOptions,
): Promise<PendingOffer | null> {
  while (!options.signal.aborted) {
    await apiFetch(session, '/api/v1/driver/location', {
      method: 'POST',
      body: { lat: pos.lat, lng: pos.lng },
    });

    const [offer] = await db
      .select({ id: deliveryOffers.id, deliveryId: deliveryOffers.deliveryId })
      .from(deliveryOffers)
      .where(and(eq(deliveryOffers.driverId, bot.driverId), eq(deliveryOffers.status, 'pending')))
      .orderBy(asc(deliveryOffers.offeredAt))
      .limit(1);

    if (offer) return offer;
    await sleep(LOCATION_PING_INTERVAL_MS, options.signal);
  }
  return null;
}

// ─── Leg lookup ─────────────────────────────────────────────────────────────

type AssignedLeg = {
  id: string;
  deliveryId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
};

async function findAssignedLeg(driverId: string, deliveryId: string): Promise<AssignedLeg | null> {
  const [leg] = await db
    .select({
      id: deliveryLegs.id,
      deliveryId: deliveryLegs.deliveryId,
      pickupLat: deliveryLegs.pickupLat,
      pickupLng: deliveryLegs.pickupLng,
      dropoffLat: deliveryLegs.dropoffLat,
      dropoffLng: deliveryLegs.dropoffLng,
    })
    .from(deliveryLegs)
    .where(
      and(
        eq(deliveryLegs.deliveryId, deliveryId),
        eq(deliveryLegs.actorType, 'driver'),
        eq(deliveryLegs.actorId, driverId),
        eq(deliveryLegs.isActive, true),
      ),
    )
    .limit(1);
  return leg ?? null;
}

// ─── Leg progression ────────────────────────────────────────────────────────

async function runLeg(
  session: BotSession,
  bot: DriverBotConfig,
  leg: AssignedLeg,
  startPos: Point,
  options: DriverBotOptions,
  log: (line: string) => void,
): Promise<Point> {
  await setLegStatus(session, leg, 'accepted', log);
  await setLegStatus(session, leg, 'en_route_pickup', log);

  let pos = await travelTo(session, bot, leg, startPos, { lat: leg.pickupLat, lng: leg.pickupLng }, options);
  await setLegStatus(session, leg, 'arrived_pickup', log);
  await sleep(ARRIVAL_PAUSE_MS / options.speed, options.signal);
  await setLegStatus(session, leg, 'picked_up', log);

  await setLegStatus(session, leg, 'en_route_dropoff', log);
  pos = await travelTo(session, bot, leg, pos, { lat: leg.dropoffLat, lng: leg.dropoffLng }, options);
  await setLegStatus(session, leg, 'arrived_dropoff', log);
  await sleep(ARRIVAL_PAUSE_MS / options.speed, options.signal);
  await setLegStatus(session, leg, 'delivered', log);

  return pos;
}

async function setLegStatus(
  session: BotSession,
  leg: { id: string; deliveryId: string },
  status: (typeof LEG_STATUS_SEQUENCE)[number],
  log: (line: string) => void,
): Promise<void> {
  const result = await apiFetch(session, `/api/v1/deliveries/${leg.deliveryId}/legs/${leg.id}/status`, {
    method: 'PATCH',
    body: { status },
  });
  if (!result.ok) {
    log(`failed to set leg ${leg.id} → ${status}: ${result.error?.message ?? result.status}`);
    return;
  }
  log(`leg ${leg.id} → ${status}`);
}

/** Interpolates position toward `to`, pinging location every 2s, until arrival or abort. */
async function travelTo(
  session: BotSession,
  bot: DriverBotConfig,
  leg: { deliveryId: string },
  from: Point,
  to: Point,
  options: DriverBotOptions,
): Promise<Point> {
  const distanceKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
  const travelMs = Math.max(MIN_TRAVEL_MS, ((distanceKm / BASELINE_SPEED_KMH) * 3_600_000) / options.speed);
  const startedAt = Date.now();

  while (!options.signal.aborted) {
    const fraction = Math.min(1, (Date.now() - startedAt) / travelMs);
    const pos: Point = {
      lat: from.lat + (to.lat - from.lat) * fraction,
      lng: from.lng + (to.lng - from.lng) * fraction,
    };
    await apiFetch(session, '/api/v1/driver/location', {
      method: 'POST',
      body: { lat: pos.lat, lng: pos.lng, deliveryId: leg.deliveryId },
    });
    if (fraction >= 1) return pos;
    await sleep(LOCATION_PING_INTERVAL_MS, options.signal);
  }
  return to;
}
