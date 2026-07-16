/**
 * Seed script: Generate realistic platform_ledger and cost_snapshots rows for dev.
 *
 * Run: pnpm --filter @surewaka/db seed:finance
 *
 * Generates 6 months of backfilled data:
 *   - platform_ledger: commission, withdrawal_fee, paystack_transfer, paystack_collection events
 *   - cost_snapshots: daily infra costs for all 5 providers
 *
 * Idempotent — skips if data already exists for the date range.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { platformLedger, costSnapshots } from '../schema/index';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');

const db = drizzle(neon(connectionString));

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomUUID(): string {
  return crypto.randomUUID();
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Returns an array of Date objects for every day from `daysAgo` days back to yesterday. */
function pastDays(daysAgo: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = daysAgo; i >= 1; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    days.push(d);
  }
  return days;
}

/** Format a Date as YYYY-MM-DD for cost_snapshots.snapshot_date */
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

/** Scatter a timestamp randomly within a given day */
function randomTimeOnDay(day: Date): Date {
  const t = new Date(day);
  t.setUTCHours(randBetween(0, 23), randBetween(0, 59), randBetween(0, 59));
  return t;
}

// ── Ledger seed ───────────────────────────────────────────────────────────────

type LedgerSeedRow = typeof platformLedger.$inferInsert;

/**
 * Per day:
 *   - 5–15 deliveries completed → each writes a commission event + paystack_collection
 *   - 1–4 payouts completed → each writes withdrawal_fee + paystack_transfer
 *   - ~10% of days: 1 commission_reversal (refund after release)
 *
 * Revenue grows ~8% month-over-month to simulate early traction.
 */
function buildLedgerRows(days: Date[]): LedgerSeedRow[] {
  const rows: LedgerSeedRow[] = [];
  const totalDays = days.length;

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    // Growth factor: starts at 0.4, reaches 1.0 at end of period
    const growth = 0.4 + (0.6 * i) / totalDays;

    const deliveriesPerDay = Math.round(randBetween(5, 15) * growth);
    const payoutsPerDay = Math.round(randBetween(1, 4) * growth);

    // Commission + paystack_collection per completed delivery
    for (let d = 0; d < deliveriesPerDay; d++) {
      const deliveryValue = randBetween(200000, 1500000); // ₦2,000–₦15,000
      const commissionKobo = Math.floor(deliveryValue * 0.15); // 15% commission
      const collectionFee = Math.min(Math.round(deliveryValue * 0.015) + 10000, 200000);
      const sourceId = randomUUID();
      const occurredAt = randomTimeOnDay(day);

      rows.push({
        id: randomUUID(),
        category: 'revenue',
        type: 'commission',
        amountKobo: commissionKobo,
        sourceId,
        sourceType: 'escrow_hold',
        occurredAt,
      });

      rows.push({
        id: randomUUID(),
        category: 'expense',
        type: 'paystack_collection',
        amountKobo: collectionFee,
        // Different sourceId — collection fee is on the wallet transaction, not escrow hold
        sourceId: randomUUID(),
        sourceType: 'wallet_transaction',
        occurredAt,
      });
    }

    // Withdrawal fee + paystack_transfer per completed payout
    for (let p = 0; p < payoutsPerDay; p++) {
      const payoutAmount = randBetween(500000, 5000000); // ₦5,000–₦50,000
      const withdrawalFee = 10000; // flat ₦100
      const transferFee = payoutAmount <= 500000 ? 1000 : payoutAmount <= 5000000 ? 2500 : 5000;
      const stampDuty = payoutAmount > 1000000 ? 5000 : 0;
      const paystackTransferTotal = transferFee + stampDuty;
      const sourceId = randomUUID();
      const occurredAt = randomTimeOnDay(day);

      rows.push({
        id: randomUUID(),
        category: 'revenue',
        type: 'withdrawal_fee',
        amountKobo: withdrawalFee,
        sourceId,
        sourceType: 'payout_request',
        occurredAt,
      });

      rows.push({
        id: randomUUID(),
        category: 'expense',
        type: 'paystack_transfer',
        amountKobo: paystackTransferTotal,
        sourceId,
        sourceType: 'payout_request',
        occurredAt,
      });
    }

    // ~10% of days: one commission reversal (refund after release)
    if (Math.random() < 0.10) {
      const reversedCommission = randBetween(15000, 150000);
      rows.push({
        id: randomUUID(),
        category: 'expense',
        type: 'commission_reversal',
        amountKobo: reversedCommission,
        sourceId: randomUUID(),
        sourceType: 'escrow_hold',
        occurredAt: randomTimeOnDay(day),
      });
    }
  }

  return rows;
}

