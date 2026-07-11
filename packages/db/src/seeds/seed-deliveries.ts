import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, like } from 'drizzle-orm';
import { users } from '../schema/users';
import { drivers } from '../schema/drivers';
import { deliveries } from '../schema/deliveries';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from repo root
config({ path: resolve(__dirname, '../../../../.env') });

// ─── Constants ────────────────────────────────────────────────────────────────

const SEED_MARKER = '[SEED]';

const DELIVERY_STATUSES = [
  'draft',
  'pending',
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returned',
] as const;

const PACKAGE_CATEGORIES = ['document', 'parcel', 'fragile', 'heavy', 'food'] as const;

// Status distribution: 60 deliveries total, weighted toward active statuses
const STATUS_DISTRIBUTION: Record<(typeof DELIVERY_STATUSES)[number], number> = {
  draft: 3,
  pending: 5,
  accepted: 4,
  en_route_pickup: 7,
  arrived_pickup: 5,
  picked_up: 6,
  en_route_dropoff: 7,
  arrived_dropoff: 5,
  delivered: 8,
  cancelled: 4,
  failed: 3,
  returned: 3,
};

// Statuses that require a driver assignment (beyond "accepted")
const STATUSES_REQUIRING_DRIVER = [
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returned',
] as const;

// ─── Nigerian Address Data ────────────────────────────────────────────────────

type AreaData = {
  area: string;
  streets: string[];
  lat: number;
  lng: number;
};

const LAGOS_AREAS: AreaData[] = [
  { area: 'Victoria Island', streets: ['Adeola Odeku St', 'Akin Adesola St', 'Kofo Abayomi St', 'Sanusi Fafunwa St'], lat: 6.4281, lng: 3.4219 },
  { area: 'Lekki', streets: ['Admiralty Way', 'Fola Osibo St', 'Freedom Way', 'Lekki-Epe Expressway'], lat: 6.4474, lng: 3.4737 },
  { area: 'Ikeja', streets: ['Allen Avenue', 'Opebi Road', 'Toyin St', 'Adeniyi Jones Ave'], lat: 6.6018, lng: 3.3515 },
  { area: 'Surulere', streets: ['Adeniran Ogunsanya St', 'Bode Thomas St', 'Ogunlana Drive', 'Aguda St'], lat: 6.4920, lng: 3.3570 },
  { area: 'Yaba', streets: ['Herbert Macaulay Way', 'Queens St', 'Murtala Muhammed Way', 'Commercial Ave'], lat: 6.5094, lng: 3.3758 },
  { area: 'Lagos Island', streets: ['Broad St', 'Marina St', 'Nnamdi Azikiwe St', 'Balogun St'], lat: 6.4541, lng: 3.4015 },
];

const ABUJA_AREAS: AreaData[] = [
  { area: 'Garki', streets: ['Ahmadu Bello Way', 'Constitution Ave', 'Gimbiya St', 'Area 1 Close'], lat: 9.0388, lng: 7.4891 },
  { area: 'Wuse', streets: ['Aminu Kano Crescent', 'Herbert Macaulay Way', 'Ademola Adetokunbo Crescent', 'Adetokunbo Ademola Crescent'], lat: 9.0644, lng: 7.4892 },
  { area: 'Maitama', streets: ['Aguiyi Ironsi St', 'Amazon St', 'Mississippi St', 'Yedseram St'], lat: 9.0833, lng: 7.4947 },
  { area: 'Asokoro', streets: ['Yakubu Gowon Crescent', 'Tafawa Balewa Crescent', 'Moshood Abiola Way', 'Julius Nyerere Crescent'], lat: 9.0388, lng: 7.5311 },
  { area: 'Gwarinpa', streets: ['1st Avenue', '3rd Avenue', '5th Avenue', 'Park Lane'], lat: 9.1058, lng: 7.4128 },
];

