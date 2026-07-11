// packages/db/src/seeds/seed-vehicle-type-rates.ts
/**
 * Seed: Vehicle Type Rates — default multipliers for on-demand pricing.
 * Inserts 4 rows: motorcycle=1.0, car=1.3, van=1.6, truck=2.0.
 *
 * Run: pnpm --filter @surewaka/db seed:vehicle-type-rates
 * Prerequisites: DATABASE_URL set in root .env; migration applied.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { vehicleTypeRates } from '../schema/vehicle-type-rates';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');
const db = drizzle(neon(connectionString));

const defaults = [
  { vehicleType: 'motorcycle' as const, multiplier: '1.00' },
  { vehicleType: 'car' as const, multiplier: '1.30' },
  { vehicleType: 'van' as const, multiplier: '1.60' },
  { vehicleType: 'truck' as const, multiplier: '2.00' },
];

console.log('Seeding vehicle_type_rates...');

for (const row of defaults) {
  await db
    .insert(vehicleTypeRates)
    .values(row)
    .onConflictDoNothing({ target: vehicleTypeRates.vehicleType });
}

console.log('✓ Vehicle type rates seeded:');
console.log('  motorcycle = 1.00×');
console.log('  car        = 1.30×');
console.log('  van        = 1.60×');
console.log('  truck      = 2.00×');
