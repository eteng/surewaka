import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, like } from 'drizzle-orm';
import { users } from '../schema/users';
import { drivers } from '../schema/drivers';
import { deliveries } from '../schema/deliveries';
import { deliveryEvents } from '../schema/delivery-events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../../.env') });

// ─── Constants ────────────────────────────────────────────────────────────────

const SEED_MARKER = '[SEED]';

type DeliveryStatus =
  | 'draft' | 'pending' | 'accepted'
  | 'en_route_pickup' | 'arrived_pickup' | 'picked_up'
  | 'en_route_dropoff' | 'arrived_dropoff'
  | 'delivered' | 'cancelled' | 'failed' | 'returned';

type FailureCause = 'driver' | 'carrier' | 'route_traffic' | 'system';

// Full happy-path sequence
const STATUS_SEQUENCE: DeliveryStatus[] = [
  'draft', 'pending', 'accepted',
  'en_route_pickup', 'arrived_pickup', 'picked_up',
  'en_route_dropoff', 'arrived_dropoff', 'delivered',
];

// Minutes between each status transition (min, max)
const TRANSITION_MINUTES: Record<string, [number, number]> = {
  'draft→pending':            [0, 3],
  'pending→accepted':         [3, 20],
  'accepted→en_route_pickup': [1, 8],
  'en_route_pickup→arrived_pickup': [8, 45],
  'arrived_pickup→picked_up': [2, 12],
  'picked_up→en_route_dropoff': [1, 5],
  'en_route_dropoff→arrived_dropoff': [10, 60],
  'arrived_dropoff→delivered': [2, 10],
};

// 100 deliveries, weighted across statuses
const STATUS_DISTRIBUTION: [DeliveryStatus, number][] = [
  ['draft',            5],
  ['pending',          8],
  ['accepted',         8],
  ['en_route_pickup',  12],
  ['arrived_pickup',   8],
  ['picked_up',        10],
  ['en_route_dropoff', 12],
  ['arrived_dropoff',  8],
  ['delivered',        15],
  ['cancelled',        7],
  ['failed',           5],
  ['returned',         2],
];

const PACKAGE_CATEGORIES = ['document', 'parcel', 'fragile', 'heavy', 'food'] as const;

// ─── Nigerian Address Data ────────────────────────────────────────────────────

type AreaData = { area: string; streets: string[]; lat: number; lng: number };

const LAGOS_AREAS: AreaData[] = [
  { area: 'Victoria Island', streets: ['Adeola Odeku St', 'Akin Adesola St', 'Kofo Abayomi St', 'Sanusi Fafunwa St'], lat: 6.4281, lng: 3.4219 },
  { area: 'Lekki',           streets: ['Admiralty Way', 'Fola Osibo St', 'Freedom Way', 'Lekki-Epe Expressway'], lat: 6.4474, lng: 3.4737 },
  { area: 'Ikeja',           streets: ['Allen Avenue', 'Opebi Road', 'Toyin St', 'Adeniyi Jones Ave'], lat: 6.6018, lng: 3.3515 },
  { area: 'Surulere',        streets: ['Adeniran Ogunsanya St', 'Bode Thomas St', 'Ogunlana Drive', 'Aguda St'], lat: 6.4920, lng: 3.3570 },
  { area: 'Yaba',            streets: ['Herbert Macaulay Way', 'Queens St', 'Murtala Muhammed Way', 'Commercial Ave'], lat: 6.5094, lng: 3.3758 },
  { area: 'Lagos Island',    streets: ['Broad St', 'Marina St', 'Nnamdi Azikiwe St', 'Balogun St'], lat: 6.4541, lng: 3.4015 },
];

const ABUJA_AREAS: AreaData[] = [
  { area: 'Garki',    streets: ['Ahmadu Bello Way', 'Constitution Ave', 'Gimbiya St', 'Area 1 Close'], lat: 9.0388, lng: 7.4891 },
  { area: 'Wuse',     streets: ['Aminu Kano Crescent', 'Herbert Macaulay Way', 'Ademola Adetokunbo Crescent', 'Adetokunbo Ademola Crescent'], lat: 9.0644, lng: 7.4892 },
  { area: 'Maitama',  streets: ['Aguiyi Ironsi St', 'Amazon St', 'Mississippi St', 'Yedseram St'], lat: 9.0833, lng: 7.4947 },
  { area: 'Asokoro',  streets: ['Yakubu Gowon Crescent', 'Tafawa Balewa Crescent', 'Moshood Abiola Way', 'Julius Nyerere Crescent'], lat: 9.0388, lng: 7.5311 },
  { area: 'Gwarinpa', streets: ['1st Avenue', '3rd Avenue', '5th Avenue', 'Park Lane'], lat: 9.1058, lng: 7.4128 },
];