const PORT_HARCOURT_AREAS: AreaData[] = [
  { area: 'GRA', streets: ['Aba Road', 'Tombia St', 'Stadium Road', 'Forces Avenue'], lat: 4.8156, lng: 7.0498 },
  { area: 'Trans Amadi', streets: ['Trans Amadi Industrial Layout', 'MCC Road', 'Sapele Road', 'Location Road'], lat: 4.8204, lng: 7.0630 },
  { area: 'Rumuokwurushi', streets: ['East-West Road', 'Rumuokwurushi Main Road', 'NTA Road', 'Igbo Etche Road'], lat: 4.8567, lng: 6.9923 },
  { area: 'Eliozu', streets: ['Eliozu-Rumuodara Road', 'Airport Road', 'Peter Odili Road', 'Aba Expressway'], lat: 4.8789, lng: 7.0267 },
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
  { name: `${SEED_MARKER} Ngozi Okafor`, phone: '+2348012345002', email: 'seed.ngozi@test.com', clerkId: 'seed_clerk_customer_002' },
  { name: `${SEED_MARKER} Emeka Nwosu`, phone: '+2348012345003', email: 'seed.emeka@test.com', clerkId: 'seed_clerk_customer_003' },
  { name: `${SEED_MARKER} Funke Akindele`, phone: '+2348012345004', email: 'seed.funke@test.com', clerkId: 'seed_clerk_customer_004' },
  { name: `${SEED_MARKER} Tunde Bakare`, phone: '+2348012345005', email: 'seed.tunde@test.com', clerkId: 'seed_clerk_customer_005' },
];

const TEST_DRIVERS = [
  { name: `${SEED_MARKER} Chinedu Obi`, phone: '+2348098765001', email: 'seed.chinedu@test.com', clerkId: 'seed_clerk_driver_001', vehicleType: 'motorcycle' as const, licensePlate: 'LAG-SEED-01', vehicleModel: 'Honda CG 125' },
  { name: `${SEED_MARKER} Babatunde Yusuf`, phone: '+2348098765002', email: 'seed.babatunde@test.com', clerkId: 'seed_clerk_driver_002', vehicleType: 'car' as const, licensePlate: 'ABJ-SEED-02', vehicleModel: 'Toyota Corolla 2019' },
  { name: `${SEED_MARKER} Ibrahim Musa`, phone: '+2348098765003', email: 'seed.ibrahim@test.com', clerkId: 'seed_clerk_driver_003', vehicleType: 'van' as const, licensePlate: 'PHC-SEED-03', vehicleModel: 'Hiace Bus 2020' },
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateNigerianPhone(): string {
  const suffix = String(randomInt(1000000000, 9999999999)).padStart(10, '0');
  return `+234${suffix}`;
}

function generatePackageDescription(): string {
  const descriptions = [
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
    'Art supplies and canvas',
    'Cosmetics and beauty products',
    'Sports equipment and gear',
    'Musical instruments',
    'Photography equipment',
    'Baby items and toys',
  ];
  return pickRandom(descriptions);
}

function generateRecipientName(): string {
  const firstNames = ['Chioma', 'Oluwaseun', 'Amina', 'Kelechi', 'Aisha', 'Oluwatobi', 'Fatima', 'Ifeanyi', 'Blessing', 'Yusuf'];
  const lastNames = ['Eze', 'Adeyemi', 'Mohammed', 'Okonkwo', 'Bello', 'Olawale', 'Abdullahi', 'Chukwu', 'Ogunleye', 'Hassan'];
  return `${pickRandom(firstNames)} ${pickRandom(lastNames)}`;
}

function generateCoordinateOffset(base: number, range: number): number {
  return base + randomBetween(-range, range);
}

function generatePastTimestamp(maxDaysAgo: number): Date {
  const now = new Date();
  const daysAgo = randomBetween(0, maxDaysAgo);
  const hoursAgo = randomBetween(0, 24);
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - hoursAgo * 60 * 60 * 1000);
}

