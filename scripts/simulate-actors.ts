#!/usr/bin/env npx tsx
/**
 * Actor Simulator — CLI entry point.
 *
 * Runs a pool of bot drivers and bot carrier-agents as concurrent, real
 * Clerk-authenticated state machines against the local API, so a delivery
 * booked for real (e.g. from the mobile-customer app on a phone) gets
 * matched, accepted, and progressed to delivered without you needing to
 * run a second device.
 *
 * Usage:
 *   pnpm sim:actors -- --drivers 5 --carriers 1 --speed 5 --accept-rate 0.9
 *
 * Requires `pnpm dev` (or at least apps/api + its workers + Redis/Postgres)
 * already running. Bot identities are ensured (created/topped up/reactivated)
 * automatically before the bots start — see apps/api/scripts/seed-bot-actors.ts.
 *
 * See .kiro/specs/actor-simulator/design.md, Component 5.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, like } from 'drizzle-orm';
import { db, users, drivers, carrierMembers, userRoles } from '@surewaka/db';
import { createBotSession } from './lib/bot-session.ts';
import { runDriverBot } from './lib/driver-bot.ts';
import { runCarrierBot } from './lib/carrier-bot.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─── Args ───────────────────────────────────────────────────────────────────

type Args = { drivers: number; carriers: number; speed: number; acceptRate: number };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const idx = argv.indexOf(`--${name}`);
    return idx === -1 ? fallback : (argv[idx + 1] ?? fallback);
  };
  return {
    drivers: Number(get('drivers', '5')),
    carriers: Number(get('carriers', '1')),
    speed: Number(get('speed', '1')),
    acceptRate: Number(get('accept-rate', '0.9')),
  };
}

// ─── Bootstrap (spawned — lives in a different package, see seed-bot-actors.ts) ──

function ensureBotsBootstrapped(drivers: number, carriers: number): Promise<void> {
  console.log(`Ensuring ${drivers} driver bot(s) and ${carriers} carrier bot(s) are active...\n`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'pnpm',
      ['--filter', '@surewaka/api', 'seed:bot-actors', '--', '--drivers', String(drivers), '--carriers', String(carriers)],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Bot bootstrap exited with code ${code}`));
    });
  });
}

// ─── Loading bot identities ─────────────────────────────────────────────────

type LoadedDriverBot = { label: string; clerkId: string; driverId: string; lat: number; lng: number };
type LoadedCarrierBot = { label: string; clerkId: string; carrierId: string };

async function loadDriverBots(count: number): Promise<LoadedDriverBot[]> {
  const rows = await db
    .select({
      email: users.email,
      clerkId: users.clerkId,
      driverId: drivers.id,
      lat: drivers.lat,
      lng: drivers.lng,
    })
    .from(users)
    .innerJoin(drivers, eq(drivers.userId, users.id))
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'driver'), eq(userRoles.isActive, true)))
    .where(like(users.email, 'bot+driver-%@example.com'));

  return rows
    .filter((r) => r.lat != null && r.lng != null)
    .slice(0, count)
    .map((r, i) => ({
      label: `driver-bot-${i + 1}`,
      clerkId: r.clerkId,
      driverId: r.driverId,
      lat: r.lat as number,
      lng: r.lng as number,
    }));
}

async function loadCarrierBots(count: number): Promise<LoadedCarrierBot[]> {
  const rows = await db
    .select({
      email: users.email,
      clerkId: users.clerkId,
      carrierId: carrierMembers.carrierId,
    })
    .from(users)
    .innerJoin(carrierMembers, eq(carrierMembers.userId, users.id))
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'carrier_driver'), eq(userRoles.isActive, true)))
    .where(like(users.email, 'bot+carrier-%@example.com'));

  return rows.slice(0, count).map((r, i) => ({
    label: `carrier-bot-${i + 1}`,
    clerkId: r.clerkId,
    carrierId: r.carrierId,
  }));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `Actor Simulator — drivers=${args.drivers} carriers=${args.carriers} speed=${args.speed}x accept-rate=${args.acceptRate}\n`,
  );

  await ensureBotsBootstrapped(args.drivers, args.carriers);

  const [driverBots, carrierBots] = await Promise.all([loadDriverBots(args.drivers), loadCarrierBots(args.carriers)]);

  if (driverBots.length < args.drivers) {
    console.warn(`⚠ Only ${driverBots.length}/${args.drivers} driver bots available (role assignment may have failed above)`);
  }
  if (carrierBots.length < args.carriers) {
    console.warn(`⚠ Only ${carrierBots.length}/${args.carriers} carrier bots available`);
  }

  const controller = new AbortController();
  process.on('SIGINT', () => {
    console.log('\nShutting down — letting in-flight requests finish...');
    controller.abort();
  });

  const claimedLegIds = new Set<string>(); // shared across carrier bots on the same carrier

  // Each bot's run is isolated: one bot failing to even start (e.g. its
  // Clerk session can't be created) must not take down every other bot via
  // Promise.all — it's caught, logged, and that bot simply sits out.
  const driverRuns = driverBots.map(async (bot) => {
    try {
      const session = await createBotSession(bot.clerkId);
      await runDriverBot(
        session,
        { label: bot.label, driverId: bot.driverId, startLat: bot.lat, startLng: bot.lng },
        { speed: args.speed, acceptRate: args.acceptRate, signal: controller.signal },
      );
    } catch (err) {
      console.error(`[${bot.label}] failed to start: ${err instanceof Error ? err.message : err}`);
    }
  });

  const carrierRuns = carrierBots.map(async (bot) => {
    try {
      const session = await createBotSession(bot.clerkId);
      await runCarrierBot(
        session,
        { label: bot.label, carrierId: bot.carrierId },
        { speed: args.speed, signal: controller.signal, claimedLegIds },
      );
    } catch (err) {
      console.error(`[${bot.label}] failed to start: ${err instanceof Error ? err.message : err}`);
    }
  });

  console.log(`\nRunning ${driverBots.length} driver bot(s) and ${carrierBots.length} carrier bot(s). Ctrl+C to stop.\n`);
  await Promise.all([...driverRuns, ...carrierRuns]);
  console.log('\nAll bots stopped.');
}

main().catch((err) => {
  console.error('Actor Simulator failed:', err);
  process.exit(1);
});
