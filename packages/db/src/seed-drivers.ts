/**
 * Seed script: Insert sample driver data for the admin driver listing feature.
 *
 * Run: pnpm --filter @surewaka/db tsx src/seed-drivers.ts
 *
 * Prerequisites:
 * - DATABASE_URL set in root .env
 * - Users table must accept 'driver' role
 * - Carriers table should have at least one carrier (script creates if needed)
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

config({ path: resolve(import.meta.dirname, '../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { users } from './schema/users';
import { drivers } from './schema/drivers';
import { carriers, carrierMembers } from './schema/carriers';
import { deliveries } from './schema/deliveries';
import { eq, sql as sqlTemplate } from 'drizzle-orm';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set in root .env');
}

const sql = neon(connectionString);
const db = drizzle(sql);

// ─── Sample data ─────────────────────────────────────────────────────────────

const NIGERIAN_NAMES = [
  'Adebayo Ogundimu',
  'Chidinma Okafor',
  'Emeka Nwankwo',
  'Funke Adeyemi',
  'Ibrahim Musa',
  'Ngozi Eze',
  'Oluwaseun Bakare',
  'Tunde Afolabi',
  'Yetunde Akinola',
  'Chukwudi Obi',
  'Amara Okeke',
  'Bola Oladipo',
  'Damilola Ayodeji',
  'Fatima Abdullahi',
  'Gbenga Okonkwo',
  'Halima Suleiman',
  'Ikenna Ugwu',
  'Jumoke Fasola',
  'Kunle Olawale',
  'Lilian Onuoha',
  'Musa Bello',
  'Nkechi Anyanwu',
  'Obinna Chukwu',
  'Patience Ikechukwu',
  'Rasheed Abiodun',
];

const VEHICLE_TYPES = ['motorcycle', 'car', 'van', 'truck'] as const;

const VEHICLE_MODELS: Record<string, string[]> = {
  motorcycle: ['Honda CG 125', 'Bajaj Boxer', 'TVS Apache', 'Suzuki GN 125', 'Yamaha YBR'],
  car: ['Toyota Corolla', 'Honda Civic', 'Hyundai Accent', 'Kia Rio', 'Nissan Almera'],
  van: ['Toyota HiAce', 'Ford Transit', 'Mercedes Sprinter', 'Nissan NV200', 'Fiat Ducato'],
  truck: ['Mitsubishi Canter', 'Isuzu NPR', 'Hino 300', 'MAN TGL', 'DAF LF'],
};

function randomPhone(): string {
  const prefixes = ['0803', '0805', '0706', '0813', '0816', '0902', '0903', '0811'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const rest = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
  return `${prefix}${rest}`;
}

function randomLicensePlate(): string {
  const states = ['LAG', 'ABJ', 'OGU', 'OYO', 'RIV', 'KAN', 'EDO', 'ENU'];
  const state = states[Math.floor(Math.random() * states.length)];
  const num = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const suffix =
    letters[Math.floor(Math.random() * letters.length)] +
    letters[Math.floor(Math.random() * letters.length)];
  return `${state}-${num}${suffix}`;
}

function randomRating(): number {
  // Ratings between 3.0 and 5.0
  return Math.round((3 + Math.random() * 2) * 10) / 10;
}

function randomDate(daysBack: number): Date {
  const now = Date.now();
  const offset = Math.floor(Math.random() * daysBack * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

// ─── Seed logic ──────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding driver data...\n');

  // 1. Create or find a carrier for some drivers to belong to
  const carrierData = [
    { name: 'SwiftMove Logistics', slug: 'swiftmove-logistics', contactEmail: 'ops@swiftmove.ng' },
    { name: 'Lagos Express Delivery', slug: 'lagos-express-delivery', contactEmail: 'hello@lagosxpress.ng' },
  ];

  const carrierIds: string[] = [];

  for (const c of carrierData) {
    const existing = await db.select({ id: carriers.id }).from(carriers).where(eq(carriers.slug, c.slug));
    if (existing.length > 0) {
      carrierIds.push(existing[0].id);
      console.log(`  ✓ Carrier "${c.name}" already exists (${existing[0].id})`);
    } else {
      const id = randomUUID();
      // Use raw SQL to avoid inserting columns that may not exist in DB yet
      await db.execute(
        sqlTemplate`INSERT INTO carriers (id, name, slug, contact_email, is_verified, is_active)
        VALUES (${id}, ${c.name}, ${c.slug}, ${c.contactEmail}, true, true)`,
      );
      carrierIds.push(id);
      console.log(`  + Created carrier "${c.name}" (${id})`);
    }
  }

  // 2. Create users + drivers
  const driverRecords: { driverId: string; userId: string; name: string }[] = [];

  for (let i = 0; i < NIGERIAN_NAMES.length; i++) {
    const name = NIGERIAN_NAMES[i];
    const phone = randomPhone();
    const email = name.toLowerCase().replace(/ /g, '.') + '@example.com';
    const vehicleType = VEHICLE_TYPES[i % VEHICLE_TYPES.length];
    const models = VEHICLE_MODELS[vehicleType];
    const vehicleModel = models[Math.floor(Math.random() * models.length)];
    const verified = Math.random() > 0.3; // 70% verified
    const available = Math.random() > 0.4; // 60% available
    const rating = randomRating();
    const createdAt = randomDate(180); // within last 6 months

    const userId = randomUUID();
    const driverId = randomUUID();

    // Insert user
    await db.insert(users).values({
      id: userId,
      clerkId: `seed_driver_${i}_${randomUUID().slice(0, 8)}`,
      name,
      phone,
      email,
      role: 'driver',
      verified,
      createdAt,
      updatedAt: createdAt,
    });

    // Insert driver
    await db.insert(drivers).values({
      id: driverId,
      userId,
      vehicleType,
      licensePlate: randomLicensePlate(),
      vehicleModel,
      verified,
      available,
      rating,
      createdAt,
    });

    driverRecords.push({ driverId, userId, name });
    console.log(`  + Driver: ${name} (${vehicleType}, ${verified ? '✓' : '✗'} verified)`);
  }

  // 3. Assign some drivers to carriers
  const carrieredDrivers = driverRecords.slice(0, 8); // first 8 get carrier affiliation
  for (let i = 0; i < carrieredDrivers.length; i++) {
    const { userId, name } = carrieredDrivers[i];
    const carrierId = carrierIds[i % carrierIds.length];

    await db.insert(carrierMembers).values({
      id: randomUUID(),
      carrierId,
      userId,
      role: 'carrier_driver',
      isActive: true,
    });
    console.log(`  → Linked ${name} to carrier ${carrierId.slice(0, 8)}...`);
  }

  // 4. Create sample deliveries for some drivers (for totalDeliveries count)
  console.log('\n  Creating sample deliveries...');

  for (const { driverId, name } of driverRecords) {
    const deliveryCount = Math.floor(Math.random() * 30); // 0-29 deliveries each
    if (deliveryCount === 0) continue;

    const deliveryValues = Array.from({ length: deliveryCount }).map(() => ({
      id: randomUUID(),
      customerId: driverRecords[0].userId, // reuse first user as customer for simplicity
      driverId,
      status: 'delivered' as const,
      pickupAddress: 'Yaba, Lagos',
      pickupCity: 'Lagos',
      pickupLat: 6.5095 + Math.random() * 0.05,
      pickupLng: 3.3711 + Math.random() * 0.05,
      dropoffAddress: 'Lekki Phase 1, Lagos',
      dropoffCity: 'Lagos',
      dropoffLat: 6.4483 + Math.random() * 0.05,
      dropoffLng: 3.4746 + Math.random() * 0.05,
      packageDescription: 'Sample package',
      packageWeight: 1 + Math.random() * 10,
      packageCategory: 'parcel' as const,
      price: 1500 + Math.random() * 5000,
      recipientName: 'Test Recipient',
      recipientPhone: '08012345678',
      createdAt: randomDate(120),
    }));

    await db.insert(deliveries).values(deliveryValues);
    console.log(`  + ${name}: ${deliveryCount} completed deliveries`);
  }

  console.log(`\n✅ Seeded ${NIGERIAN_NAMES.length} drivers successfully!`);
  console.log(`   - ${carrieredDrivers.length} affiliated with carriers`);
  console.log(`   - ${NIGERIAN_NAMES.length - carrieredDrivers.length} independent`);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
