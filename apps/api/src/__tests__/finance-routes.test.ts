/**
 * Finance routes tests
 *
 * Key regression: neon-http serialises PostgreSQL `bigint` SUM results as JSON strings.
 * Using `::bigint` in the SQL template means JavaScript receives strings, and `+` on two
 * strings is concatenation, not addition — producing astronomically wrong totals.
 * The SQL casts must use `::float8` so the driver returns JS numbers.
 *
 * `buildSummary` is exported so we can unit-test the arithmetic directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { buildSummary } from '../routes/admin/finance';

// ── Auth stubs — always passes, sets admin context ────────────────────────────

vi.mock('../middleware/auth', () => ({
  requireAuth: createMiddleware(async (c, next) => {
    c.set('user', { id: 'user-uuid', clerkId: 'clerk_admin' });
    await next();
  }),
}));

vi.mock('../middleware/role', () => ({
  requireRole: () =>
    createMiddleware(async (c, next) => {
      await next();
    }),
}));

// ── DB mock state ──────────────────────────────────────────────────────────────

let summaryRevenueRows: { type: string; total: number }[] = [];
let summaryExpenseRows: { type: string; total: number }[] = [];
let summaryInfraRows: { provider: string; total: number }[] = [];
let trendLedgerRows: object[] = [];
let trendInfraRows: object[] = [];
let ledgerRows: object[] = [];
let ledgerCount = 0;

// Tracks which query is being built so mockResolvedValue can return the right fixture.
// The summary endpoint fires 3 parallel queries; we differentiate by which table is used.
type PendingQuery = 'revenue' | 'expense' | 'infra' | 'trend_ledger' | 'trend_infra' | 'ledger_rows' | 'ledger_count' | 'unknown';
let pendingQueries: PendingQuery[] = [];

const makeChain = (resolve: () => unknown) => {
  const chain: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(resolve());
  chain.from = vi.fn((table: unknown) => {
    if (table === 'platform_ledger') {
      const call = pendingQueries.shift();
      if (call === 'revenue' || call === 'expense') {
        chain._resolveWith = call;
      }
    }
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.groupBy = vi.fn(() => terminal());
  chain.orderBy = vi.fn(() => terminal());
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => terminal());
  return chain;
};

vi.mock('@surewaka/db', () => {
  let callIndex = 0;

  const db = {
    select: vi.fn(() => {
      const idx = callIndex++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => {
              // Summary: calls 0=revenue, 1=expense, 2=infra (via Promise.all)
              // Trend:   calls 0=trend_ledger, 1=trend_infra
              // Ledger:  calls 0=ledger_rows, 1=ledger_count (separate selects)
              if (idx === 0) return Promise.resolve(summaryRevenueRows.length ? summaryRevenueRows : trendLedgerRows);
              if (idx === 1) return Promise.resolve(summaryExpenseRows.length ? summaryExpenseRows : trendInfraRows);
              if (idx === 2) return Promise.resolve(summaryInfraRows);
              return Promise.resolve([]);
            }),
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => Promise.resolve(ledgerRows)),
              })),
            })),
          })),
        })),
      };
    }),
  };

  return {
    db,
    platformLedger: 'platform_ledger',
    costSnapshots: 'cost_snapshots',
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: true, strings, vals }),
    { join: () => ({ sql: true }) },
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createApp() {
  vi.resetModules();
  const { default: financeRoutes } = await import('../routes/admin/finance');
  const app = new Hono();
  app.route('/api/v1/admin/finance', financeRoutes);
  return app;
}

function adminHeaders() {
  return { Authorization: 'Bearer test-token' };
}

// ── buildSummary unit tests ───────────────────────────────────────────────────

describe('buildSummary', () => {
  it('adds revenue types correctly', () => {
    const result = buildSummary(
      [{ type: 'commission', total: 500000 }, { type: 'withdrawal_fee', total: 10000 }],
      [],
      [],
    );
    expect(result.revenue.commission).toBe(500000);
    expect(result.revenue.withdrawal_fees).toBe(10000);
    expect(result.revenue.total).toBe(510000);
    expect(result.summary.revenue).toBe(510000);
  });

  it('computes gross profit as revenue minus operational expenses only', () => {
    const result = buildSummary(
      [{ type: 'commission', total: 300000 }],
      [{ type: 'paystack_collection', total: 50000 }],
      [{ provider: 'vercel', total: 20000 }],
    );
    // gross profit excludes infra
    expect(result.summary.gross_profit).toBe(250000);
    // net profit deducts everything
    expect(result.summary.net_profit).toBe(230000);
  });

  it('computes negative margin correctly', () => {
    const result = buildSummary(
      [{ type: 'commission', total: 100000 }],
      [{ type: 'paystack_transfer', total: 60000 }],
      [{ provider: 'fly', total: 80000 }],
    );
    expect(result.summary.net_profit).toBe(-40000);
    expect(result.summary.margin_percent).toBeLessThan(0);
  });

  it('returns null margin when revenue is zero', () => {
    const result = buildSummary([], [], []);
    expect(result.summary.revenue).toBe(0);
    expect(result.summary.margin_percent).toBeNull();
  });

  /**
   * REGRESSION GUARD — the neon-http bigint string-concatenation bug.
   *
   * PostgreSQL `::bigint` SUM results arrive as JSON strings via neon-http.
   * Passing those strings to buildSummary causes `+` to concatenate rather
   * than add. This test documents that behaviour and confirms buildSummary
   * itself requires numeric inputs.
   *
   * The fix lives in the SQL: SUM(...)::float8 so the driver returns a number.
   */
  it('produces wrong results if DB returns bigint strings — documents the cast hazard', () => {
    // Simulate what neon-http returns for a ::bigint column
    const stringInputs = [
      { type: 'commission', total: '300000' as unknown as number },
      { type: 'withdrawal_fee', total: '10000' as unknown as number },
    ];
    const result = buildSummary(stringInputs, [], []);
    // String concatenation: '300000' + '10000' = '30000010000'
    expect(result.revenue.total).not.toBe(310000);
    expect(String(result.revenue.total)).toBe('30000010000');
  });

  it('correctly totals all infrastructure providers', () => {
    const infra = [
      { provider: 'vercel', total: 1000 },
      { provider: 'fly', total: 2000 },
      { provider: 'neon', total: 500 },
      { provider: 'clerk', total: 800 },
      { provider: 'ably', total: 200 },
    ];
    const result = buildSummary([], [], infra);
    expect(result.expenses.infrastructure.vercel).toBe(1000);
    expect(result.expenses.infrastructure.total).toBe(4500);
    expect(result.expenses.total).toBe(4500);
  });

  it('handles missing expense/infra types gracefully with zero fallback', () => {
    const result = buildSummary(
      [{ type: 'commission', total: 100000 }],
      [],
      [],
    );
    expect(result.expenses.operational.paystack_transfer).toBe(0);
    expect(result.expenses.operational.paystack_collection).toBe(0);
    expect(result.expenses.infrastructure.vercel).toBe(0);
    expect(result.expenses.total).toBe(0);
    expect(result.summary.net_profit).toBe(100000);
  });

  it('rounds margin_percent to 2 decimal places', () => {
    // net = 1, revenue = 3 → margin = 33.333...% → should round to 33.33
    const result = buildSummary(
      [{ type: 'commission', total: 3 }],
      [{ type: 'paystack_transfer', total: 2 }],
      [],
    );
    expect(result.summary.margin_percent).toBe(33.33);
  });
});

