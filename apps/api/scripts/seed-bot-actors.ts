#!/usr/bin/env npx tsx
/**
 * Actor Simulator — Bot Identity Bootstrap
 *
 * Creates real, Clerk-authenticated bot accounts (driver + carrier_driver
 * role) so the actor simulator (scripts/simulate-actors.ts) can drive them
 * through the real, auth-guarded API — no mock auth, no bypass.
 *
 * Usage:
 *   pnpm --filter @surewaka/api seed:bot-actors -- --drivers 5 --carriers 1
 *   pnpm --filter @surewaka/api seed:bot-actors -- --reset
 *
 * Idempotent: only tops up the shortfall between what exists and the
 * requested counts. Bot accounts are identified solely by the
 * `bot+*@example.com` email convention — no schema change.
 *
 * Requires CLERK_SECRET_KEY (a *test* instance — this script refuses to run
 * against a live one) and DATABASE_URL, both already in apps/api/.env /
 * root .env for local dev. `--carriers > 0` also requires at least one
 * active carrier already seeded (`pnpm --filter @surewaka/db seed:carriers`).
 *
 * See .kiro/specs/actor-simulator/ for the full design.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { db, users, drivers, carriers, carrierMembers, userRoles } from '@surewaka/db';
import { getClerkClient } from '@surewaka/auth';
import { assignRole, revokeRole } from '../src/services/role-service.ts';

// ─── Bot identity conventions ──────────────────────────────────────────────
// Kept in sync by hand with scripts/lib/bot-identity.ts (used by the
// simulator CLI). Not imported directly — this file lives inside the
// apps/api package ("type": "module") while scripts/lib/ sits outside any
// package.json declaring a module type, and pnpm's workspace node_modules
// layout means a plain relative import across that boundary breaks Node's
// CJS/ESM interop (named exports silently fail to resolve). Duplicating
// ~15 lines here is simpler and more reliable than working around that.

const BOT_EMAIL_LIKE = 'bot+%@example.com';
const driverBotEmail = (n: number): string => `bot+driver-${n}@example.com`;
const carrierBotEmail = (n: number): string => `bot+carrier-${n}@example.com`;

const LAGOS_BOT_START_POINTS: { lat: number; lng: number; label: string }[] = [
  { lat: 6.6018, lng: 3.3515, label: 'Ikeja' },
  { lat: 6.4483, lng: 3.4746, label: 'Lekki Phase 1' },
  { lat: 6.5095, lng: 3.3711, label: 'Yaba' },
  { lat: 6.5, lng: 3.3548, label: 'Surulere' },
  { lat: 6.4281, lng: 3.4219, label: 'Victoria Island' },
  { lat: 6.4698, lng: 3.5852, label: 'Ajah' },
  { lat: 6.6432, lng: 3.3089, label: 'Agege' },
  { lat: 6.55, lng: 3.36, label: 'Ikoyi' },
];

const BOT_VEHICLE_TYPES = ['motorcycle', 'car', 'van', 'truck'] as const;

// ─── Args ───────────────────────────────────────────────────────────────────

type Args = { drivers: number; carriers: number; reset: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const idx = argv.indexOf(`--${name}`);
    return idx === -1 ? fallback : (argv[idx + 1] ?? fallback);
  };
  return {
    drivers: Number(get('drivers', '5')),
    carriers: Number(get('carriers', '1')),
    reset: argv.includes('--reset'),
  };
}

// ─── Safety guard — dev/test only ─────────────────────────────────────────

function assertSafeEnv(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run: NODE_ENV=production. The actor simulator is dev/test-only.');
    process.exit(1);
  }
  const clerkKey = process.env.CLERK_SECRET_KEY ?? '';
  if (!clerkKey) {
    console.error('❌ Missing CLERK_SECRET_KEY.');
    process.exit(1);
  }
  if (clerkKey.startsWith('sk_live_')) {
    console.error(
      '❌ Refusing to run: CLERK_SECRET_KEY looks like a live Clerk instance (sk_live_...). ' +
        'The actor simulator must only run against a test/dev Clerk instance.',
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL.');
    process.exit(1);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Clerk validates phone numbers against real-world assigned ranges (E.164 +
// carrier prefix validity), so an obviously-fake prefix like 0900 is
// rejected. Use a real Nigerian mobile prefix (MTN's 803) with a
// seed-derived suffix instead — still clearly a test number, just one Clerk
// will accept.
function botPhone(seed: number): { local: string; e164: string } {
  const suffix = String(1000000 + seed).padStart(7, '0').slice(-7);
  return { local: `0803${suffix}`, e164: `+234803${suffix}` };
}

type ExistingBotUser = { id: string; clerkId: string };

async function getExistingBotUsers(): Promise<Map<string, ExistingBotUser>> {
  const rows = await db
    .select({ id: users.id, email: users.email, clerkId: users.clerkId })
    .from(users)
    .where(like(users.email, BOT_EMAIL_LIKE));
  const map = new Map<string, ExistingBotUser>();
  for (const r of rows) {
    if (r.email) map.set(r.email, { id: r.id, clerkId: r.clerkId });
  }
  return map;
}

async function hasActiveRole(userId: string, role: 'driver' | 'carrier_driver'): Promise<boolean> {
  const [row] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role), eq(userRoles.isActive, true)))
    .limit(1);
  return !!row;
}

// ─── Driver bots ────────────────────────────────────────────────────────────

async function ensureDriverBots(count: number): Promise<void> {
  const existing = await getExistingBotUsers();
  const clerk = getClerkClient();
  let created = 0;
  let reactivated = 0;

  for (let n = 1; n <= count; n++) {
    const email = driverBotEmail(n);
    const existingUser = existing.get(email);

    if (existingUser) {
      if (await hasActiveRole(existingUser.id, 'driver')) continue; // already fully set up

      // Survived a --reset (revoked, not deleted — see resetBots) — revive it
      // rather than creating a duplicate account for the same email slot.
      const point = LAGOS_BOT_START_POINTS[(n - 1) % LAGOS_BOT_START_POINTS.length];
      await db
        .update(drivers)
        .set({ available: false, verified: true, lat: point.lat, lng: point.lng })
        .where(eq(drivers.userId, existingUser.id));

      const result = await assignRole({
        userId: existingUser.id,
        role: 'driver',
        assignedBy: existingUser.id,
        assignedByRoles: ['surewaka_admin'],
        reason: 'Actor simulator bootstrap (reactivate)',
      });

      if (result.error) {
        console.error(`  ✗ driver-bot-${n}: reactivation failed — ${result.error.message}`);
        continue;
      }

      reactivated++;
      console.log(`  ↻ driver-bot-${n} (${email}) reactivated`);
      continue;
    }

    const phone = botPhone(n);
    const clerkUser = await clerk.users.createUser({
      emailAddress: [email],
      phoneNumber: [phone.e164],
      password: randomUUID(),
      skipPasswordChecks: true,
      firstName: 'Bot',
      lastName: `Driver ${n}`,
    });

    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      clerkId: clerkUser.id,
      name: `Bot Driver ${n}`,
      phone: phone.local,
      email,
      role: 'driver',
      verified: true,
    });

    const point = LAGOS_BOT_START_POINTS[(n - 1) % LAGOS_BOT_START_POINTS.length];
    const vehicleType = BOT_VEHICLE_TYPES[(n - 1) % BOT_VEHICLE_TYPES.length];

    await db.insert(drivers).values({
      id: randomUUID(),
      userId,
      vehicleType,
      licensePlate: `BOT-${String(n).padStart(3, '0')}`,
      vehicleModel: 'Simulated Vehicle',
      verified: true,
      available: false,
      rating: 5,
      lat: point.lat,
      lng: point.lng,
    });

    // This script runs with local, trusted, human-operator intent — same
    // standing as an admin action — so it self-assigns via assignRole rather
    // than requiring a pre-existing surewaka_admin row to attribute it to.
    const result = await assignRole({
      userId,
      role: 'driver',
      assignedBy: userId,
      assignedByRoles: ['surewaka_admin'],
      reason: 'Actor simulator bootstrap',
    });

    if (result.error) {
      console.error(`  ✗ driver-bot-${n}: role assignment failed — ${result.error.message}`);
      continue;
    }

    created++;
    console.log(`  + driver-bot-${n} (${email}) @ ${point.label}`);
  }

  if (created > 0) console.log(`✅ Created ${created} driver bot(s)`);
  if (reactivated > 0) console.log(`↻ Reactivated ${reactivated} driver bot(s)`);
  if (created === 0 && reactivated === 0) console.log('ℹ️  All requested driver bots already active');
}

// ─── Carrier bots ───────────────────────────────────────────────────────────

async function ensureCarrierBots(count: number): Promise<void> {
  if (count <= 0) return;

  const [carrier] = await db
    .select({ id: carriers.id, name: carriers.name })
    .from(carriers)
    .where(eq(carriers.isActive, true))
    .limit(1);

  if (!carrier) {
    console.error(
      '❌ No active carrier found — run `pnpm --filter @surewaka/db seed:carriers` first, then retry.',
    );
    process.exit(1);
  }

  const existing = await getExistingBotUsers();
  const clerk = getClerkClient();
  let created = 0;
  let reactivated = 0;

  for (let n = 1; n <= count; n++) {
    const email = carrierBotEmail(n);
    const existingUser = existing.get(email);

    if (existingUser) {
      if (await hasActiveRole(existingUser.id, 'carrier_driver')) continue; // already fully set up

      await db
        .update(carrierMembers)
        .set({ isActive: true, carrierId: carrier.id })
        .where(eq(carrierMembers.userId, existingUser.id));

      const result = await assignRole({
        userId: existingUser.id,
        role: 'carrier_driver',
        assignedBy: existingUser.id,
        assignedByRoles: ['surewaka_admin'],
        scopeType: 'carrier',
        scopeId: carrier.id,
        reason: 'Actor simulator bootstrap (reactivate)',
      });

      if (result.error) {
        console.error(`  ✗ carrier-bot-${n}: reactivation failed — ${result.error.message}`);
        continue;
      }

      reactivated++;
      console.log(`  ↻ carrier-bot-${n} (${email}) reactivated`);
      continue;
    }

    const phone = botPhone(1000 + n);
    const clerkUser = await clerk.users.createUser({
      emailAddress: [email],
      phoneNumber: [phone.e164],
      password: randomUUID(),
      skipPasswordChecks: true,
      firstName: 'Bot',
      lastName: `Carrier ${n}`,
    });

    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      clerkId: clerkUser.id,
      name: `Bot Carrier ${n}`,
      phone: phone.local,
      email,
      role: 'carrier_driver',
      verified: true,
    });

    await db.insert(carrierMembers).values({
      id: randomUUID(),
      carrierId: carrier.id,
      userId,
      role: 'carrier_driver',
      isActive: true,
    });

    const result = await assignRole({
      userId,
      role: 'carrier_driver',
      assignedBy: userId,
      assignedByRoles: ['surewaka_admin'],
      scopeType: 'carrier',
      scopeId: carrier.id,
      reason: 'Actor simulator bootstrap',
    });

    if (result.error) {
      console.error(`  ✗ carrier-bot-${n}: role assignment failed — ${result.error.message}`);
      continue;
    }

    created++;
    console.log(`  + carrier-bot-${n} (${email}) → ${carrier.name}`);
  }

  if (created > 0) console.log(`✅ Created ${created} carrier bot(s)`);
  if (reactivated > 0) console.log(`↻ Reactivated ${reactivated} carrier bot(s)`);
  if (created === 0 && reactivated === 0) console.log('ℹ️  All requested carrier bots already active');
}

// ─── Reset ──────────────────────────────────────────────────────────────────

/**
 * Deactivates every bot account rather than hard-deleting it: revokes its
 * `driver`/`carrier_driver` role (which syncs Clerk `publicMetadata` back to
 * `['customer']`, so it can no longer pass `requireRole` checks) and marks
 * its `drivers`/`carrier_members` row inactive.
 *
 * This is deliberately non-destructive. `role_audit_log` references every
 * user who has ever had a role (un)assigned via a NOT NULL, non-cascading
 * FK — by design, so audit history survives even if the user is later
 * removed — which means a bot's `users` row can never actually be deleted
 * once `assignRole` has run for it. Trying anyway silently leaves orphaned
 * rows (see git history of this file for the broken first attempt). Revoking
 * is safe, avoids fighting that constraint, and is fully reversible: the
 * next bootstrap run's reactivation path (see ensureDriverBots/
 * ensureCarrierBots) brings a deactivated bot straight back.
 */
