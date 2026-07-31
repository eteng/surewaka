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
import { latLngToCell } from 'h3-js';
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

/** H3 resolution 7 ≈ 5.16 km² per hex — good for intra-city matching */
const H3_RESOLUTION = 7;

// Returns the inserted or existing park ID.
async function upsertPark(park: {
  carrierId: string;
  city: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}): Promise<string> {
  const h3Index = latLngToCell(park.lat, park.lng, H3_RESOLUTION);

  // Insert with h3_index, silently skip if (carrierId, name) already exists.
  await db.insert(carrierParks).values({ ...park, h3Index }).onConflictDoNothing();

  // Fetch the row to get its id (whether just inserted or pre-existing).
  const rows = await db
    .select({ id: carrierParks.id, h3Index: carrierParks.h3Index })
    .from(carrierParks)
    .where(and(eq(carrierParks.carrierId, park.carrierId), eq(carrierParks.name, park.name)))
    .limit(1);

  if (!rows[0]) throw new Error(`Failed to upsert park: ${park.name}`);

  // Backfill h3_index if the park already existed with an empty value
  if (!rows[0].h3Index || rows[0].h3Index === '') {
    await db.update(carrierParks)
      .set({ h3Index, updatedAt: new Date() })
      .where(eq(carrierParks.id, rows[0].id));
  }

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

async function seedRedStarExpress() {
  const carrier = await findCarrierBySlug('red-star-express');
  if (!carrier) {
    console.log('\n  info  Red Star Express not found — skipping.');
    return;
  }

  console.log(`\n  carrier  ${carrier.name} (${carrier.id})`);

  console.log('\n  Inserting parks...');

  const lagosId = await upsertPark({
    carrierId: carrier.id,
    city: 'Lagos',
    name: 'Red Star Express Lagos, Jibowu',
    address: '10 Ikorodu Road, Jibowu, Yaba, Lagos',
    lat: 6.5122,
    lng: 3.3745,
  });
  console.log(`    park  Lagos   → ${lagosId}`);

  const abujaId = await upsertPark({
    carrierId: carrier.id,
    city: 'Abuja',
    name: 'Red Star Express Abuja, Wuse',
    address: 'Plot 238 Wuse Zone 5, Abuja',
    lat: 9.0579,
    lng: 7.4951,
  });
  console.log(`    park  Abuja   → ${abujaId}`);

  const phId = await upsertPark({
    carrierId: carrier.id,
    city: 'Port Harcourt',
    name: 'Red Star Express PH, Rumuomasi',
    address: '55 Aba Road, Rumuomasi, Port Harcourt',
    lat: 4.8225,
    lng: 7.0132,
  });
  console.log(`    park  PH      → ${phId}`);

  const ibadanId = await upsertPark({
    carrierId: carrier.id,
    city: 'Ibadan',
    name: 'Red Star Express Ibadan, Challenge',
    address: 'Challenge Bus Stop, Ring Road, Ibadan',
    lat: 7.3598,
    lng: 3.8731,
  });
  console.log(`    park  Ibadan  → ${ibadanId}`);

  console.log('\n  Inserting routes...');

  const lagosAbujaId = await upsertRoute({ carrierId: carrier.id, originParkId: lagosId, destinationParkId: abujaId, basePriceKobo: 2200000, estimatedTransitHrs: 7, maxWeightKg: 30 });
  const abujaLagosId = await upsertRoute({ carrierId: carrier.id, originParkId: abujaId, destinationParkId: lagosId, basePriceKobo: 2200000, estimatedTransitHrs: 7, maxWeightKg: 30 });
  const lagosIbadanId = await upsertRoute({ carrierId: carrier.id, originParkId: lagosId, destinationParkId: ibadanId, basePriceKobo: 800000, estimatedTransitHrs: 2, maxWeightKg: 30 });
  const ibadanLagosId = await upsertRoute({ carrierId: carrier.id, originParkId: ibadanId, destinationParkId: lagosId, basePriceKobo: 800000, estimatedTransitHrs: 2, maxWeightKg: 30 });
  const lagosPHId = await upsertRoute({ carrierId: carrier.id, originParkId: lagosId, destinationParkId: phId, basePriceKobo: 1800000, estimatedTransitHrs: 6, maxWeightKg: 30 });
  const phLagosId = await upsertRoute({ carrierId: carrier.id, originParkId: phId, destinationParkId: lagosId, basePriceKobo: 1800000, estimatedTransitHrs: 6, maxWeightKg: 30 });

  console.log(`    route  Lagos ↔ Abuja         ₦22,000`);
  console.log(`    route  Lagos ↔ Ibadan        ₦8,000`);
  console.log(`    route  Lagos ↔ Port Harcourt ₦18,000`);

  console.log('\n  Inserting schedules (07:00 + 15:00 WAT daily)...');
  const DAILY = [
    { hour: 7, minute: 0, daysOfWeek: [] as number[] },
    { hour: 15, minute: 0, daysOfWeek: [] as number[] },
  ];
  for (const routeId of [lagosAbujaId, abujaLagosId, lagosIbadanId, ibadanLagosId, lagosPHId, phLagosId]) {
    await seedSchedules(routeId, DAILY);
  }
  console.log('    Done (12 schedules)');
}

async function seedKwikDelivery() {
  const carrier = await findCarrierBySlug('kwik-delivery');
  if (!carrier) {
    console.log('\n  info  Kwik Delivery not found — skipping.');
    return;
  }

  console.log(`\n  carrier  ${carrier.name} (${carrier.id})`);
  console.log('\n  Inserting parks (intra-Lagos hubs)...');

  const yabaParkId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Kwik Hub Yaba', address: '45 Herbert Macaulay Way, Yaba, Lagos', lat: 6.5095, lng: 3.3731 });
  const lekkiParkId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Kwik Hub Lekki Phase 1', address: '12 Admiralty Way, Lekki Phase 1, Lagos', lat: 6.4488, lng: 3.4730 });
  const ikejaParkId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Kwik Hub Ikeja', address: '20 Allen Avenue, Ikeja, Lagos', lat: 6.5970, lng: 3.3515 });
  const viParkId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Kwik Hub Victoria Island', address: '8 Kofo Abayomi Street, Victoria Island, Lagos', lat: 6.4281, lng: 3.4219 });
  const sururlereParkId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Kwik Hub Surulere', address: '15 Adeniran Ogunsanya Street, Surulere, Lagos', lat: 6.4969, lng: 3.3574 });

  console.log(`    5 parks created/verified`);

  console.log('\n  Inserting intra-Lagos routes...');

  const routes: [string, string, string, string, number, number][] = [
    ['Yaba', 'Lekki', yabaParkId, lekkiParkId, 250000, 1.5],
    ['Lekki', 'Yaba', lekkiParkId, yabaParkId, 250000, 1.5],
    ['Yaba', 'Ikeja', yabaParkId, ikejaParkId, 180000, 1],
    ['Ikeja', 'Yaba', ikejaParkId, yabaParkId, 180000, 1],
    ['Ikeja', 'Lekki', ikejaParkId, lekkiParkId, 350000, 2],
    ['Lekki', 'Ikeja', lekkiParkId, ikejaParkId, 350000, 2],
    ['Yaba', 'VI', yabaParkId, viParkId, 200000, 1],
    ['VI', 'Yaba', viParkId, yabaParkId, 200000, 1],
    ['VI', 'Lekki', viParkId, lekkiParkId, 150000, 0.5],
    ['Lekki', 'VI', lekkiParkId, viParkId, 150000, 0.5],
    ['Surulere', 'Yaba', sururlereParkId, yabaParkId, 150000, 0.5],
    ['Yaba', 'Surulere', yabaParkId, sururlereParkId, 150000, 0.5],
    ['Surulere', 'Ikeja', sururlereParkId, ikejaParkId, 200000, 1],
    ['Ikeja', 'Surulere', ikejaParkId, sururlereParkId, 200000, 1],
    ['Surulere', 'VI', sururlereParkId, viParkId, 250000, 1.5],
    ['VI', 'Surulere', viParkId, sururlereParkId, 250000, 1.5],
  ];

  for (const [origin, dest, originId, destId, price, hrs] of routes) {
    await upsertRoute({ carrierId: carrier.id, originParkId: originId, destinationParkId: destId, basePriceKobo: price, estimatedTransitHrs: hrs, maxWeightKg: 20 });
    console.log(`    route  ${origin.padEnd(10)} → ${dest.padEnd(10)} ₦${(price / 100).toLocaleString()}`);
  }

  console.log('  (No schedules — Kwik is on-demand last-mile)');
}

async function seedSendbox() {
  const carrier = await findCarrierBySlug('sendbox');
  if (!carrier) {
    console.log('\n  info  Sendbox not found — skipping.');
    return;
  }

  console.log(`\n  carrier  ${carrier.name} (${carrier.id})`);
  console.log('\n  Inserting parks...');

  const gbagadaId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Sendbox Hub Gbagada', address: '22 Diya Street, Gbagada, Lagos', lat: 6.5523, lng: 3.3892 });
  const lekkiId = await upsertPark({ carrierId: carrier.id, city: 'Lagos', name: 'Sendbox Hub Lekki', address: '3 Fola Osibo Street, Lekki Phase 1, Lagos', lat: 6.4512, lng: 3.4718 });
  const abujaId = await upsertPark({ carrierId: carrier.id, city: 'Abuja', name: 'Sendbox Hub Garki', address: 'Area 11, Garki, Abuja', lat: 9.0227, lng: 7.4842 });

  console.log(`    3 parks created/verified`);
  console.log('\n  Inserting routes...');

  // Intra-Lagos
  await upsertRoute({ carrierId: carrier.id, originParkId: gbagadaId, destinationParkId: lekkiId, basePriceKobo: 200000, estimatedTransitHrs: 1, maxWeightKg: 25 });
  await upsertRoute({ carrierId: carrier.id, originParkId: lekkiId, destinationParkId: gbagadaId, basePriceKobo: 200000, estimatedTransitHrs: 1, maxWeightKg: 25 });
  console.log(`    route  Gbagada ↔ Lekki       ₦2,000`);

  // Lagos ↔ Abuja
  const lagosAbujaId = await upsertRoute({ carrierId: carrier.id, originParkId: gbagadaId, destinationParkId: abujaId, basePriceKobo: 1500000, estimatedTransitHrs: 8, maxWeightKg: 25 });
  const abujaLagosId = await upsertRoute({ carrierId: carrier.id, originParkId: abujaId, destinationParkId: gbagadaId, basePriceKobo: 1500000, estimatedTransitHrs: 8, maxWeightKg: 25 });
  console.log(`    route  Lagos ↔ Abuja         ₦15,000`);

  console.log('\n  Inserting schedules (09:00 WAT Mon–Sat)...');
  const MON_TO_SAT = [1, 2, 3, 4, 5, 6];
  const SCHEDULES = [{ hour: 9, minute: 0, daysOfWeek: MON_TO_SAT }];
  await seedSchedules(lagosAbujaId, SCHEDULES);
  await seedSchedules(abujaLagosId, SCHEDULES);
  console.log('    Done (2 schedules)');
}

async function main() {
  console.log('Seeding carrier routing data (parks, routes, schedules)...');

  await seedGigLogistics();
  await seedRedStarExpress();
  await seedKwikDelivery();
  await seedSendbox();

  console.log('\n✅ Done — all carriers seeded.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