// ── Cost snapshot seed ────────────────────────────────────────────────────────

type CostSnapshotRow = typeof costSnapshots.$inferInsert;

// Approximate daily costs in USD — loosely based on early-stage startup spend
const DAILY_COST_USD: Record<string, { min: number; max: number }> = {
  vercel:  { min: 0.10, max: 0.50 },  // hobby/pro plan amortised
  fly:     { min: 0.30, max: 1.20 },  // 1-2 small VMs in London
  neon:    { min: 0.05, max: 0.30 },  // compute usage
  clerk:   { min: 0.20, max: 0.60 },  // estimated per MAU
  ably:    { min: 0.01, max: 0.15 },  // message volume
};

const USD_NGN_RATE = 1620; // mid-market approximation for seeding

function buildCostRows(days: Date[]): CostSnapshotRow[] {
  const rows: CostSnapshotRow[] = [];

  for (const day of days) {
    const dateStr = toDateStr(day);

    for (const [provider, range] of Object.entries(DAILY_COST_USD)) {
      const amountUsd = parseFloat((Math.random() * (range.max - range.min) + range.min).toFixed(4));
      const amountKobo = Math.round(amountUsd * USD_NGN_RATE * 100);

      rows.push({
        id: randomUUID(),
        provider,
        amountUsd: String(amountUsd),
        usdToNgnRate: String(USD_NGN_RATE),
        amountKobo,
        snapshotDate: dateStr,
        rawResponse: { seeded: true },
      });
    }
  }

  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding finance data (6 months)...\n');

  const DAYS_BACK = 180;
  const days = pastDays(DAYS_BACK);

  // Check if ledger data already exists
  const [existingLedger] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(platformLedger);

  if ((existingLedger?.count ?? 0) > 0) {
    console.log(`  ℹ️  platform_ledger already has ${existingLedger!.count} rows — skipping ledger seed.\n`);
  } else {
    const ledgerRows = buildLedgerRows(days);
    console.log(`  Inserting ${ledgerRows.length} ledger rows...`);

    // Insert in batches of 200 to avoid query size limits
    const BATCH = 200;
    for (let i = 0; i < ledgerRows.length; i += BATCH) {
      await db.insert(platformLedger).values(ledgerRows.slice(i, i + BATCH));
    }
    console.log(`  ✅ platform_ledger seeded — ${ledgerRows.length} rows\n`);
  }

  // Check if cost snapshot data already exists
  const [existingCosts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(costSnapshots);

  if ((existingCosts?.count ?? 0) > 0) {
    console.log(`  ℹ️  cost_snapshots already has ${existingCosts!.count} rows — skipping cost seed.\n`);
  } else {
    const costRows = buildCostRows(days);
    console.log(`  Inserting ${costRows.length} cost snapshot rows (${days.length} days × 5 providers)...`);

    const BATCH = 200;
    for (let i = 0; i < costRows.length; i += BATCH) {
      await db.insert(costSnapshots).values(costRows.slice(i, i + BATCH));
    }
    console.log(`  ✅ cost_snapshots seeded — ${costRows.length} rows\n`);
  }

  console.log('✅ Finance seed complete.');
  console.log(`   USD/NGN rate used: ${USD_NGN_RATE} (static approximation for dev)`);
  console.log('   Re-run is safe — idempotent on non-empty tables.\n');
}

main().catch((err) => {
  console.error('❌ Finance seed failed:', err);
  process.exit(1);
});
