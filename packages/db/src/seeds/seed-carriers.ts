/**
 * Seed script: Insert real Nigerian carrier data.
 *
 * Run: pnpm --filter @surewaka/db seed:carriers
 *
 * Prerequisites:
 * - DATABASE_URL set in root .env
 * - carriers table must exist (run db:migrate first)
 *
 * Safe to run multiple times — skips carriers that already exist by slug.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { carriers } from '../schema/carriers';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set in root .env');

const db = drizzle(neon(connectionString));

// Base prices in kobo (smallest Naira unit). These represent starting prices
// for a standard Lagos intra-city package delivery.
const CARRIERS = [
  {
    name: 'GIG Logistics',
    slug: 'gig-logistics',
    contactEmail: 'partnerships@giglogistics.ng',
    rating: 4.5,
    deliveryCount: 12400,
    isVerified: true,
    isActive: true,
    basePrice: 250000, // ₦2,500
  },
  {
    name: 'DHL Express',
    slug: 'dhl-express',
    contactEmail: 'partnerships@dhl.com.ng',
    rating: 4.8,
    deliveryCount: 8900,
    isVerified: true,
    isActive: true,
    basePrice: 550000, // ₦5,500
  },
  {
    name: 'Kwik Delivery',
    slug: 'kwik-delivery',
    contactEmail: 'business@kwik.delivery',
    rating: 4.3,
    deliveryCount: 31200,
    isVerified: true,
    isActive: true,
    basePrice: 180000, // ₦1,800
  },
  {
    name: 'Sendbox',
    slug: 'sendbox',
    contactEmail: 'partners@sendbox.co',
    rating: 4.2,
    deliveryCount: 19700,
    isVerified: true,
    isActive: true,
    basePrice: 200000, // ₦2,000
  },
  {
    name: 'Red Star Express',
    slug: 'red-star-express',
    contactEmail: 'corporate@redstarex.com',
    rating: 4.4,
    deliveryCount: 7600,
    isVerified: true,
    isActive: true,
    basePrice: 320000, // ₦3,200
  },
  {
    name: 'Courier Plus',
    slug: 'courier-plus',
    contactEmail: 'business@courierplus.com.ng',
    rating: 4.1,
    deliveryCount: 5400,
    isVerified: true,
    isActive: true,
    basePrice: 280000, // ₦2,800
  },
];

async function main() {
  console.log('Seeding carriers...\n');

  let inserted = 0;
  let skipped = 0;

  for (const carrier of CARRIERS) {
    const existing = await db
      .select({ id: carriers.id })
      .from(carriers)
      .where(eq(carriers.slug, carrier.slug))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  skip  ${carrier.name} (already exists)`);
      skipped++;
      continue;
    }

    await db.insert(carriers).values(carrier);
    console.log(`  added ${carrier.name} — From ₦${(carrier.basePrice / 100).toLocaleString()}`);
    inserted++;
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
