/**
 * Seed script: 6-month finance history with a realistic loss-to-profit arc.
 *
 * Run: pnpm --filter @surewaka/db seed:finance
 *
 * P&L model:
 *   Infrastructure costs are relatively fixed (~$6.50/day = ₦10,530/day) regardless of volume.
 *   Net revenue per delivery is ~₦1,115 (15% commission minus Paystack collection fee).
 *   Break-even requires ~10 deliveries/day — hit around day 75 (month 3).
 *
 *   Month 1 (days   1-30):  2–5  deliveries/day  →  deep losses  (~-₦7k/day)
 *   Month 2 (days  31-60):  4–9  deliveries/day  →  still losing (~-₦2k/day)
 *   Month 3 (days  61-90):  7–16 deliveries/day  →  break-even zone
 *   Month 4 (days  91-120): 14–28 deliveries/day →  growing profit
 *   Month 5 (days 121-150): 25–47 deliveries/day →  solid profit
 *   Month 6 (days 151-180): 38–66 deliveries/day →  strong profit
 *
 * Always truncates and re-inserts — re-running replaces existing seed data.
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

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function randomTimeOnDay(day: Date): Date {
  const t = new Date(day);
  t.setUTCHours(randBetween(6, 22), randBetween(0, 59), randBetween(0, 59));
  return t;
}

// ── Growth curve ──────────────────────────────────────────────────────────────

/**
 * Exponential growth from 4% → 100% over the seed window.
 * Produces realistic early losses that flip to profit around day 75.
 *
 * growth(0)   ≈ 0.04  (just launched)
 * growth(60)  ≈ 0.14  (month 2 — still losing)
 * growth(75)  ≈ 0.19  (month 3 entry — approaching break-even)
 * growth(120) ≈ 0.40  (month 4 — profitable and growing)
 * growth(179) = 1.00  (month 6 — at scale)
 */
function growthAt(i: number, total: number): number {
  return 0.04 * Math.pow(25, i / (total - 1));
}

// ── Ledger seed ───────────────────────────────────────────────────────────────

type LedgerSeedRow = typeof platformLedger.$inferInsert;

/**
 * Peak volume (at growth = 1.0):
 *   Deliveries: 40–80/day (avg 60)   → drops to 2–3/day at launch
 *   Payouts:    5–15/day (avg 10)    → drops to 0–1/day at launch
 *
 * Delivery fee: ₦3,000–₦15,000 (300,000–1,500,000 kobo)
 * Commission:   15% → ₦450–₦2,250 (avg ₦1,350 = 135,000 kobo)
 * Paystack collection: 1.5% + ₦100, capped ₦2,000 (avg ₦235 = 23,500 kobo)
 * Net per delivery: ₦1,115 (111,500 kobo)
 *
 * Infra break-even: 10 deliveries/day (see cost model below)
 */
function buildLedgerRows(days: Date[]): LedgerSeedRow[] {
  const rows: LedgerSeedRow[] = [];
  const total = days.length;

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const g = growthAt(i, total);

    // Add ±20% daily noise so the chart isn't too smooth
    const noise = 0.80 + Math.random() * 0.40;
    const deliveriesPerDay = Math.max(1, Math.round(randBetween(40, 80) * g * noise));
    const payoutsPerDay = Math.max(0, Math.round(randBetween(5, 15) * g * noise));

    // Commission + Paystack collection per completed delivery
    for (let d = 0; d < deliveriesPerDay; d++) {
      const deliveryFeeKobo = randBetween(300_000, 1_500_000); // ₦3k–₦15k
      const commissionKobo = Math.floor(deliveryFeeKobo * 0.15);
      // Paystack collection: 1.5% + ₦100, capped ₦2,000
      const collectionFeeKobo = Math.min(Math.round(deliveryFeeKobo * 0.015) + 10_000, 200_000);
      const sourceId = crypto.randomUUID();
      const occurredAt = randomTimeOnDay(day);

      rows.push({
        id: crypto.randomUUID(),
        category: 'revenue',
        type: 'commission',
        amountKobo: commissionKobo,
        sourceId,
        sourceType: 'escrow_hold',
        occurredAt,
      });

      rows.push({
        id: crypto.randomUUID(),
        category: 'expense',
        type: 'paystack_collection',
        amountKobo: collectionFeeKobo,
        sourceId: crypto.randomUUID(), // collection is on the wallet_transaction, not the escrow
        sourceType: 'wallet_transaction',
        occurredAt,
      });
    }

    // Withdrawal fee + Paystack transfer per completed payout
    for (let p = 0; p < payoutsPerDay; p++) {
      const payoutKobo = randBetween(500_000, 5_000_000); // ₦5k–₦50k
      const withdrawalFeeKobo = 10_000; // flat ₦100
      // Transfer fee tiers: ₦10 / ₦25 / ₦50 + ₦50 stamp duty if > ₦10k
      const baseFee = payoutKobo <= 500_000 ? 1_000 : payoutKobo <= 5_000_000 ? 2_500 : 5_000;
      const stampDuty = payoutKobo > 1_000_000 ? 5_000 : 0;
      const sourceId = crypto.randomUUID();
      const occurredAt = randomTimeOnDay(day);

      rows.push({
        id: crypto.randomUUID(),
        category: 'revenue',
        type: 'withdrawal_fee',
        amountKobo: withdrawalFeeKobo,
        sourceId,
        sourceType: 'payout_request',
        occurredAt,
      });

      rows.push({
        id: crypto.randomUUID(),
        category: 'expense',
        type: 'paystack_transfer',
        amountKobo: baseFee + stampDuty,
        sourceId,
        sourceType: 'payout_request',
        occurredAt,
      });
    }

    // ~3% chance of a commission reversal on any given day (rare post-release refund)
    if (Math.random() < 0.03) {
      // Can only reverse commissions already earned — use a plausible amount
      const reversedKobo = randBetween(45_000, 225_000); // ₦450–₦2,250 (one delivery's worth)
      rows.push({
        id: crypto.randomUUID(),
        category: 'expense',
        type: 'commission_reversal',
        amountKobo: reversedKobo,
        sourceId: crypto.randomUUID(),
        sourceType: 'escrow_hold',
        occurredAt: randomTimeOnDay(day),
      });
    }
  }

  return rows;
}