const PORT_HARCOURT_AREAS: AreaData[] = [
  { area: 'GRA',            streets: ['Aba Road', 'Tombia St', 'Stadium Road', 'Forces Avenue'], lat: 4.8156, lng: 7.0498 },
  { area: 'Trans Amadi',    streets: ['Trans Amadi Industrial Layout', 'MCC Road', 'Sapele Road', 'Location Road'], lat: 4.8204, lng: 7.0630 },
  { area: 'Rumuokwurushi',  streets: ['East-West Road', 'Rumuokwurushi Main Road', 'NTA Road', 'Igbo Etche Road'], lat: 4.8567, lng: 6.9923 },
  { area: 'Eliozu',         streets: ['Eliozu-Rumuodara Road', 'Airport Road', 'Peter Odili Road', 'Aba Expressway'], lat: 4.8789, lng: 7.0267 },
];

const ALL_AREAS = [...LAGOS_AREAS, ...ABUJA_AREAS, ...PORT_HARCOURT_AREAS];

function getCityForArea(area: AreaData): string {
  if (LAGOS_AREAS.includes(area)) return 'Lagos';
  if (ABUJA_AREAS.includes(area)) return 'Abuja';
  return 'Port Harcourt';
}

// ─── Test User Data ───────────────────────────────────────────────────────────

const TEST_CUSTOMERS = [
  { name: `${SEED_MARKER} Adewale Johnson`, phone: '+2348012345001', email: 'seed.adewale@test.com', clerkId: 'seed_clerk_customer_001' },
  { name: `${SEED_MARKER} Ngozi Okafor`,   phone: '+2348012345002', email: 'seed.ngozi@test.com',   clerkId: 'seed_clerk_customer_002' },
  { name: `${SEED_MARKER} Emeka Nwosu`,    phone: '+2348012345003', email: 'seed.emeka@test.com',   clerkId: 'seed_clerk_customer_003' },
  { name: `${SEED_MARKER} Funke Akindele`, phone: '+2348012345004', email: 'seed.funke@test.com',   clerkId: 'seed_clerk_customer_004' },
  { name: `${SEED_MARKER} Tunde Bakare`,   phone: '+2348012345005', email: 'seed.tunde@test.com',   clerkId: 'seed_clerk_customer_005' },
];

