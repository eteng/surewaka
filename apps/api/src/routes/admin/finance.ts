import { Hono } from 'hono';
import { db, platformLedger, costSnapshots } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { sql, and, gte, lte, desc } from 'drizzle-orm';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const ESTIMATED_PROVIDERS = new Set(['clerk', 'ably']);

const financeRoutes = new Hono<Env>();
financeRoutes.use('*', requireAuth);
financeRoutes.use('*', requireRole('surewaka_admin'));

// ── helpers ──────────────────────────────────────────────────────────────────

function parseDateRange(fromStr?: string, toStr?: string) {
  const now = new Date();
  const from = fromStr
    ? new Date(fromStr + 'T00:00:00Z')
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = toStr
    ? new Date(toStr + 'T23:59:59Z')
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { from, to };
}

export function buildSummary(
  revenueRows: { type: string; total: number }[],
  expenseRows: { type: string; total: number }[],
  infraRows: { provider: string; total: number }[],
) {
  const rev = Object.fromEntries(revenueRows.map((r) => [r.type, r.total]));
  const exp = Object.fromEntries(expenseRows.map((r) => [r.type, r.total]));
  const infra = Object.fromEntries(infraRows.map((r) => [r.provider, r.total]));

  const commission = rev['commission'] ?? 0;
  const withdrawalFees = rev['withdrawal_fee'] ?? 0;
  const revenueTotal = commission + withdrawalFees;

  const paystackTransfer = exp['paystack_transfer'] ?? 0;
  const paystackCollection = exp['paystack_collection'] ?? 0;
  const commissionReversal = exp['commission_reversal'] ?? 0;
  const operationalTotal = paystackTransfer + paystackCollection + commissionReversal;

  const vercel = infra['vercel'] ?? 0;
  const fly = infra['fly'] ?? 0;
  const neon = infra['neon'] ?? 0;
  const clerk = infra['clerk'] ?? 0;
  const ably = infra['ably'] ?? 0;
  const infraTotal = vercel + fly + neon + clerk + ably;

  const expensesTotal = operationalTotal + infraTotal;
  const grossProfit = revenueTotal - operationalTotal;
  const netProfit = revenueTotal - expensesTotal;
  const marginPercent = revenueTotal === 0 ? null : Math.round((netProfit / revenueTotal) * 10000) / 100;

  return {
    revenue: { commission, withdrawal_fees: withdrawalFees, total: revenueTotal },
    expenses: {
      operational: { paystack_transfer: paystackTransfer, paystack_collection: paystackCollection, total: operationalTotal },
      infrastructure: { vercel, fly, neon, clerk, ably, total: infraTotal },
      total: expensesTotal,
    },
    summary: {
      revenue: revenueTotal,
      operational_expenses: operationalTotal,
      gross_profit: grossProfit,
      total_expenses: expensesTotal,
      net_profit: netProfit,
      margin_percent: marginPercent,
    },
  };
}

// ── GET /summary ──────────────────────────────────────────────────────────────

financeRoutes.get('/summary', async (c) => {
  const { from, to } = parseDateRange(c.req.query('from'), c.req.query('to'));
  const fromDateStr = from.toISOString().split('T')[0]!;
  const toDateStr = to.toISOString().split('T')[0]!;

  const [revenueRows, expenseRows, infraRows] = await Promise.all([
    db.select({
      type: platformLedger.type,
      total: sql<number>`COALESCE(SUM(${platformLedger.amountKobo}), 0)::float8`,
    })
      .from(platformLedger)
      .where(and(sql`${platformLedger.category} = 'revenue'`, gte(platformLedger.occurredAt, from), lte(platformLedger.occurredAt, to)))
      .groupBy(platformLedger.type),

    db.select({
      type: platformLedger.type,
      total: sql<number>`COALESCE(SUM(${platformLedger.amountKobo}), 0)::float8`,
    })
      .from(platformLedger)
      .where(and(sql`${platformLedger.category} = 'expense'`, gte(platformLedger.occurredAt, from), lte(platformLedger.occurredAt, to)))
      .groupBy(platformLedger.type),

    db.select({
      provider: costSnapshots.provider,
      total: sql<number>`COALESCE(SUM(${costSnapshots.amountKobo}), 0)::float8`,
    })
      .from(costSnapshots)
      .where(and(sql`${costSnapshots.snapshotDate} >= ${fromDateStr}`, sql`${costSnapshots.snapshotDate} <= ${toDateStr}`))
      .groupBy(costSnapshots.provider),
  ]);

  const data = buildSummary(revenueRows, expenseRows, infraRows);
  return c.json({ data: { period: { from: fromDateStr, to: toDateStr }, ...data }, error: null, meta: { currency: 'NGN', unit: 'kobo' } });
});