async function resetBots(): Promise<void> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(like(users.email, BOT_EMAIL_LIKE));

  if (rows.length === 0) {
    console.log('ℹ️  No bot accounts found.');
    return;
  }

  let deactivated = 0;

  for (const row of rows) {
    const [driver] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, row.id)).limit(1);
    if (driver) {
      await db.update(drivers).set({ available: false }).where(eq(drivers.id, driver.id));
      await revokeRole({ userId: row.id, role: 'driver', revokedBy: row.id, reason: 'Actor simulator reset' });
    }

    const [member] = await db
      .select({ carrierId: carrierMembers.carrierId })
      .from(carrierMembers)
      .where(eq(carrierMembers.userId, row.id))
      .limit(1);
    if (member) {
      await db.update(carrierMembers).set({ isActive: false }).where(eq(carrierMembers.userId, row.id));
      await revokeRole({
        userId: row.id,
        role: 'carrier_driver',
        revokedBy: row.id,
        scopeId: member.carrierId,
        reason: 'Actor simulator reset',
      });
    }

    deactivated++;
    console.log(`  − ${row.email} deactivated`);
  }

  console.log(`\n✅ Reset complete — ${deactivated} bot(s) deactivated (run again without --reset to revive them)`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertSafeEnv();
  const args = parseArgs();

  if (args.reset) {
    console.log('🧹 Resetting bot actors...\n');
    await resetBots();
    return;
  }

  console.log(`🤖 Bootstrapping actor simulator bots — ${args.drivers} driver(s), ${args.carriers} carrier(s)\n`);
  await ensureDriverBots(args.drivers);
  await ensureCarrierBots(args.carriers);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});
