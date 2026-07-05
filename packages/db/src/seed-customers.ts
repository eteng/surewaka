/**
 * Seed script: Insert sample customer data for the admin customer listing.
 *
 * Run: pnpm --filter @surewaka/db tsx src/seed-customers.ts
 *
 * Prerequisites:
 * - DATABASE_URL set in root .env
 * - Users table and customer_segments table must exist (run db:push or db:migrate first)
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

config({ path: resolve(import.meta.dirname, '../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { users } from './schema/users';
import { customerSegments } from './schema/customer-segments';
import { deliveries } from './schema/deliveries';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set in root .env');
}

const sql = neon(connectionString);
const db = drizzle(sql);

// ─── Sample data ─────────────────────────────────────────────────────────────

const NIGERIAN_CUSTOMERS = [
  { name: 'Adaeze Okoro', gender: 'woman' },
  { name: 'Babatunde Adeniyi', gender: 'man' },
  { name: 'Chioma Nwosu', gender: 'woman' },
  { name: 'Dayo Olumide', gender: 'man' },
  { name: 'Ebele Igwe', gender: 'woman' },
  { name: 'Femi Adekunle', gender: 'man' },
  { name: 'Grace Okonkwo', gender: 'woman' },
  { name: 'Hassan Aliyu', gender: 'man' },
  { name: 'Ifeoma Chukwuma', gender: 'woman' },
  { name: 'Jide Fashola', gender: 'man' },
  { name: 'Kemi Adesanya', gender: 'woman' },
  { name: 'Lekan Balogun', gender: 'man' },
  { name: 'Maryam Danjuma', gender: 'woman' },
  { name: 'Nnamdi Azikiwe Jr', gender: 'man' },
  { name: 'Oluwabunmi Afolayan', gender: 'woman' },
  { name: 'Philip Ekwueme', gender: 'man' },
  { name: 'Queen Amara Obi', gender: 'woman' },
  { name: 'Rashidat Yusuf', gender: 'woman' },
  { name: 'Segun Obasanjo', gender: 'man' },
  { name: 'Titilayo Oni', gender: 'woman' },
  { name: 'Uche Maduagwu', gender: 'man' },
  { name: 'Victoria Nwachukwu', gender: 'woman' },
  { name: 'Wale Omotosho', gender: 'man' },
  { name: 'Yemi Akinwunmi', gender: 'woman' },
  { name: 'Zainab Ibrahim', gender: 'woman' },
  { name: 'Akin Osuntokun', gender: 'man' },
  { name: 'Blessing Ogundipe', gender: 'woman' },
  { name: 'Chidi Ezeobi', gender: 'man' },
  { name: 'Deborah Akinyemi', gender: 'woman' },
  { name: 'Emmanuel Okadigbo', gender: 'man' },
];

const TIERS = ['power', 'regular', 'new', 'dormant'] as const;
const CITIES = ['Lagos', 'Abuja', 'Ibadan', 'Port Harcourt', 'Kano'];

const LAGOS_AREAS = [
  'Lekki Phase 1', 'Victoria Island', 'Yaba', 'Surulere', 'Ikeja',
  'Ikoyi', 'Gbagada', 'Ajah', 'Maryland', 'Ogudu',
];

const PACKAGE_DESCRIPTIONS = [
  'Fashion items', 'Electronics', 'Documents', 'Food package',
  'Beauty products', 'Books', 'Home decor', 'Phone accessories',
  'Clothing order', 'Gift package',
];

function randomPhone(): string {
  const prefixes = ['0803', '0805', '0706', '0813', '0816', '0902', '0903', '0811', '0701', '0808'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const rest = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
  return `${prefix}${rest}`;
}

function randomDate(daysBack: number): Date {
  const now = Date.now();
  const offset = Math.floor(Math.random() * daysBack * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

function randomTier(deliveryCount: number, lastActiveMs: number): (typeof TIERS)[number] {
  const daysSinceActive = lastActiveMs / (1000 * 60 * 60 * 24);

  if (daysSinceActive > 60) return 'dormant';
  if (deliveryCount >= 15) return 'power';
  if (deliveryCount >= 5) return 'regular';
  return 'new';
}

function randomHealthScore(tier: (typeof TIERS)[number]): number {
  switch (tier) {
    case 'power': return 75 + Math.floor(Math.random() * 26); // 75-100
    case 'regular': return 45 + Math.floor(Math.random() * 30); // 45-74
    case 'new': return 30 + Math.floor(Math.random() * 25); // 30-54
    case 'dormant': return Math.floor(Math.random() * 30); // 0-29
  }
}

// ─── Seed logic ──────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding customer data...\n');

  const customerRecords: {
    userId: string;
    name: string;
    totalDeliveries: number;
    totalSpent: number;
    lastDeliveryAt: Date | null;
    tier: (typeof TIERS)[number];
  }[] = [];

  // 1. Create customer users
  for (let i = 0; i < NIGERIAN_CUSTOMERS.length; i++) {
    const { name, gender } = NIGERIAN_CUSTOMERS[i];
    const phone = randomPhone();
    const email = name.toLowerCase().replace(/ /g, '.').replace(/[^a-z.]/g, '') + '@example.com';
    const verified = Math.random() > 0.2; // 80% verified
    const createdAt = randomDate(365); // within last year

    const userId = randomUUID();

    await db.insert(users).values({
      id: userId,
      clerkId: `seed_customer_${i}_${randomUUID().slice(0, 8)}`,
      name,
      phone,
      email,
      role: 'customer',
      verified,
      gender,
      createdAt,
      updatedAt: createdAt,
      notificationEmail: Math.random() > 0.3,
      notificationSms: true,
    });

    // Determine delivery activity
    const totalDeliveries = Math.floor(Math.random() * 40); // 0-39
    const pricePerDelivery = 1500 + Math.random() * 8000; // ₦1,500 - ₦9,500
    const totalSpent = Math.round(totalDeliveries * pricePerDelivery * 100); // in kobo
    const lastDeliveryAt = totalDeliveries > 0 ? randomDate(90) : null;
    const lastActiveMs = lastDeliveryAt
      ? Date.now() - lastDeliveryAt.getTime()
      : Date.now() - createdAt.getTime();
    const tier = randomTier(totalDeliveries, lastActiveMs);

    customerRecords.push({ userId, name, totalDeliveries, totalSpent, lastDeliveryAt, tier });
    console.log(`  + Customer: ${name} (${tier}, ${totalDeliveries} deliveries, ${verified ? '✓' : '✗'} verified)`);
  }

  // 2. Create customer_segments entries
  console.log('\n  Creating customer segments...');

  for (const record of customerRecords) {
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const healthScore = randomHealthScore(record.tier);

    await db.insert(customerSegments).values({
      id: randomUUID(),
      userId: record.userId,
      tier: record.tier,
      totalDeliveries: record.totalDeliveries,
      totalSpent: record.totalSpent,
      lastDeliveryAt: record.lastDeliveryAt,
      primaryCity: city,
      healthScore,
    });
  }

  console.log(`  ✓ Created ${customerRecords.length} customer segments`);

  // 3. Create sample deliveries for customers with totalDeliveries > 0
  console.log('\n  Creating sample deliveries...');

  // We need a driver to assign deliveries to — use a placeholder or null
  let deliveriesCreated = 0;

  for (const record of customerRecords) {
    if (record.totalDeliveries === 0) continue;

    // Create a subset of deliveries (max 10 per customer to keep seed fast)
    const deliveryCount = Math.min(record.totalDeliveries, 10);
    const statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'cancelled'] as const;

    const deliveryValues = Array.from({ length: deliveryCount }).map(() => {
      const pickupArea = LAGOS_AREAS[Math.floor(Math.random() * LAGOS_AREAS.length)];
      const dropoffArea = LAGOS_AREAS[Math.floor(Math.random() * LAGOS_AREAS.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const price = 1500 + Math.random() * 8000;
      const createdAt = randomDate(120);

      return {
        id: randomUUID(),
        customerId: record.userId,
        driverId: null,
        status,
        pickupAddress: `${Math.floor(Math.random() * 50) + 1} ${pickupArea} Road, Lagos`,
        pickupCity: 'Lagos',
        pickupLat: 6.43 + Math.random() * 0.12,
        pickupLng: 3.35 + Math.random() * 0.15,
        dropoffAddress: `${Math.floor(Math.random() * 50) + 1} ${dropoffArea} Street, Lagos`,
        dropoffCity: 'Lagos',
        dropoffLat: 6.43 + Math.random() * 0.12,
        dropoffLng: 3.35 + Math.random() * 0.15,
        packageDescription: PACKAGE_DESCRIPTIONS[Math.floor(Math.random() * PACKAGE_DESCRIPTIONS.length)],
        packageWeight: 0.5 + Math.random() * 15,
        packageCategory: (['parcel', 'document', 'fragile', 'food'] as const)[Math.floor(Math.random() * 4)],
        price,
        recipientName: NIGERIAN_CUSTOMERS[Math.floor(Math.random() * NIGERIAN_CUSTOMERS.length)].name,
        recipientPhone: randomPhone(),
        createdAt,
        paymentStatus: status === 'delivered' ? 'released' : 'unpaid',
        amountPaid: status === 'delivered' ? Math.round(price * 100) : null,
      };
    });

    await db.insert(deliveries).values(deliveryValues);
    deliveriesCreated += deliveryCount;
  }

  console.log(`  ✓ Created ${deliveriesCreated} sample deliveries`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  const tierCounts = customerRecords.reduce(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log(`\n✅ Seeded ${NIGERIAN_CUSTOMERS.length} customers successfully!`);
  console.log(`   Tier breakdown:`);
  for (const [tier, count] of Object.entries(tierCounts)) {
    console.log(`     ${tier}: ${count}`);
  }
  console.log(`   Total deliveries created: ${deliveriesCreated}`);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
