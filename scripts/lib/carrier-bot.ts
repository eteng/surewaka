/**
 * Actor Simulator — carrier bot state machine.
 *
 * Simpler than the driver bot: no offer/accept step. Carrier legs get their
 * real `actor_id` (the carrier) at route-creation time, not a NIL_UUID
 * placeholder like driver legs — so any `carrier_driver` on that carrier can
 * act on them per `requireLegActor`. The bot just watches for its carrier's
 * legs that are ready (the previous leg, if any, already `delivered`) and
 * walks them through the same real status sequence a driver leg uses, via
 * the same PATCH endpoint. No location pings — carrier legs aren't rendered
 * on a live map today.
 *
 * See .kiro/specs/actor-simulator/design.md, Component 4.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db, deliveryLegs } from '@surewaka/db';
import { apiFetch, type BotSession } from './bot-session.ts';
import { sleep } from './util.ts';

const POLL_INTERVAL_MS = 2_000;
const STATUS_PAUSE_MS = 4_000; // dwell between status transitions at --speed 1

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

export type CarrierBotConfig = {
  label: string;
  carrierId: string;
};

export type CarrierBotOptions = {
  speed: number;
  signal: AbortSignal;
  log?: (line: string) => void;
  /**
   * Leg ids currently claimed by *any* carrier bot in this simulator run —
   * shared across all carrier bots on the same carrier so two of them never
   * both grab the same leg. The caller (the CLI) owns this Set's lifetime.
   */
  claimedLegIds: Set<string>;
};

/** Runs the bot until `options.signal` aborts. */
export async function runCarrierBot(
  session: BotSession,
  bot: CarrierBotConfig,
  options: CarrierBotOptions,
): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(`[${bot.label}] ${line}`));

  while (!options.signal.aborted) {
    try {
      const leg = await findClaimableLeg(bot.carrierId, options.claimedLegIds);
      if (!leg) {
        await sleep(POLL_INTERVAL_MS, options.signal);
        continue;
      }

      options.claimedLegIds.add(leg.id);
      log(`claimed leg ${leg.id} for delivery ${leg.deliveryId}`);
      await runLeg(session, leg, options, log);
    } catch (err) {
      // A DB hiccup (Postgres momentarily unreachable, etc.) shouldn't take
      // down the whole simulator — log it and keep this bot's loop going.
      log(`unexpected error, retrying: ${err instanceof Error ? err.message : err}`);
      await sleep(2_000, options.signal);
    }
  }
}

// ─── Discovery ──────────────────────────────────────────────────────────────

type ClaimableLeg = { id: string; deliveryId: string; legNumber: number };

async function findClaimableLeg(carrierId: string, claimed: ReadonlySet<string>): Promise<ClaimableLeg | null> {
  const legs = await db
    .select({
      id: deliveryLegs.id,
      deliveryId: deliveryLegs.deliveryId,
      legNumber: deliveryLegs.legNumber,
      status: deliveryLegs.status,
    })
    .from(deliveryLegs)
    .where(and(eq(deliveryLegs.actorType, 'carrier'), eq(deliveryLegs.actorId, carrierId), eq(deliveryLegs.isActive, true)))
    .orderBy(asc(deliveryLegs.legNumber));

  for (const leg of legs) {
    if (claimed.has(leg.id) || leg.status === 'delivered') continue;
    if (await precedingLegDelivered(leg.deliveryId, leg.legNumber)) return leg;
  }
  return null;
}

/** True if there's no prior leg (legNumber 1) or the prior leg is already delivered. */
async function precedingLegDelivered(deliveryId: string, legNumber: number): Promise<boolean> {
  if (legNumber <= 1) return true;
  const [prev] = await db
    .select({ status: deliveryLegs.status })
    .from(deliveryLegs)
    .where(and(eq(deliveryLegs.deliveryId, deliveryId), eq(deliveryLegs.legNumber, legNumber - 1)))
    .limit(1);
  return !prev || prev.status === 'delivered';
}

// ─── Leg progression ────────────────────────────────────────────────────────

async function runLeg(
  session: BotSession,
  leg: ClaimableLeg,
  options: CarrierBotOptions,
  log: (line: string) => void,
): Promise<void> {
  for (const status of LEG_STATUS_SEQUENCE) {
    if (options.signal.aborted) return;

    const result = await apiFetch(session, `/api/v1/deliveries/${leg.deliveryId}/legs/${leg.id}/status`, {
      method: 'PATCH',
      body: { status },
    });

    if (!result.ok) {
      log(`failed to set leg ${leg.id} → ${status}: ${result.error?.message ?? result.status}`);
      return;
    }
    log(`leg ${leg.id} → ${status}`);
    await sleep(STATUS_PAUSE_MS / options.speed, options.signal);
  }
}