// ── Cost snapshot seed ────────────────────────────────────────────────────────

type CostSnapshotRow = typeof costSnapshots.$inferInsert;

/**
 * Infrastructure costs modelled as real monthly plans amortised to daily.
 * These are mostly fixed — they don't drop just because volume is low.
 * Total: $5.00–$8.50/day (~₦8,100–₦13,770/day at ₦1,620/$).
 *
 * At day-1 delivery volume (₦3,375 revenue/day), infra alone guarantees a loss.
 * At break-even volume (~10 deliveries/day, ₦11,150 net revenue), infra is covered.
 *
 * Infra grows slightly over time — autoscaling Fly machines, more Neon compute,
 * higher Clerk MAU billing as the user base grows.
 */
const DAILY_COST_USD: Record<string, { launch: number; peak: number }> = {
  //                     launch $/day     peak $/day
  vercel:  { launch: 1.30, peak: 2.00 }, // $40–$60/month (pro plan)
  fly:     { launch: 1.60, peak: 3.20 }, // $49–$98/month (scaled VMs in lhr)
  neon:    { launch: 0.50, peak: 1.50 }, // $15–$46/month (compute hours)
  clerk:   { launch: 0.80, peak: 2.00 }, // $25–$61/month (MAU-based)
  ably:    { launch: 0.16, peak: 0.65 }, // $5–$20/month (message volume)
  //         ────────────  ────────────
  //         $4.36/day      $9.35/day
};

const USD_NGN_RATE = 1620;

function buildCostRows(days: Date[]): CostSnapshotRow[] {
  const rows: CostSnapshotRow[] = [];
  const total = days.length;

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const g = growthAt(i, total);
    const dateStr = toDateStr(day);

    for (const [provider, range] of Object.entries(DAILY_COST_USD)) {
      // Cost grows from launch rate toward peak rate as the platform scales
      const baseCost = range.launch + (range.peak - range.launch) * g;
      // ±8% daily noise (invoice proration, metered usage fluctuation)
      const noise = 0.92 + Math.random() * 0.16;
      const amountUsd = parseFloat((baseCost * noise).toFixed(4));
      const amountKobo = Math.round(amountUsd * USD_NGN_RATE * 100);

      rows.push({
        id: crypto.randomUUID(),
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
  console.log('🌱 Seeding finance data (6 months — loss-to-profit arc)...\n');

  const DAYS_BACK = 180;
  const days = pastDays(DAYS_BACK);

  // Always truncate — re-running replaces existing seed data
  console.log('  Truncating existing seed data...');
  await db.delete(platformLedger);
  await db.delete(costSnapshots);
  console.log('  ✓ Tables cleared\n');

  // ── Ledger ────────────────────────────────────────────────────────────────
  const ledgerRows = buildLedgerRows(days);
  console.log(`  Inserting ${ledgerRows.length} ledger rows...`);

  const BATCH = 200;
  for (let i = 0; i < ledgerRows.length; i += BATCH) {
    await db.insert(platformLedger).values(ledgerRows.slice(i, i + BATCH));
  }
  console.log(`  ✅ platform_ledger seeded — ${ledgerRows.length} rows\n`);

  // ── Cost snapshots ────────────────────────────────────────────────────────
  const costRows = buildCostRows(days);
  console.log(`  Inserting ${costRows.length} cost snapshot rows (${days.length} days × 5 providers)...`);

  for (let i = 0; i < costRows.length; i += BATCH) {
    await db.insert(costSnapshots).values(costRows.slice(i, i + BATCH));
  }
  console.log(`  ✅ cost_snapshots seeded — ${costRows.length} rows\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const [ledgerCount] = await db.select({ count: sql<number>`count(*)::int` }).from(platformLedger);
  const [costCount] = await db.select({ count: sql<number>`count(*)::int` }).from(costSnapshots);

  console.log('✅ Finance seed complete.\n');
  console.log('   Arc: deep losses (month 1-2) → break-even (month 3) → growing profit (month 4-6)');
  console.log(`   Break-even: ~10 deliveries/day, typically crossed around day 75`);
  console.log(`   USD/NGN rate: ${USD_NGN_RATE} (static approximation)`);
  console.log(`   Rows: ${ledgerCount?.count} ledger, ${costCount?.count} cost snapshots\n`);
}

main().catch((err) => {
  console.error('❌ Finance seed failed:', err);
  process.exit(1);
});
