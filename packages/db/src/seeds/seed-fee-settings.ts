// packages/db/src/seeds/seed-fee-settings.ts
/**
 * Seed script: Insert the default fee_settings singleton row.
 *
 * Run: pnpm --filter @surewaka/db seed:fee-settings
 *
 * Prerequisites: DATABASE_URL set in root .env; fee_settings table created.
 * Idempotent — skips insert if a row already exists.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { feeSettings } from '../schema/fee-settings';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');

const db = drizzle(neon(connectionString));

async function main() {
  console.log('🌱 Seeding fee_settings...\n');

  // Check if a row already exists (singleton pattern)
  const existing = await db.select({ id: feeSettings.id }).from(feeSettings).limit(1);

  if (existing.length > 0) {
    console.log('  ℹ️  fee_settings row already exists — skipping.\n');
    return;
  }

  // Insert with all defaults
  await db.insert(feeSettings).values({});

  console.log('  ✅ Inserted default fee_settings row:');
  console.log('     base_rate_kobo:           200000  (₦2,000)');
  console.log('     per_kg_rate_kobo:          20000  (₦200/kg)');
  console.log('     per_km_rate_kobo:          15000  (₦150/km)');
  console.log('     carrier_commission_rate_pct: 15.00%');
  console.log('     tax_rate_pct:                0.00%');
  console.log('     min_price_kobo:            50000  (₦500)');
  console.log('     weight_correction_approval_window_min: 10');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
