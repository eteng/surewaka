/**
 * Backfill script: recompute h3Index for existing carrier_parks rows.
 *
 * Run: pnpm --filter @surewaka/db backfill:carrier-park-h3
 *
 * Prerequisites:
 * - DATABASE_URL set in root .env
 * - carrier_parks table must exist
 *
 * Why this is needed: POST/PATCH /api/v1/admin/carrier-parks did not compute
 * h3Index from lat/lng until this spec (.kiro/specs/coverage-map). Every park
 * created before that fix has h3Index = '' (the schema default), which makes
 * it invisible to the coverage map's "covered" hex classification. This
 * script is a one-time data fix, not a migration — it recomputes the derived
 * column for existing rows.
 *
 * Idempotent: recomputes h3Index for every row regardless of current value,
 * safe to re-run (e.g. after correcting a park's lat/lng by hand).
 */

import { db } from '../seeds/db';
import { carrierParks } from '../schema/carrier-parks';
import { latLngToCell } from 'h3-js';
import { eq } from 'drizzle-orm';

// Matches H3_RESOLUTION in packages/shared/src/h3.ts — kept as a local
// constant here (like seeds/seed-routing.ts) since packages/db doesn't
// depend on @surewaka/shared and h3-js is already a direct dependency.
const H3_RESOLUTION = 7;

async function main() {
  console.log('Backfilling carrier_parks.h3Index...\n');

  const rows = await db
    .select({ id: carrierParks.id, name: carrierParks.name, lat: carrierParks.lat, lng: carrierParks.lng, h3Index: carrierParks.h3Index })
    .from(carrierParks);

  console.log(`  Total parks: ${rows.length}\n`);

  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const h3Index = latLngToCell(row.lat, row.lng, H3_RESOLUTION);

    if (h3Index === row.h3Index) {
      unchanged++;
      continue;
    }

    await db.update(carrierParks).set({ h3Index, updatedAt: new Date() }).where(eq(carrierParks.id, row.id));
    console.log(`  updated ${row.name} — ${row.h3Index || '(empty)'} → ${h3Index}`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${unchanged} already correct. (Total: ${rows.length})`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