// ── Route smoke tests ─────────────────────────────────────────────────────────

describe('GET /api/v1/admin/finance/summary', () => {
  beforeEach(() => {
    summaryRevenueRows = [
      { type: 'commission', total: 500000 },
      { type: 'withdrawal_fee', total: 10000 },
    ];
    summaryExpenseRows = [
      { type: 'paystack_transfer', total: 20000 },
      { type: 'paystack_collection', total: 8000 },
    ];
    summaryInfraRows = [
      { provider: 'vercel', total: 5000 },
      { provider: 'fly', total: 12000 },
      { provider: 'neon', total: 3000 },
      { provider: 'clerk', total: 4000 },
      { provider: 'ably', total: 1000 },
    ];
  });

  it('returns 200 with correct totals as numbers', async () => {
    const app = await createApp();
    const res = await app.request('/api/v1/admin/finance/summary?from=2026-07-01&to=2026-07-31', {
      headers: adminHeaders(),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { summary: { revenue: number; gross_profit: number; net_profit: number } } };

    expect(typeof body.data.summary.revenue).toBe('number');
    expect(body.data.summary.revenue).toBe(510000);
    expect(body.data.summary.gross_profit).toBe(482000); // 510000 - 28000 operational
    expect(body.data.summary.net_profit).toBe(457000);   // 510000 - 28000 - 25000 infra
  });

  it('response totals are finite numbers — not strings or Infinity', async () => {
    const app = await createApp();
    const res = await app.request('/api/v1/admin/finance/summary?from=2026-07-01&to=2026-07-31', {
      headers: adminHeaders(),
    });

    const body = await res.json() as { data: { summary: Record<string, unknown> } };
    const s = body.data.summary;

    for (const key of ['revenue', 'gross_profit', 'total_expenses', 'net_profit']) {
      expect(typeof s[key], `${key} should be a number`).toBe('number');
      expect(Number.isFinite(s[key] as number), `${key} should be finite`).toBe(true);
    }
  });

  it('includes period in response', async () => {
    const app = await createApp();
    const res = await app.request('/api/v1/admin/finance/summary?from=2026-07-01&to=2026-07-31', {
      headers: adminHeaders(),
    });
    const body = await res.json() as { data: { period: { from: string; to: string } } };
    expect(body.data.period.from).toBe('2026-07-01');
    expect(body.data.period.to).toBe('2026-07-31');
  });
});
