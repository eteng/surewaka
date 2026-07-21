/**
 * Seed script: Insert carrier parks, routes, and departure schedules.
 *
 * Run: pnpm --filter @surewaka/db seed:routing
 *
 * Prerequisites:
 * - DATABASE_URL set in root .env
 * - carriers, carrier_parks, carrier_routes, carrier_route_schedules tables must exist
 * - Run seed:carriers first to populate the carriers table
 *
 * Safe to run multiple times — uses onConflictDoNothing() for parks and routes;
 * skips schedule insertion if schedules already exist for a route.
 *
 * City values match the zones table exactly (title case: 'Lagos', 'Abuja', 'Port Harcourt').
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { carriers } from '../schema/carriers';
import { carrierParks } from '../schema/carrier-parks';
import { carrierRoutes } from '../schema/carrier-routes';
import { carrierRouteSchedules } from '../schema/carrier-route-schedules';
import { eq, and } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set in root .env');

const db = drizzle(neon(connectionString));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findCarrierBySlug(slug: string) {
  const rows = await db
    .select({ id: carriers.id, name: carriers.name })
    .from(carriers)
    .where(eq(carriers.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

// Returns the inserted or existing park ID.
async function upsertPark(park: {
  carrierId: string;
  city: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}): Promise<string> {
  // Insert, silently skip if (carrierId, name) already exists.
  await db.insert(carrierParks).values(park).onConflictDoNothing();

  // Fetch the row to get its id (whether just inserted or pre-existing).
  const rows = await db
    .select({ id: carrierParks.id })
    .from(carrierParks)
    .where(and(eq(carrierParks.carrierId, park.carrierId), eq(carrierParks.name, park.name)))
    .limit(1);

  if (!rows[0]) throw new Error(`Failed to upsert park: ${park.name}`);
  return rows[0].id;
}

// Returns the inserted or existing route ID.
async function upsertRoute(route: {
  carrierId: string;
  originParkId: string;
  destinationParkId: string;
  basePriceKobo: number;
  estimatedTransitHrs: number;
  maxWeightKg: number;
}): Promise<string> {
  await db.insert(carrierRoutes).values(route).onConflictDoNothing();

  const rows = await db
    .select({ id: carrierRoutes.id })
    .from(carrierRoutes)
    .where(
      and(
        eq(carrierRoutes.carrierId, route.carrierId),
        eq(carrierRoutes.originParkId, route.originParkId),
        eq(carrierRoutes.destinationParkId, route.destinationParkId),
      ),
    )
    .limit(1);

  if (!rows[0]) throw new Error(`Failed to upsert route: ${route.originParkId} → ${route.destinationParkId}`);
  return rows[0].id;
}

// Inserts schedules only if none already exist for this route.
async function seedSchedules(routeId: string, schedules: { hour: number; minute: number; daysOfWeek: number[] }[]) {
  const existing = await db
    .select({ id: carrierRouteSchedules.id })
    .from(carrierRouteSchedules)
    .where(eq(carrierRouteSchedules.carrierRouteId, routeId))
    .limit(1);

  if (existing.length > 0) {
    return { inserted: 0, skipped: schedules.length };
  }

  await db.insert(carrierRouteSchedules).values(
    schedules.map((s) => ({
      carrierRouteId: routeId,
      hour: s.hour,
      minute: s.minute,
      daysOfWeek: s.daysOfWeek,
    })),
  );

  return { inserted: schedules.length, skipped: 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedGigLogistics() {
  // The carrier is seeded as 'GIG Logistics' with slug 'gig-logistics'.
  const carrier = await findCarrierBySlug('gig-logistics');
  if (!carrier) {
    console.warn('  warn  GIG Logistics not found in carriers table — run seed:carriers first, skipping.');
    return;
  }

  console.log(`\n  carrier  ${carrier.name} (${carrier.id})`);

  // ── Parks ──────────────────────────────────────────────────────────────────

  console.log('\n  Inserting parks...');

  const lagosId = await upsertPark({
    carrierId: carrier.id,
    city: 'Lagos',
    name: 'GIG Express Lagos Terminal, Jibowu',
    address: '7 Ikorodu Road, Jibowu, Lagos',
    lat: 6.5095,
    lng: 3.3711,
  });
  console.log(`    park  Lagos   → ${lagosId}`);

  const abujaId = await upsertPark({
    carrierId: carrier.id,
    city: 'Abuja',
    name: 'GIG Express Abuja Terminal, Utako',
    address: 'Plot 1547 Cadastral Zone, Utako, Abuja',
    lat: 9.0643,
    lng: 7.4892,
  });
  console.log(`    park  Abuja   → ${abujaId}`);

  const phId = await upsertPark({
    carrierId: carrier.id,
    city: 'Port Harcourt',
    name: 'GIG Express Port Harcourt Terminal, Rumuola',
    address: '34 Rumuola Road, Port Harcourt',
    lat: 4.8156,
    lng: 7.0498,
  });
  console.log(`    park  PH      → ${phId}`);

  // ── Routes ─────────────────────────────────────────────────────────────────

  console.log('\n  Inserting routes...');

  const DAILY_SCHEDULES = [
    { hour: 6, minute: 0, daysOfWeek: [] as number[] },
    { hour: 14, minute: 0, daysOfWeek: [] as number[] },
  ];

  // Lagos ↔ Abuja
  const lagosAbujaId = await upsertRoute({
    carrierId: carrier.id,
    originParkId: lagosId,
    destinationParkId: abujaId,
    basePriceKobo: 1800000, // ₦18,000
    estimatedTransitHrs: 6,
    maxWeightKg: 50,
  });
  console.log(`    route  Lagos → Abuja       → ${lagosAbujaId}`);

  const abujaLagosId = await upsertRoute({
    carrierId: carrier.id,
    originParkId: abujaId,
    destinationParkId: lagosId,
    basePriceKobo: 1800000,
    estimatedTransitHrs: 6,
    maxWeightKg: 50,
  });
  console.log(`    route  Abuja → Lagos       → ${abujaLagosId}`);

  // Lagos ↔ Port Harcourt
  const lagosPHId = await upsertRoute({
    carrierId: carrier.id,
    originParkId: lagosId,
    destinationParkId: phId,
    basePriceKobo: 1500000, // ₦15,000
    estimatedTransitHrs: 5,
    maxWeightKg: 50,
  });
  console.log(`    route  Lagos → Port Harcourt → ${lagosPHId}`);

  const phLagosId = await upsertRoute({
    carrierId: carrier.id,
    originParkId: phId,
    destinationParkId: lagosId,
    basePriceKobo: 1500000,
    estimatedTransitHrs: 5,
    maxWeightKg: 50,
  });
  console.log(`    route  Port Harcourt → Lagos → ${phLagosId}`);

  // ── Schedules ──────────────────────────────────────────────────────────────

  console.log('\n  Inserting schedules (06:00 WAT + 14:00 WAT daily)...');

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const [label, routeId] of [
    ['Lagos → Abuja', lagosAbujaId],
    ['Abuja → Lagos', abujaLagosId],
    ['Lagos → Port Harcourt', lagosPHId],
    ['Port Harcourt → Lagos', phLagosId],
  ] as [string, string][]) {
    const { inserted, skipped } = await seedSchedules(routeId, DAILY_SCHEDULES);
    const action = skipped > 0 ? 'skip' : 'added';
    console.log(`    sched  ${label.padEnd(26)} ${action} ${inserted > 0 ? inserted : skipped} schedule(s)`);
    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(`\n  Schedules: ${totalInserted} inserted, ${totalSkipped} skipped.`);
}

async function seedSecondCarrier() {
  // Try to find a second intercity-capable carrier from the seeded set.
  // Red Star Express is a well-known Nigerian intercity carrier.
  const carrier = await findCarrierBySlug('red-star-express');
  if (!carrier) {
    console.log('\n  info  No second carrier found (red-star-express not seeded) — skipping.');
    return;
  }
  console.log(`\n  carrier  ${carrier.name} found — no intercity parks/routes defined for this carrier in this seed.`);
  console.log('           Add specific park/route/schedule data here when ready.');
}

async function main() {
  console.log('Seeding carrier routing data (parks, routes, schedules)...');

  await seedGigLogistics();
  await seedSecondCarrier();

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
