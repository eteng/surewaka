// packages/db/src/seeds/ops-intelligence.ts
/**
 * Seed: Ops Intelligence — multi-leg deliveries for admin visual inspection.
 * Populates delivery_legs, delivery_events, driver_locations, delivery_ratings.
 *
 * Run: pnpm --filter @surewaka/db seed:ops
 * Prerequisites: DATABASE_URL set in root .env; seed-drivers.ts and seed-customers.ts run first.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { users } from '../schema/users';
import { drivers } from '../schema/drivers';
import { deliveries } from '../schema/deliveries';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');
const db = drizzle(neon(connectionString));

// ─── Fetch existing seeded data ───────────────────────────────────────────────

const allDrivers = await db.select().from(drivers).limit(8);
// Use raw SQL for carriers to avoid selecting schema columns not yet in the DB
const carriersResult = await db.execute(sql`SELECT id FROM carriers LIMIT 3`);
const allCarriers = carriersResult.rows as { id: string }[];
const allCustomers = await db
  .select()
  .from(users)
  .where(sql`role = 'customer'`)
  .limit(10);

if (allDrivers.length < 3) throw new Error('Run seed-drivers.ts first — need at least 3 drivers');
if (allCustomers.length < 3) throw new Error('Run seed-customers.ts first — need at least 3 customers');

const now = new Date();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const hrsAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

// ─── Lagos zone bounding coords (representative centroids) ───────────────────
const ZONE_COORDS: Record<string, { lat: number; lng: number; address: string }> = {
  Lekki:             { lat: 6.4457, lng: 3.4711, address: 'Lekki Phase 1, Lagos' },
  'Victoria Island': { lat: 6.4281, lng: 3.4219, address: 'Adeola Odeku St, Victoria Island' },
  Ikeja:             { lat: 6.6018, lng: 3.3515, address: 'Allen Avenue, Ikeja' },
  Surulere:          { lat: 6.5059, lng: 3.3506, address: 'Bode Thomas Street, Surulere' },
  Mainland:          { lat: 6.5244, lng: 3.3792, address: 'Yaba, Lagos Mainland' },
  Island:            { lat: 6.4531, lng: 3.3958, address: 'Lagos Island, Lagos' },
};

// ─── Helper ───────────────────────────────────────────────────────────────────
async function insertDelivery(
  customerId: string,
  status: string,
  pickupZone: string,
  dropoffZone: string,
  overrides: Record<string, unknown> = {},
) {
  const pickup = ZONE_COORDS[pickupZone] ?? ZONE_COORDS['Mainland'];
  const dropoff = ZONE_COORDS[dropoffZone] ?? ZONE_COORDS['Island'];
  const [d] = await db
    .insert(deliveries)
    .values({
      id: randomUUID(),
      customerId,
      status: status as any,
      pickupAddress: pickup.address,
      pickupCity: 'Lagos',
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropoffAddress: dropoff.address,
      dropoffCity: dropoffZone === 'intercity' ? 'Abuja' : 'Lagos',
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      packageDescription: 'Parcel — clothing items',
      packageWeight: 2,
      packageCategory: 'parcel',
      recipientName: 'Ngozi Eze',
      recipientPhone: '+2348012345678',
      paymentStatus: 'escrowed',
      ...overrides,
    })
    .returning();
  return d;
}

// ─── 1. Active intra-city — on track ─────────────────────────────────────────
console.log('Seeding: active on-track delivery (Lekki → VI)...');
const d1 = await insertDelivery(allCustomers[0].id, 'en_route_dropoff', 'Lekki', 'Victoria Island', {
  driverId: allDrivers[0].id,
  systemEtaAt: new Date(now.getTime() + 20 * 60_000), // ETA 20 min from now
});

// Delivery events for d1
// triggered_by references users.id — use driver's userId (FK: delivery_events.triggered_by -> users.id)
await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d1.id}, NULL, 'pending', 'accepted', ${allDrivers[0].userId}, ${minsAgo(45).toISOString()}),
    (${d1.id}, NULL, 'accepted', 'en_route_pickup', ${allDrivers[0].userId}, ${minsAgo(40).toISOString()}),
    (${d1.id}, NULL, 'en_route_pickup', 'arrived_pickup', ${allDrivers[0].userId}, ${minsAgo(30).toISOString()}),
    (${d1.id}, NULL, 'arrived_pickup', 'picked_up', ${allDrivers[0].userId}, ${minsAgo(25).toISOString()}),
    (${d1.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[0].userId}, ${minsAgo(20).toISOString()})
`);

// Live driver location pings for d1
await db.execute(sql`
  INSERT INTO driver_locations (driver_id, delivery_id, lat, lng, recorded_at)
  VALUES
    (${allDrivers[0].id}, ${d1.id}, 6.4400, 3.4500, ${minsAgo(5).toISOString()}),
    (${allDrivers[0].id}, ${d1.id}, 6.4350, 3.4450, ${minsAgo(3).toISOString()}),
    (${allDrivers[0].id}, ${d1.id}, 6.4300, 3.4350, ${minsAgo(1).toISOString()})
`);

// ─── 2. OVERDUE delivery — past ETA by 45 minutes ────────────────────────────
console.log('Seeding: overdue delivery (Ikeja → Surulere)...');
const d2 = await insertDelivery(allCustomers[1].id, 'en_route_dropoff', 'Ikeja', 'Surulere', {
  driverId: allDrivers[1].id,
  systemEtaAt: minsAgo(45), // ETA was 45 minutes ago — overdue
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d2.id}, NULL, 'pending', 'accepted', ${allDrivers[1].userId}, ${hrsAgo(2).toISOString()}),
    (${d2.id}, NULL, 'accepted', 'picked_up', ${allDrivers[1].userId}, ${hrsAgo(1.5).toISOString()}),
    (${d2.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[1].userId}, ${hrsAgo(1).toISOString()})
`);

// Driver location pings — still moving, but late
await db.execute(sql`
  INSERT INTO driver_locations (driver_id, delivery_id, lat, lng, recorded_at)
  VALUES
    (${allDrivers[1].id}, ${d2.id}, 6.5300, 3.3600, ${minsAgo(8).toISOString()}),
    (${allDrivers[1].id}, ${d2.id}, 6.5200, 3.3550, ${minsAgo(4).toISOString()}),
    (${allDrivers[1].id}, ${d2.id}, 6.5100, 3.3520, ${minsAgo(2).toISOString()})
`);

// ─── 3. DRIVER SILENT — no GPS ping for 22 minutes ───────────────────────────
console.log('Seeding: driver-silent delivery (Mainland → Island)...');
const d3 = await insertDelivery(allCustomers[2].id, 'en_route_dropoff', 'Mainland', 'Island', {
  driverId: allDrivers[2].id,
  systemEtaAt: new Date(now.getTime() + 10 * 60_000),
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d3.id}, NULL, 'pending', 'accepted', ${allDrivers[2].userId}, ${hrsAgo(1).toISOString()}),
    (${d3.id}, NULL, 'accepted', 'picked_up', ${allDrivers[2].userId}, ${minsAgo(40).toISOString()}),
    (${d3.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[2].userId}, ${minsAgo(30).toISOString()})
`);

// Last GPS ping was 22 minutes ago — triggers driver silent warning
await db.execute(sql`
  INSERT INTO driver_locations (driver_id, delivery_id, lat, lng, recorded_at)
  VALUES
    (${allDrivers[2].id}, ${d3.id}, 6.4700, 3.3900, ${minsAgo(22).toISOString()})
`);

// ─── 4. COMPLETED delivery with rating ───────────────────────────────────────
console.log('Seeding: completed delivery with rating (Surulere → Lekki)...');
const d4 = await insertDelivery(allCustomers[0].id, 'delivered', 'Surulere', 'Lekki', {
  driverId: allDrivers[0].id,
  systemEtaAt: hrsAgo(2),
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d4.id}, NULL, 'pending', 'accepted', ${allDrivers[0].userId}, ${hrsAgo(4).toISOString()}),
    (${d4.id}, NULL, 'accepted', 'picked_up', ${allDrivers[0].userId}, ${hrsAgo(3.5).toISOString()}),
    (${d4.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[0].userId}, ${hrsAgo(3).toISOString()}),
    (${d4.id}, NULL, 'en_route_dropoff', 'delivered', ${allDrivers[0].userId}, ${hrsAgo(2.1).toISOString()})
`);

await db.execute(sql`
  INSERT INTO delivery_ratings (delivery_id, driver_id, customer_id, rating, comment, created_at)
  VALUES (${d4.id}, ${allDrivers[0].id}, ${allCustomers[0].id}, 5, 'Very fast and professional!', ${hrsAgo(2).toISOString()})
`);

// ─── 5. FAILED delivery with failure attribution ──────────────────────────────
console.log('Seeding: failed delivery with driver attribution (Ikeja)...');
const d5 = await insertDelivery(allCustomers[1].id, 'failed', 'Ikeja', 'Victoria Island', {
  driverId: allDrivers[1].id,
  systemEtaAt: hrsAgo(1),
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, failure_cause, failure_note, created_at)
  VALUES
    (${d5.id}, NULL, 'pending', 'accepted', ${allDrivers[1].userId}, NULL, NULL, ${hrsAgo(3).toISOString()}),
    (${d5.id}, NULL, 'accepted', 'failed', ${allDrivers[1].userId}, 'driver', 'Driver could not locate pickup address', ${hrsAgo(1).toISOString()})
`);

// ─── 6. MULTI-LEG intercity delivery — Leg 1 complete, Leg 2 in transit ──────
console.log('Seeding: intercity delivery (Lagos → Abuja, 2 legs active)...');
const d6 = await insertDelivery(allCustomers[2].id, 'en_route_dropoff', 'Mainland', 'Mainland', {
  dropoffCity: 'Abuja',
  systemEtaAt: new Date(now.getTime() + 20 * 3_600_000), // ETA 20 hours from now
});

// Leg 1: first_mile — completed
const leg1Id = randomUUID();
await db.execute(sql`
  INSERT INTO delivery_legs (id, delivery_id, leg_number, leg_type, actor_type, actor_id, pickup_address, pickup_lat, pickup_lng, pickup_zone, dropoff_address, dropoff_lat, dropoff_lng, dropoff_zone, status, system_eta_at, sla_hours, started_at, completed_at, created_at)
  VALUES (
    ${leg1Id}, ${d6.id}, 1, 'first_mile', 'driver', ${allDrivers[2].id},
    'Yaba, Lagos Mainland', 6.5244, 3.3792, 'Mainland',
    'Ojota Park, Lagos', 6.5690, 3.3903, 'Mainland',
    'delivered', ${minsAgo(30).toISOString()}, 1,
    ${hrsAgo(2).toISOString()}, ${minsAgo(30).toISOString()}, ${hrsAgo(3).toISOString()}
  )
`);

// Leg 2: intercity carrier — in progress
const leg2Id = randomUUID();
if (allCarriers.length > 0) {
  await db.execute(sql`
    INSERT INTO delivery_legs (id, delivery_id, leg_number, leg_type, actor_type, actor_id, pickup_address, pickup_lat, pickup_lng, pickup_zone, dropoff_address, dropoff_lat, dropoff_lng, dropoff_zone, status, system_eta_at, sla_hours, started_at, created_at)
    VALUES (
      ${leg2Id}, ${d6.id}, 2, 'intercity', 'carrier', ${allCarriers[0].id},
      'Ojota Park, Lagos', 6.5690, 3.3903, 'Mainland',
      'Utako, Abuja', 9.0765, 7.4983, 'Other',
      'en_route_dropoff', ${new Date(now.getTime() + 18 * 3_600_000).toISOString()}, 24,
      ${minsAgo(25).toISOString()}, ${minsAgo(25).toISOString()}
    )
  `);
}

// ─── 7. Additional completed deliveries for analytics trend data ──────────────
console.log('Seeding: 8 historical completed deliveries for analytics...');
const historicalDeliveries = [
  { customer: 0, driver: 0, from: 'Lekki', to: 'Victoria Island', hrsBack: 6, rating: 4 },
  { customer: 1, driver: 1, from: 'Ikeja', to: 'Mainland', hrsBack: 8, rating: 5 },
  { customer: 2, driver: 2, from: 'Surulere', to: 'Island', hrsBack: 12, rating: 3 },
  { customer: 0, driver: 0, from: 'Mainland', to: 'Lekki', hrsBack: 24, rating: 5 },
  { customer: 1, driver: 1, from: 'Victoria Island', to: 'Ikeja', hrsBack: 26, rating: 4 },
  { customer: 2, driver: 2, from: 'Lekki', to: 'Surulere', hrsBack: 30, rating: 4 },
  { customer: 0, driver: 0, from: 'Island', to: 'Mainland', hrsBack: 48, rating: 5 },
  { customer: 1, driver: 1, from: 'Ikeja', to: 'Victoria Island', hrsBack: 50, rating: 2 },
];

for (const h of historicalDeliveries) {
  const hd = await insertDelivery(
    allCustomers[h.customer % allCustomers.length].id,
    'delivered',
    h.from,
    h.to,
    {
      driverId: allDrivers[h.driver % allDrivers.length].id,
      systemEtaAt: hrsAgo(h.hrsBack - 1),
    },
  );
  await db.execute(sql`
    INSERT INTO delivery_events (delivery_id, from_status, to_status, triggered_by, created_at)
    VALUES
      (${hd.id}, 'pending', 'accepted', ${allDrivers[h.driver % allDrivers.length].userId}, ${hrsAgo(h.hrsBack + 1.5).toISOString()}),
      (${hd.id}, 'accepted', 'picked_up', ${allDrivers[h.driver % allDrivers.length].userId}, ${hrsAgo(h.hrsBack + 1).toISOString()}),
      (${hd.id}, 'picked_up', 'delivered', ${allDrivers[h.driver % allDrivers.length].userId}, ${hrsAgo(h.hrsBack).toISOString()})
  `);
  await db.execute(sql`
    INSERT INTO delivery_ratings (delivery_id, driver_id, customer_id, rating, created_at)
    VALUES (${hd.id}, ${allDrivers[h.driver % allDrivers.length].id}, ${allCustomers[h.customer % allCustomers.length].id}, ${h.rating}, ${hrsAgo(h.hrsBack - 0.5).toISOString()})
  `);
}

console.log('✓ Ops intelligence seed complete.');
console.log('  Active deliveries: 3 (1 on-track, 1 overdue, 1 driver-silent)');
console.log('  Completed deliveries: 9 (1 with rating, 8 historical)');
console.log('  Failed deliveries: 1 (driver attribution)');
console.log('  Multi-leg intercity: 1 (2 legs)');
console.log('  Open admin at http://localhost:3001 to inspect.');