// ── GET /trend ────────────────────────────────────────────────────────────────

financeRoutes.get('/trend', async (c) => {
  const months = Math.min(Number(c.req.query('months') ?? 6), 12);
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const [ledgerRows, infraRows] = await Promise.all([
    db.select({
      period: sql<string>`to_char(date_trunc('month', ${platformLedger.occurredAt}), 'YYYY-MM')`,
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${platformLedger.category} = 'revenue' THEN ${platformLedger.amountKobo} ELSE 0 END), 0)::float8`,
      operationalExpenses: sql<number>`COALESCE(SUM(CASE WHEN ${platformLedger.category} = 'expense' THEN ${platformLedger.amountKobo} ELSE 0 END), 0)::float8`,
    })
      .from(platformLedger)
      .where(gte(platformLedger.occurredAt, since))
      .groupBy(sql`date_trunc('month', ${platformLedger.occurredAt})`)
      .orderBy(sql`date_trunc('month', ${platformLedger.occurredAt})`),

    db.select({
      period: sql<string>`to_char(date_trunc('month', ${costSnapshots.snapshotDate}::timestamp), 'YYYY-MM')`,
      infrastructureExpenses: sql<number>`COALESCE(SUM(${costSnapshots.amountKobo}), 0)::float8`,
    })
      .from(costSnapshots)
      .where(sql`${costSnapshots.snapshotDate}::date >= ${since.toISOString().split('T')[0]}`)
      .groupBy(sql`date_trunc('month', ${costSnapshots.snapshotDate}::timestamp)`)
      .orderBy(sql`date_trunc('month', ${costSnapshots.snapshotDate}::timestamp)`),
  ]);

  // Merge by period
  const infraByPeriod = Object.fromEntries(infraRows.map((r) => [r.period, r.infrastructureExpenses]));
  const data = ledgerRows.map((row) => {
    const infraExp = infraByPeriod[row.period] ?? 0;
    return {
      period: row.period,
      revenue: row.revenue,
      operational_expenses: row.operationalExpenses,
      infrastructure_expenses: infraExp,
      gross_profit: row.revenue - row.operationalExpenses,
      net_profit: row.revenue - row.operationalExpenses - infraExp,
    };
  });

  return c.json({ data, error: null, meta: { currency: 'NGN', unit: 'kobo', months } });
});

// ── GET /ledger ───────────────────────────────────────────────────────────────

financeRoutes.get('/ledger', async (c) => {
  const { from, to } = parseDateRange(c.req.query('from'), c.req.query('to'));
  const category = c.req.query('category');
  const type = c.req.query('type');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  const filters = [gte(platformLedger.occurredAt, from), lte(platformLedger.occurredAt, to)];
  if (category) filters.push(sql`${platformLedger.category} = ${category}`);
  if (type) filters.push(sql`${platformLedger.type} = ${type}`);

  const [rows, countRows] = await Promise.all([
    db.select().from(platformLedger).where(and(...filters)).orderBy(desc(platformLedger.occurredAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(platformLedger).where(and(...filters)),
  ]);

  return c.json({ data: rows, error: null, meta: { currency: 'NGN', unit: 'kobo', total: countRows[0]?.count ?? 0, limit, offset } });
});

// ── GET /costs ────────────────────────────────────────────────────────────────

financeRoutes.get('/costs', async (c) => {
  const from = c.req.query('from') ?? new Date().toISOString().split('T')[0]!;
  const to = c.req.query('to') ?? from;

  const rows = await db
    .select()
    .from(costSnapshots)
    .where(and(sql`${costSnapshots.snapshotDate} >= ${from}`, sql`${costSnapshots.snapshotDate} <= ${to}`))
    .orderBy(desc(costSnapshots.snapshotDate));

  const data = rows.map((r) => ({
    provider: r.provider,
    amount_usd: parseFloat(r.amountUsd),
    usd_to_ngn_rate: parseFloat(r.usdToNgnRate),
    amount_kobo: r.amountKobo,
    snapshot_date: r.snapshotDate,
    estimated: ESTIMATED_PROVIDERS.has(r.provider),
  }));

  return c.json({ data, error: null, meta: { currency: 'NGN', unit: 'kobo' } });
});

export default financeRoutes;