// ─── Main Seed Logic ──────────────────────────────────────────────────────────

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set');
  }

  const sql = neon(connectionString);
  const db = drizzle(sql);

  console.log('🌱 Starting delivery seed script...');

  // Step 1: Idempotent cleanup — delete existing seed records
  console.log('🧹 Cleaning up existing seed data...');

  // Delete seed deliveries (identified by [SEED] in delivery_notes)
  await db.delete(deliveries).where(like(deliveries.deliveryNotes, `${SEED_MARKER}%`));

  // Find seed users (by [SEED] marker in name) and delete their driver records
  const existingSeedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${SEED_MARKER}%`));

  const seedUserIds = existingSeedUsers.map((u) => u.id);

  if (seedUserIds.length > 0) {
    for (const userId of seedUserIds) {
      await db.delete(drivers).where(eq(drivers.userId, userId));
    }
  }

  // Delete seed users
  await db.delete(users).where(like(users.name, `${SEED_MARKER}%`));
  console.log('✅ Cleanup complete');

  // Step 2: Create test customer users
  console.log('👤 Creating test customers...');
  const customerIds: string[] = [];
  for (const customer of TEST_CUSTOMERS) {
    const [inserted] = await db
      .insert(users)
      .values({
        clerkId: customer.clerkId,
        email: customer.email,
        phone: customer.phone,
        name: customer.name,
        role: 'customer',
        verified: true,
      })
      .returning({ id: users.id });
    customerIds.push(inserted.id);
  }
  console.log(`✅ Created ${customerIds.length} test customers`);

  // Step 3: Create test driver users and driver records
  console.log('🚗 Creating test drivers...');
  const driverIds: string[] = [];
  for (const driverData of TEST_DRIVERS) {
    // Create user first
    const [driverUser] = await db
      .insert(users)
      .values({
        clerkId: driverData.clerkId,
        email: driverData.email,
        phone: driverData.phone,
        name: driverData.name,
        role: 'driver',
        verified: true,
      })
      .returning({ id: users.id });

    // Create driver record
    const [driver] = await db
      .insert(drivers)
      .values({
        userId: driverUser.id,
        vehicleType: driverData.vehicleType,
        licensePlate: driverData.licensePlate,
        vehicleModel: driverData.vehicleModel,
        verified: true,
        available: true,
        rating: randomBetween(3.5, 5.0),
        lat: pickRandom(ALL_AREAS).lat + randomBetween(-0.01, 0.01),
        lng: pickRandom(ALL_AREAS).lng + randomBetween(-0.01, 0.01),
      })
      .returning({ id: drivers.id });

    driverIds.push(driver.id);
  }
  console.log(`✅ Created ${driverIds.length} test drivers`);

  // Step 4: Generate deliveries
  console.log('📦 Generating deliveries...');
  let deliveryCount = 0;
  let categoryIndex = 0;

  for (const [status, count] of Object.entries(STATUS_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      const pickupArea = pickRandom(ALL_AREAS);
      const dropoffArea = pickRandom(ALL_AREAS);
      const pickupStreet = pickRandom(pickupArea.streets);
      const dropoffStreet = pickRandom(dropoffArea.streets);

      const customerId = pickRandom(customerIds);
      const needsDriver = STATUSES_REQUIRING_DRIVER.includes(
        status as (typeof STATUSES_REQUIRING_DRIVER)[number],
      );
      const driverId = needsDriver ? pickRandom(driverIds) : null;

      const category = PACKAGE_CATEGORIES[categoryIndex % PACKAGE_CATEGORIES.length];
      categoryIndex++;

      const createdAt = generatePastTimestamp(30);
      const updatedAt = new Date(createdAt.getTime() + randomBetween(0, 48) * 60 * 60 * 1000);

      const priceKobo = Math.round(randomBetween(10000, 5000000)); // 100 to 50,000 naira in kobo
      const packageWeight = Math.round(randomBetween(0.1, 500) * 10) / 10;

      await db.insert(deliveries).values({
        customerId,
        driverId,
        status: status as (typeof DELIVERY_STATUSES)[number],
        pickupAddress: `${randomInt(1, 150)} ${pickupStreet}, ${pickupArea.area}`,
        pickupCity: getCityForArea(pickupArea),
        pickupLat: generateCoordinateOffset(pickupArea.lat, 0.01),
        pickupLng: generateCoordinateOffset(pickupArea.lng, 0.01),
        dropoffAddress: `${randomInt(1, 150)} ${dropoffStreet}, ${dropoffArea.area}`,
        dropoffCity: getCityForArea(dropoffArea),
        dropoffLat: generateCoordinateOffset(dropoffArea.lat, 0.01),
        dropoffLng: generateCoordinateOffset(dropoffArea.lng, 0.01),
        packageDescription: generatePackageDescription(),
        packageWeight,
        packageCategory: category,
        priceKobo,
        recipientName: generateRecipientName(),
        recipientPhone: generateNigerianPhone(),
        deliveryNotes: `${SEED_MARKER} ${['Handle with care', 'Call before delivery', 'Leave at gate', 'Ring bell twice', 'Fragile contents'][randomInt(0, 4)]}`,
        senderPhone: pickRandom(TEST_CUSTOMERS).phone,
        paymentStatus: pickRandom(['unpaid', 'escrowed', 'released']),
        createdAt,
        updatedAt,
      });

      deliveryCount++;
    }
  }

  console.log(`✅ Created ${deliveryCount} deliveries`);
  console.log('');
  console.log('📊 Distribution summary:');
  for (const [status, count] of Object.entries(STATUS_DISTRIBUTION)) {
    console.log(`   ${status}: ${count}`);
  }
  console.log('');
  console.log('🎉 Seed complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Seed script failed:', error);
    process.exit(1);
  });