const TEST_DRIVERS = [
  { name: `${SEED_MARKER} Chinedu Obi`,     phone: '+2348098765001', email: 'seed.chinedu@test.com',   clerkId: 'seed_clerk_driver_001', vehicleType: 'motorcycle' as const, licensePlate: 'LAG-SEED-01', vehicleModel: 'Honda CG 125' },
  { name: `${SEED_MARKER} Babatunde Yusuf`, phone: '+2348098765002', email: 'seed.babatunde@test.com', clerkId: 'seed_clerk_driver_002', vehicleType: 'car' as const,        licensePlate: 'ABJ-SEED-02', vehicleModel: 'Toyota Corolla 2019' },
  { name: `${SEED_MARKER} Ibrahim Musa`,    phone: '+2348098765003', email: 'seed.ibrahim@test.com',   clerkId: 'seed_clerk_driver_003', vehicleType: 'van' as const,        licensePlate: 'PHC-SEED-03', vehicleModel: 'Hiace Bus 2020' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function generateNigerianPhone(): string {
  return `+234${String(randInt(7000000000, 9099999999))}`;
}

function generatePackageDescription(): string {
  return pick([
    'Electronics package containing laptop accessories',
    'Documents for court hearing',
    'Fragile glassware set for kitchen',
    'Heavy industrial parts for factory',
    'Fresh food items for catering event',
    'Office supplies and stationery',
    'Birthday gift package',
    'Medical supplies and equipment',
    'Fashion items and clothing',
    'Books and educational materials',
    'Furniture parts for assembly',
    'Wedding decorations and flowers',
    'Car parts and engine components',
    'Kitchen appliances',
    'Cosmetics and beauty products',
    'Sports equipment and gear',
    'Baby items and toys',
  ]);
}

function generateRecipientName(): string {
  const firstNames = ['Chioma', 'Oluwaseun', 'Amina', 'Kelechi', 'Aisha', 'Oluwatobi', 'Fatima', 'Ifeanyi', 'Blessing', 'Yusuf'];
  const lastNames  = ['Eze', 'Adeyemi', 'Mohammed', 'Okonkwo', 'Bello', 'Olawale', 'Abdullahi', 'Chukwu', 'Ogunleye', 'Hassan'];
  return `${pick(firstNames)} ${pick(lastNames)}`;
}

// ─── Timeline builder ─────────────────────────────────────────────────────────

type EventSpec = {
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
  triggeredBy: string | null;
  failureCause: FailureCause | null;
  failureNote: string | null;
  at: Date;
};

/**
 * Builds the sequence of events leading up to `targetStatus`.
 * Returns events in chronological order plus the final `updatedAt` timestamp.
 */
function buildTimeline(
  targetStatus: DeliveryStatus,
  startedAt: Date,
  driverUserId: string | null,
): { events: EventSpec[]; updatedAt: Date } {
  const events: EventSpec[] = [];
  let cursor = startedAt;

  // Determine which statuses precede the target
  const targetIdx = STATUS_SEQUENCE.indexOf(targetStatus);

  // Helper: advance cursor by the configured transition minutes
  function advance(key: string): Date {
    const [min, max] = TRANSITION_MINUTES[key] ?? [1, 5];
    cursor = addMinutes(cursor, rand(min, max));
    return cursor;
  }

  // Walk the happy path up to (but not including) targetStatus, or the full path for delivered
  const pathStatuses = targetIdx >= 0
    ? STATUS_SEQUENCE.slice(0, targetIdx + 1)
    : STATUS_SEQUENCE; // fallback for cancelled/failed/returned

  for (let i = 0; i < pathStatuses.length; i++) {
    const toStatus = pathStatuses[i];
    const fromStatus = i === 0 ? null : pathStatuses[i - 1];
    const transitionKey = fromStatus ? `${fromStatus}→${toStatus}` : null;
    const at = transitionKey ? advance(transitionKey) : cursor;

    // Who triggered this transition?
    const isDriverAction = [
      'en_route_pickup', 'arrived_pickup', 'picked_up',
      'en_route_dropoff', 'arrived_dropoff', 'delivered',
    ].includes(toStatus);

    events.push({
      fromStatus,
      toStatus,
      triggeredBy: isDriverAction ? driverUserId : null,
      failureCause: null,
      failureNote: null,
      at,
    });

    if (toStatus === targetStatus && targetStatus !== 'cancelled' && targetStatus !== 'failed' && targetStatus !== 'returned') {
      break;
    }
  }

  // Handle cancelled — append the cancellation event after last happy-path step
  if (targetStatus === 'cancelled') {
    // Cancel from somewhere in the early flow
    const cancelFrom = pick(['pending', 'accepted', 'en_route_pickup']) as DeliveryStatus;
    const cancelIdx = STATUS_SEQUENCE.indexOf(cancelFrom);
    const pathToCancelFrom = STATUS_SEQUENCE.slice(0, cancelIdx + 1);

    // Rebuild from scratch for cancelled
    events.length = 0;
    cursor = startedAt;

    for (let i = 0; i < pathToCancelFrom.length; i++) {
      const toStatus = pathToCancelFrom[i];
      const fromStatus = i === 0 ? null : pathToCancelFrom[i - 1];
      const key = fromStatus ? `${fromStatus}→${toStatus}` : null;
      const at = key ? advance(key) : cursor;
      events.push({ fromStatus, toStatus, triggeredBy: null, failureCause: null, failureNote: null, at });
    }

    const cancelAt = advance(`${cancelFrom}→cancelled`);
    events.push({
      fromStatus: cancelFrom,
      toStatus: 'cancelled',
      triggeredBy: null,
      failureCause: null,
      failureNote: null,
      at: cancelAt,
    });
  }

  // Handle failed — append failure event with cause after some active step
  if (targetStatus === 'failed') {
    const failFrom = pick(['en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff']) as DeliveryStatus;
    const failIdx = STATUS_SEQUENCE.indexOf(failFrom);
    const pathToFail = STATUS_SEQUENCE.slice(0, failIdx + 1);

    events.length = 0;
    cursor = startedAt;

    for (let i = 0; i < pathToFail.length; i++) {
      const toStatus = pathToFail[i];
      const fromStatus = i === 0 ? null : pathToFail[i - 1];
      const key = fromStatus ? `${fromStatus}→${toStatus}` : null;
      const at = key ? advance(key) : cursor;
      const isDriverAction = ['en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff'].includes(toStatus);
      events.push({ fromStatus, toStatus, triggeredBy: isDriverAction ? driverUserId : null, failureCause: null, failureNote: null, at });
    }

    const cause = pick<FailureCause>(['driver', 'route_traffic', 'system']);
    const notes: Record<FailureCause, string> = {
      driver:        'Driver could not locate the address after 3 attempts',
      carrier:       'Carrier vehicle broke down en route',
      route_traffic: 'Severe traffic on Apapa-Oshodi Expressway — recipient unavailable after wait',
      system:        'Automated routing failed to assign fallback driver',
    };

    const failAt = advance(`${failFrom}→failed`);
    events.push({
      fromStatus: failFrom,
      toStatus: 'failed',
      triggeredBy: driverUserId,
      failureCause: cause,
      failureNote: notes[cause],
      at: failAt,
    });
  }

  // Handle returned — failed first, then returned
  if (targetStatus === 'returned') {
    // Rebuild as failed, then add returned event
    const failFrom = pick(['en_route_dropoff', 'arrived_dropoff']) as DeliveryStatus;
    const failIdx = STATUS_SEQUENCE.indexOf(failFrom);
    const pathToFail = STATUS_SEQUENCE.slice(0, failIdx + 1);

    events.length = 0;
    cursor = startedAt;

    for (let i = 0; i < pathToFail.length; i++) {
      const toStatus = pathToFail[i];
      const fromStatus = i === 0 ? null : pathToFail[i - 1];
      const key = fromStatus ? `${fromStatus}→${toStatus}` : null;
      const at = key ? advance(key) : cursor;
      const isDriverAction = ['en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff'].includes(toStatus);
      events.push({ fromStatus, toStatus, triggeredBy: isDriverAction ? driverUserId : null, failureCause: null, failureNote: null, at });
    }

    const failAt = advance(`${failFrom}→failed`);
    events.push({
      fromStatus: failFrom,
      toStatus: 'failed',
      triggeredBy: driverUserId,
      failureCause: 'driver',
      failureNote: 'Recipient refused delivery — returning to sender',
      at: failAt,
    });

    const returnAt = advance('failed→returned');
    events.push({
      fromStatus: 'failed',
      toStatus: 'returned',
      triggeredBy: null,
      failureCause: null,
      failureNote: null,
      at: returnAt,
    });
  }

  return {
    events,
    updatedAt: events[events.length - 1]?.at ?? startedAt,
  };
}

// ─── Payment status from delivery status ──────────────────────────────────────

function derivePaymentStatus(status: DeliveryStatus): { paymentStatus: string; amountPaid: number | null } {
  if (['draft', 'pending'].includes(status)) return { paymentStatus: 'unpaid', amountPaid: null };
  if (['cancelled', 'failed'].includes(status)) return { paymentStatus: pick(['unpaid', 'refunded']), amountPaid: null };
  if (status === 'returned') return { paymentStatus: 'refunded', amountPaid: null };
  if (status === 'delivered') return { paymentStatus: 'released', amountPaid: null };
  return { paymentStatus: 'escrowed', amountPaid: null };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be set');

  const sql = neon(connectionString);
  const db = drizzle(sql);

  console.log('🌱 Starting delivery seed (100 deliveries + timelines)...');

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  console.log('🧹 Cleaning up existing seed data...');

  // CASCADE on delivery_events FK means events are deleted automatically
  await db.delete(deliveries).where(like(deliveries.deliveryNotes, `${SEED_MARKER}%`));

  const existingSeedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${SEED_MARKER}%`));

  for (const { id } of existingSeedUsers) {
    await db.delete(drivers).where(eq(drivers.userId, id));
  }

  await db.delete(users).where(like(users.name, `${SEED_MARKER}%`));
  console.log('✅ Cleanup complete');

  // ── Customers ────────────────────────────────────────────────────────────────
  console.log('👤 Creating test customers...');
  const customerIds: string[] = [];
  for (const c of TEST_CUSTOMERS) {
    const [row] = await db.insert(users).values({
      clerkId: c.clerkId, email: c.email, phone: c.phone, name: c.name, role: 'customer', verified: true,
    }).returning({ id: users.id });
    customerIds.push(row.id);
  }
  console.log(`✅ Created ${customerIds.length} customers`);

  // ── Drivers ──────────────────────────────────────────────────────────────────
  console.log('🚗 Creating test drivers...');
  // Store both driverId (FK for delivery) and driverUserId (FK for events.triggeredBy)
  const driverRecords: { driverId: string; userId: string }[] = [];

  for (const d of TEST_DRIVERS) {
    const [driverUser] = await db.insert(users).values({
      clerkId: d.clerkId, email: d.email, phone: d.phone, name: d.name, role: 'driver', verified: true,
    }).returning({ id: users.id });

    const [driver] = await db.insert(drivers).values({
      userId: driverUser.id,
      vehicleType: d.vehicleType,
      licensePlate: d.licensePlate,
      vehicleModel: d.vehicleModel,
      verified: true,
      available: true,
      rating: rand(3.5, 5.0),
      lat: pick(ALL_AREAS).lat + rand(-0.01, 0.01),
      lng: pick(ALL_AREAS).lng + rand(-0.01, 0.01),
    }).returning({ id: drivers.id });

    driverRecords.push({ driverId: driver.id, userId: driverUser.id });
  }
  console.log(`✅ Created ${driverRecords.length} drivers`);

  // ── Deliveries + Events ───────────────────────────────────────────────────────
  console.log('📦 Generating deliveries and event timelines...');

  const STATUSES_NEEDING_DRIVER: DeliveryStatus[] = [
    'accepted', 'en_route_pickup', 'arrived_pickup', 'picked_up',
    'en_route_dropoff', 'arrived_dropoff', 'delivered', 'failed', 'returned',
  ];

  let deliveryCount = 0;
  let eventCount = 0;
  let categoryIndex = 0;

  // Spread start times across the last 14 days
  const now = new Date();
  const baseEarliest = new Date(now.getTime() - 14 * 24 * 60 * 60_000);

  for (const [status, count] of STATUS_DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      const pickupArea  = pick(ALL_AREAS);
      const dropoffArea = pick(ALL_AREAS);
      const category    = PACKAGE_CATEGORIES[categoryIndex++ % PACKAGE_CATEGORIES.length];

      // Stagger creation times across the last 14 days
      const startedAt = new Date(
        baseEarliest.getTime() + rand(0, 14 * 24 * 60) * 60_000
      );

      const needsDriver = STATUSES_NEEDING_DRIVER.includes(status);
      const driverRecord = needsDriver ? pick(driverRecords) : null;

      const { events, updatedAt } = buildTimeline(
        status,
        startedAt,
        driverRecord?.userId ?? null,
      );

      const priceKobo = Math.round(rand(200_000, 2_500_000));
      const { paymentStatus, amountPaid } = derivePaymentStatus(status);

      const deliveryNotesSuffix = pick([
        'Handle with care', 'Call before delivery', 'Leave at gate', 'Ring bell twice', 'Fragile contents',
      ]);

      const [delivery] = await db.insert(deliveries).values({
        customerId:          pick(customerIds),
        driverId:            driverRecord?.driverId ?? null,
        status,
        pickupAddress:       `${randInt(1, 150)} ${pick(pickupArea.streets)}, ${pickupArea.area}`,
        pickupCity:          getCityForArea(pickupArea),
        pickupLat:           pickupArea.lat  + rand(-0.01, 0.01),
        pickupLng:           pickupArea.lng  + rand(-0.01, 0.01),
        dropoffAddress:      `${randInt(1, 150)} ${pick(dropoffArea.streets)}, ${dropoffArea.area}`,
        dropoffCity:         getCityForArea(dropoffArea),
        dropoffLat:          dropoffArea.lat + rand(-0.01, 0.01),
        dropoffLng:          dropoffArea.lng + rand(-0.01, 0.01),
        packageDescription:  generatePackageDescription(),
        packageWeight:       Math.round(rand(0.1, 50) * 10) / 10,
        packageCategory:     category,
        priceKobo,
        amountPaid,
        paymentStatus,
        recipientName:       generateRecipientName(),
        recipientPhone:      generateNigerianPhone(),
        senderPhone:         pick(TEST_CUSTOMERS).phone,
        deliveryNotes:       `${SEED_MARKER} ${deliveryNotesSuffix}`,
        createdAt:           startedAt,
        updatedAt,
      }).returning({ id: deliveries.id });

      // Insert all events for this delivery
      for (const ev of events) {
        await db.insert(deliveryEvents).values({
          deliveryId:   delivery.id,
          legId:        null,
          fromStatus:   ev.fromStatus,
          toStatus:     ev.toStatus,
          triggeredBy:  ev.triggeredBy,
          failureCause: ev.failureCause,
          failureNote:  ev.failureNote,
          createdAt:    ev.at,
        });
        eventCount++;
      }

      deliveryCount++;
    }
  }

  console.log(`✅ Created ${deliveryCount} deliveries with ${eventCount} timeline events`);
  console.log('');
  console.log('📊 Distribution:');
  for (const [status, count] of STATUS_DISTRIBUTION) {
    console.log(`   ${status.padEnd(20)} ${count}`);
  }
  console.log('');
  console.log('🎉 Seed complete!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
