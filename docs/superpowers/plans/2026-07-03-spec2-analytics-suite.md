# Spec 2: Analytics Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Analytics coming soon" stub at `/analytics` with a full six-tab performance intelligence suite — delivery performance, driver performance, carrier SLA, customer experience, and root cause drill-down — backed by real queries against the Spec 0 delivery model tables.

**Architecture:** Six API endpoints under `/api/v1/admin/analytics/*` each backed by a dedicated query in `analytics-service.ts`. The frontend uses a single `use-analytics.ts` hook family with period + filter params. Each tab is its own component consuming its hook. Charts use `recharts` (admin-only dependency). All data queries read from `delivery_events`, `delivery_legs`, `delivery_ratings`, `carrier_sla_overrides` — all created in Spec 0.

**Tech Stack:** React Router v7 (SPA), Hono, Drizzle ORM, Recharts, TanStack Table v8, shadcn/ui, Tailwind v4, TypeScript strict, Vitest

## Global Constraints

- **Spec 0 must be complete first** — `delivery_legs`, `delivery_events`, `delivery_ratings`, `carrier_sla_overrides`, `driver_locations` tables must exist
- TypeScript strict mode — `type` over `interface`, `unknown` not `any`
- Never color alone — trend arrows use icon + color + text
- shadcn/ui from `~/components/ui/*`, Tailwind v4, `cn()`, `lucide-react` icons only
- Skeleton/shimmer on every async panel — no frozen UIs
- API response shape: `{ data, error, meta }`
- Chart components live in `apps/admin/app/components/analytics/` — not in `packages/ui`
- Recharts charts must include an accessible data table alternative (screen reader support)
- Empty state on every chart/table when no data exists in the selected period
- All admin API routes require `requireAuth` + `requireRole('surewaka_admin')`
- Period param values: `'today' | 'week' | 'month' | 'custom'`; custom requires `from` + `to` ISO date strings
- Prettier: single quotes, semicolons, trailing commas, 100 char width

---

## File Structure

**New files:**
```
apps/api/src/services/analytics-service.ts        — all DB query functions
apps/api/src/routes/admin/analytics.ts            — six GET endpoints
apps/api/src/__tests__/analytics-service.test.ts  — service unit tests

apps/admin/app/hooks/use-analytics.ts             — all six fetch hooks

apps/admin/app/components/analytics/
  period-selector.tsx          — shared period picker (Today/Week/Month/Custom)
  kpi-card.tsx                 — shared KPI card with sparkline
  overview-tab.tsx             — Tab 1: six KPI cards
  delivery-performance-tab.tsx — Tab 2: on-time line, volume bar, phase bullet, late dist
  driver-performance-tab.tsx   — Tab 3: sortable driver table + ghost trend chart
  carrier-performance-tab.tsx  — Tab 4: SLA adherence, fulfillment, route avg
  customer-experience-tab.tsx  — Tab 5: update freq, dispute trend, resolution, repeat booking
  root-cause-tab.tsx           — Tab 6: filter sidebar + donut + top-5 + heatmap
```

**Modified files:**
```
apps/admin/app/routes/analytics.tsx — replace stub with tabbed layout
apps/api/src/index.ts               — register analytics routes
apps/admin/package.json             — add recharts dependency
```

---

### Task 1: Install recharts and register analytics API route

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/api/src/routes/admin/analytics.ts` (scaffold only)
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Produces: `recharts` available in admin; `GET /api/v1/admin/analytics/*` routes registered

- [ ] **Step 1: Install recharts**

```bash
pnpm --filter @surewaka/admin add recharts
```

Expected: `recharts` appears in `apps/admin/package.json` dependencies.

- [ ] **Step 2: Create route scaffold**

Create `apps/api/src/routes/admin/analytics.ts`:

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = {
  Variables: { user: AuthUser; accessToken: string; userRoles: UserRole[] };
};

const analyticsRoutes = new Hono<Env>();
analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', requireRole('surewaka_admin'));

analyticsRoutes.get('/overview', async (c) => {
  return c.json({ data: null, error: { code: 'NOT_IMPLEMENTED', message: 'Coming in Task 2' }, meta: null }, 501);
});

export default analyticsRoutes;
```

- [ ] **Step 3: Register routes in `apps/api/src/index.ts`**

Add after the existing admin route registrations:

```typescript
import adminAnalyticsRoutes from './routes/admin/analytics';
// ...
app.route('/api/v1/admin/analytics', adminAnalyticsRoutes);
```

- [ ] **Step 4: Verify API starts**

```bash
pnpm --filter @surewaka/api dev &
sleep 3
curl -s http://localhost:4000/api/v1/admin/analytics/overview | python3 -m json.tool
```

Expected: `{"data":null,"error":{"code":"NOT_IMPLEMENTED",...},"meta":null}`

- [ ] **Step 5: Commit**

```bash
git add apps/admin/package.json apps/api/src/routes/admin/analytics.ts apps/api/src/index.ts pnpm-lock.yaml
git commit -m "feat(api): scaffold analytics routes + install recharts in admin"
```

---

### Task 2: Analytics service — backend query functions

**Files:**
- Create: `apps/api/src/services/analytics-service.ts`
- Create: `apps/api/src/services/__tests__/analytics-service.test.ts`

**Interfaces:**
- Produces (all exported from `analytics-service.ts`):
  - `getOverviewKpis(from: Date, to: Date): Promise<OverviewKpis>`
  - `getDeliveryPerformance(from: Date, to: Date): Promise<DeliveryPerformanceData>`
  - `getDriverPerformance(from: Date, to: Date): Promise<DriverPerformanceRow[]>`
  - `getCarrierPerformance(from: Date, to: Date): Promise<CarrierPerformanceData>`
  - `getCustomerExperience(from: Date, to: Date): Promise<CustomerExperienceData>`
  - `getRootCause(params: RootCauseParams): Promise<RootCauseData>`
  - `periodToDates(period: string, from?: string, to?: string): { start: Date; end: Date }`

- [ ] **Step 1: Write tests**

Create `apps/api/src/services/__tests__/analytics-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { periodToDates } from '../analytics-service';

describe('periodToDates', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
  });

  it('today: start is midnight, end is now', () => {
    const { start, end } = periodToDates('today');
    expect(start.toISOString()).toBe('2026-07-03T00:00:00.000Z');
    expect(end.getTime()).toBeGreaterThanOrEqual(new Date('2026-07-03T12:00:00Z').getTime());
  });

  it('week: start is 7 days ago', () => {
    const { start } = periodToDates('week');
    expect(start.toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });

  it('month: start is 30 days ago', () => {
    const { start } = periodToDates('month');
    expect(start.toISOString()).toBe('2026-06-03T00:00:00.000Z');
  });

  it('custom: parses from/to strings', () => {
    const { start, end } = periodToDates('custom', '2026-06-01', '2026-06-30');
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });

  it('custom without dates falls back to week', () => {
    const { start } = periodToDates('custom');
    expect(start.toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|analytics-service"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the analytics service**

Create `apps/api/src/services/analytics-service.ts`:

```typescript
import { and, avg, count, eq, gte, inArray, isNotNull, isNull, lt, lte, not, sql } from 'drizzle-orm';
import { db, deliveries, deliveryEvents, deliveryLegs, deliveryRatings, carrierSlaOverrides, drivers, carriers, users } from '@surewaka/db';
import { CUSTOMER_FACING_STATUSES } from '@surewaka/shared';

// ─── Period helper ────────────────────────────────────────────────────────────

export function periodToDates(
  period: string,
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  if (period === 'today') {
    return { start: startOfToday, end: now };
  }
  if (period === 'month') {
    const start = new Date(startOfToday);
    start.setUTCDate(start.getUTCDate() - 30);
    return { start, end: now };
  }
  if (period === 'custom' && from && to) {
    const start = new Date(from);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    return { start, end };
  }
  // Default: week
  const start = new Date(startOfToday);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end: now };
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export type SparkPoint = { date: string; value: number };

export type OverviewKpis = {
  onTimeRate: number;
  onTimeRateSparkline: SparkPoint[];
  fulfillmentRate: number;
  fulfillmentRateSparkline: SparkPoint[];
  avgDeliveryMinutes: number;
  avgDeliveryMinutesSparkline: SparkPoint[];
  disputeRate: number;
  disputeRateSparkline: SparkPoint[];
  customerUpdateFrequency: number;
  customerUpdateFrequencySparkline: SparkPoint[];
  driverCompletionRate: number;
  driverCompletionRateSparkline: SparkPoint[];
};

export type DailyOnTimePoint = { date: string; rate: number; isAnomaly: boolean };
export type OutcomeBar = { status: string; count: number };
export type PhaseBar = { legType: string; avgMinutes: number; slaHours: number };
export type LateDistBar = { bucket: string; count: number };

export type DeliveryPerformanceData = {
  dailyOnTimeRate: DailyOnTimePoint[];
  volumeByOutcome: OutcomeBar[];
  phaseBreakdown: PhaseBar[];
  lateDistribution: LateDistBar[];
};

export type DriverPerformanceRow = {
  driverId: string;
  name: string;
  totalLegs: number;
  onTimePct: number;
  completionPct: number;
  ghostRate: number;
  avgRating: number;
  reliabilityScore: number;
};

export type CarrierSlaRow = {
  carrierId: string;
  name: string;
  avgActualHours: number;
  slaHours: number;
  adherencePct: number;
  fulfillmentPct: number;
};

export type CarrierPerformanceData = {
  rows: CarrierSlaRow[];
  overrideCoverage: { configured: number; total: number };
};

export type CustomerExperienceData = {
  updateFrequencyTrend: SparkPoint[];
  avgUpdateFrequency: number;
  disputeRateTrend: SparkPoint[];
  avgDisputeRate: number;
  avgResolutionHours: number;
  repeatRate30d: number;
  repeatRate60d: number;
};

export type RootCauseParams = {
  start: Date;
  end: Date;
  zone?: string;
  driverId?: string;
  carrierId?: string;
  legType?: string;
  timeOfDay?: 'morning' | 'midday' | 'evening' | 'night';
};

export type FailureShare = { cause: string; count: number; pct: number };
export type TopContributor = {
  actorType: 'driver' | 'carrier';
  actorId: string;
  name: string;
  lateCount: number;
  avgMinutesLate: number;
  topZone: string;
  topTimeOfDay: string;
};
export type HeatCell = { zone: string; timeOfDay: string; avgDelayMinutes: number };

export type RootCauseData = {
  failureDecomposition: FailureShare[];
  topContributors: TopContributor[];
  heatmap: HeatCell[];
};

// ─── Time-of-day helper ───────────────────────────────────────────────────────

function timeOfDayFilter(col: string, slot: string): string {
  const ranges: Record<string, [number, number]> = {
    morning: [6, 10],
    midday: [10, 15],
    evening: [15, 19],
    night: [19, 6],
  };
  const r = ranges[slot];
  if (!r) return 'TRUE';
  if (slot === 'night') return `(EXTRACT(HOUR FROM ${col}) >= 19 OR EXTRACT(HOUR FROM ${col}) < 6)`;
  return `(EXTRACT(HOUR FROM ${col}) >= ${r[0]} AND EXTRACT(HOUR FROM ${col}) < ${r[1]})`;
}

// ─── Overview KPIs ────────────────────────────────────────────────────────────

export async function getOverviewKpis(from: Date, to: Date): Promise<OverviewKpis> {
  // On-time rate: % deliveries where completed_at <= system_eta_at (delivery-level)
  const [onTimeResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE completed_at <= COALESCE(driver_eta_at, system_eta_at))
        / NULLIF(COUNT(*) FILTER (WHERE status = 'delivered'), 0),
      2) AS rate
    FROM deliveries
    WHERE status = 'delivered'
      AND updated_at >= ${from.toISOString()} AND updated_at <= ${to.toISOString()}
  `);

  // Fulfillment rate: % accepted deliveries that reached delivered
  const [fulfillResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'delivered')
        / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('draft','pending')), 0),
      2) AS rate
    FROM deliveries
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);

  // Avg delivery time: minutes from first accepted event to delivered event
  const [avgTimeResult] = await db.execute<{ avg_minutes: number }>(sql`
    SELECT
      AVG(
        EXTRACT(EPOCH FROM (de_end.created_at - de_start.created_at)) / 60
      ) AS avg_minutes
    FROM delivery_events de_start
    JOIN delivery_events de_end ON de_end.delivery_id = de_start.delivery_id
    WHERE de_start.to_status = 'accepted'
      AND de_end.to_status = 'delivered'
      AND de_start.created_at >= ${from.toISOString()}
      AND de_start.created_at <= ${to.toISOString()}
  `);

  // Dispute rate: disputes per 100 deliveries
  const [disputeResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status IN ('failed') AND EXISTS (
          SELECT 1 FROM delivery_events de
          WHERE de.delivery_id = deliveries.id AND de.failure_cause IS NOT NULL
        ))
        / NULLIF(COUNT(*), 0),
      2) AS rate
    FROM deliveries
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);

  // Customer update frequency: avg customer-facing events per delivery
  const [updateFreqResult] = await db.execute<{ avg_updates: number }>(sql`
    SELECT AVG(event_count) AS avg_updates FROM (
      SELECT delivery_id, COUNT(*) AS event_count
      FROM delivery_events
      WHERE to_status = ANY(${CUSTOMER_FACING_STATUSES}::text[])
        AND created_at >= ${from.toISOString()}
        AND created_at <= ${to.toISOString()}
      GROUP BY delivery_id
    ) sub
  `);

  // Driver completion rate: % accepted legs completed without ghost
  const [completionResult] = await db.execute<{ rate: number }>(sql`
    SELECT
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'delivered')
        / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('pending')), 0),
      2) AS rate
    FROM delivery_legs
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      AND actor_type = 'driver'
  `);

  // Sparklines: daily values for last 7 points regardless of period
  const sparkStart = new Date(to);
  sparkStart.setUTCDate(sparkStart.getUTCDate() - 6);

  const sparkRows = await db.execute<{ date: string; on_time_rate: number; fulfillment_rate: number; avg_minutes: number; dispute_rate: number; update_freq: number; completion_rate: number }>(sql`
    SELECT
      DATE(updated_at)::text AS date,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status='delivered' AND updated_at <= COALESCE(driver_eta_at, system_eta_at))
        / NULLIF(COUNT(*) FILTER (WHERE status='delivered'), 0), 2) AS on_time_rate,
      ROUND(100.0 * COUNT(*) FILTER (WHERE status='delivered')
        / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('draft','pending')), 0), 2) AS fulfillment_rate,
      0 AS avg_minutes,
      0 AS dispute_rate,
      0 AS update_freq,
      0 AS completion_rate
    FROM deliveries
    WHERE updated_at >= ${sparkStart.toISOString()} AND updated_at <= ${to.toISOString()}
    GROUP BY DATE(updated_at)
    ORDER BY date
  `);

  const toSparkline = (field: 'on_time_rate' | 'fulfillment_rate' | 'avg_minutes' | 'dispute_rate' | 'update_freq' | 'completion_rate') =>
    sparkRows.map((r) => ({ date: r.date, value: r[field] ?? 0 }));

  return {
    onTimeRate: onTimeResult?.rate ?? 0,
    onTimeRateSparkline: toSparkline('on_time_rate'),
    fulfillmentRate: fulfillResult?.rate ?? 0,
    fulfillmentRateSparkline: toSparkline('fulfillment_rate'),
    avgDeliveryMinutes: Math.round(avgTimeResult?.avg_minutes ?? 0),
    avgDeliveryMinutesSparkline: toSparkline('avg_minutes'),
    disputeRate: disputeResult?.rate ?? 0,
    disputeRateSparkline: toSparkline('dispute_rate'),
    customerUpdateFrequency: Math.round((updateFreqResult?.avg_updates ?? 0) * 10) / 10,
    customerUpdateFrequencySparkline: toSparkline('update_freq'),
    driverCompletionRate: completionResult?.rate ?? 0,
    driverCompletionRateSparkline: toSparkline('completion_rate'),
  };
}

// ─── Delivery Performance ─────────────────────────────────────────────────────

export async function getDeliveryPerformance(from: Date, to: Date): Promise<DeliveryPerformanceData> {
  const dailyRows = await db.execute<{ date: string; rate: number }>(sql`
    SELECT
      DATE(updated_at)::text AS date,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status='delivered' AND updated_at <= COALESCE(driver_eta_at, system_eta_at))
        / NULLIF(COUNT(*) FILTER (WHERE status='delivered'), 0),
      2) AS rate
    FROM deliveries
    WHERE updated_at >= ${from.toISOString()} AND updated_at <= ${to.toISOString()}
    GROUP BY DATE(updated_at)
    ORDER BY date
  `);

  // Mark anomaly: drop > 10 points from previous day
  const dailyOnTimeRate: DailyOnTimePoint[] = dailyRows.map((r, i) => ({
    date: r.date,
    rate: r.rate ?? 0,
    isAnomaly: i > 0 ? ((dailyRows[i - 1].rate ?? 0) - (r.rate ?? 0)) > 10 : false,
  }));

  const volumeRows = await db.execute<{ status: string; count: number }>(sql`
    SELECT status, COUNT(*)::int AS count
    FROM deliveries
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      AND status IN ('delivered', 'failed', 'cancelled', 'returned')
    GROUP BY status
    ORDER BY count DESC
  `);

  const phaseRows = await db.execute<{ leg_type: string; avg_minutes: number; sla_hours: number }>(sql`
    SELECT
      leg_type,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)::int AS avg_minutes,
      AVG(sla_hours) AS sla_hours
    FROM delivery_legs
    WHERE completed_at IS NOT NULL AND started_at IS NOT NULL
      AND created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
    GROUP BY leg_type
  `);

  const lateRows = await db.execute<{ bucket: string; count: number }>(sql`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))) / 60 BETWEEN 0 AND 15 THEN '0-15 min'
        WHEN EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))) / 60 BETWEEN 15 AND 30 THEN '15-30 min'
        WHEN EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))) / 60 BETWEEN 30 AND 60 THEN '30-60 min'
        ELSE '>60 min'
      END AS bucket,
      COUNT(*)::int AS count
    FROM deliveries
    WHERE status = 'delivered'
      AND updated_at > COALESCE(driver_eta_at, system_eta_at)
      AND updated_at >= ${from.toISOString()} AND updated_at <= ${to.toISOString()}
    GROUP BY bucket
    ORDER BY MIN(EXTRACT(EPOCH FROM (updated_at - COALESCE(driver_eta_at, system_eta_at))))
  `);

  return {
    dailyOnTimeRate,
    volumeByOutcome: volumeRows.map((r) => ({ status: r.status, count: r.count })),
    phaseBreakdown: phaseRows.map((r) => ({
      legType: r.leg_type,
      avgMinutes: Math.round(r.avg_minutes ?? 0),
      slaHours: r.sla_hours ?? 1,
    })),
    lateDistribution: lateRows.map((r) => ({ bucket: r.bucket, count: r.count })),
  };
}

// ─── Driver Performance ───────────────────────────────────────────────────────

export async function getDriverPerformance(from: Date, to: Date): Promise<DriverPerformanceRow[]> {
  const rows = await db.execute<{
    driver_id: string;
    name: string;
    total_legs: number;
    on_time_pct: number;
    completion_pct: number;
    ghost_rate: number;
    avg_rating: number;
  }>(sql`
    SELECT
      dl.actor_id AS driver_id,
      u.name,
      COUNT(dl.id)::int AS total_legs,
      ROUND(
        100.0 * COUNT(dl.id) FILTER (WHERE dl.completed_at <= COALESCE(dl.driver_eta_at, dl.system_eta_at) AND dl.completed_at IS NOT NULL)
        / NULLIF(COUNT(dl.id) FILTER (WHERE dl.completed_at IS NOT NULL), 0),
      2) AS on_time_pct,
      ROUND(
        100.0 * COUNT(dl.id) FILTER (WHERE dl.status = 'delivered')
        / NULLIF(COUNT(dl.id) FILTER (WHERE dl.status != 'pending'), 0),
      2) AS completion_pct,
      ROUND(
        100.0 * COUNT(de.id) FILTER (
          WHERE de.to_status IN ('cancelled', 'failed')
            AND de.triggered_by = dr.user_id
            AND NOT EXISTS (
              SELECT 1 FROM delivery_events prev
              WHERE prev.delivery_id = de.delivery_id AND prev.to_status = 'picked_up'
                AND prev.created_at < de.created_at
            )
        )
        / NULLIF(COUNT(dl.id) FILTER (WHERE dl.status != 'pending'), 0),
      2) AS ghost_rate,
      COALESCE(AVG(dr2.rating), 0) AS avg_rating
    FROM delivery_legs dl
    JOIN drivers dr ON dr.id = dl.actor_id
    JOIN users u ON u.id = dr.user_id
    LEFT JOIN delivery_events de ON de.leg_id = dl.id
    LEFT JOIN delivery_ratings dr2 ON dr2.driver_id = dl.actor_id
      AND dr2.created_at >= ${from.toISOString()} AND dr2.created_at <= ${to.toISOString()}
    WHERE dl.actor_type = 'driver'
      AND dl.created_at >= ${from.toISOString()} AND dl.created_at <= ${to.toISOString()}
    GROUP BY dl.actor_id, u.name, dr.user_id
    ORDER BY total_legs DESC
  `);

  return rows.map((r) => {
    const completion = r.completion_pct ?? 0;
    const onTime = r.on_time_pct ?? 0;
    const ghost = r.ghost_rate ?? 0;
    const reliabilityScore = Math.round(
      (completion * 0.4 + onTime * 0.35 + (100 - ghost) * 0.25) * 10
    ) / 10;
    return {
      driverId: r.driver_id,
      name: r.name,
      totalLegs: r.total_legs,
      onTimePct: onTime,
      completionPct: completion,
      ghostRate: ghost,
      avgRating: Math.round((r.avg_rating ?? 0) * 10) / 10,
      reliabilityScore,
    };
  });
}

// ─── Carrier Performance ──────────────────────────────────────────────────────

export async function getCarrierPerformance(from: Date, to: Date): Promise<CarrierPerformanceData> {
  const rows = await db.execute<{
    carrier_id: string;
    name: string;
    avg_actual_hours: number;
    sla_hours: number;
    fulfillment_pct: number;
  }>(sql`
    SELECT
      dl.actor_id AS carrier_id,
      c.name,
      AVG(EXTRACT(EPOCH FROM (dl.completed_at - dl.started_at)) / 3600) AS avg_actual_hours,
      AVG(COALESCE(cso.sla_hours, dl.sla_hours, 24)) AS sla_hours,
      ROUND(
        100.0 * COUNT(dl.id) FILTER (WHERE dl.status = 'delivered')
        / NULLIF(COUNT(dl.id) FILTER (WHERE dl.status != 'pending'), 0),
      2) AS fulfillment_pct
    FROM delivery_legs dl
    JOIN carriers c ON c.id = dl.actor_id
    LEFT JOIN carrier_sla_overrides cso
      ON cso.carrier_id = dl.actor_id
      AND cso.origin_zone = dl.pickup_zone
      AND cso.destination_zone = dl.dropoff_zone
    WHERE dl.actor_type = 'carrier'
      AND dl.created_at >= ${from.toISOString()} AND dl.created_at <= ${to.toISOString()}
    GROUP BY dl.actor_id, c.name
    ORDER BY avg_actual_hours ASC
  `);

  const [overrideResult] = await db.execute<{ configured: number; total: number }>(sql`
    SELECT
      COUNT(DISTINCT (dl.actor_id, dl.pickup_zone, dl.dropoff_zone)) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM carrier_sla_overrides cso
          WHERE cso.carrier_id = dl.actor_id
            AND cso.origin_zone = dl.pickup_zone
            AND cso.destination_zone = dl.dropoff_zone
        )
      )::int AS configured,
      COUNT(DISTINCT (dl.actor_id, dl.pickup_zone, dl.dropoff_zone))::int AS total
    FROM delivery_legs dl
    WHERE dl.actor_type = 'carrier'
      AND dl.created_at >= ${from.toISOString()} AND dl.created_at <= ${to.toISOString()}
  `);

  return {
    rows: rows.map((r) => {
      const avgActual = r.avg_actual_hours ?? 0;
      const sla = r.sla_hours ?? 24;
      return {
        carrierId: r.carrier_id,
        name: r.name,
        avgActualHours: Math.round(avgActual * 10) / 10,
        slaHours: sla,
        adherencePct: Math.round(Math.min(100, (sla / Math.max(avgActual, 0.1)) * 100) * 10) / 10,
        fulfillmentPct: r.fulfillment_pct ?? 0,
      };
    }),
    overrideCoverage: {
      configured: overrideResult?.configured ?? 0,
      total: overrideResult?.total ?? 0,
    },
  };
}

// ─── Customer Experience ──────────────────────────────────────────────────────

export async function getCustomerExperience(from: Date, to: Date): Promise<CustomerExperienceData> {
  const freqTrend = await db.execute<{ date: string; avg_updates: number }>(sql`
    SELECT
      DATE(de.created_at)::text AS date,
      AVG(counts.cnt) AS avg_updates
    FROM (
      SELECT delivery_id, DATE(created_at) AS day, COUNT(*) AS cnt
      FROM delivery_events
      WHERE to_status = ANY(${CUSTOMER_FACING_STATUSES}::text[])
        AND created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      GROUP BY delivery_id, DATE(created_at)
    ) counts
    JOIN delivery_events de ON de.delivery_id = counts.delivery_id
    GROUP BY DATE(de.created_at)
    ORDER BY date
  `);

  const [avgFreqResult] = await db.execute<{ avg: number }>(sql`
    SELECT AVG(cnt) AS avg FROM (
      SELECT delivery_id, COUNT(*) AS cnt
      FROM delivery_events
      WHERE to_status = ANY(${CUSTOMER_FACING_STATUSES}::text[])
        AND created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
      GROUP BY delivery_id
    ) s
  `);

  const disputeTrend = await db.execute<{ date: string; rate: number }>(sql`
    SELECT
      DATE(created_at)::text AS date,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status IN ('failed') AND failure_cause IS NOT NULL)
        / NULLIF(COUNT(*), 0),
      2) AS rate
    FROM delivery_events
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
    GROUP BY DATE(created_at)
    ORDER BY date
  `);

  const [avgDisputeResult] = await db.execute<{ rate: number }>(sql`
    SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE failure_cause IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS rate
    FROM delivery_events
    WHERE created_at >= ${from.toISOString()} AND created_at <= ${to.toISOString()}
  `);

  const [resolutionResult] = await db.execute<{ avg_hours: number }>(sql`
    SELECT AVG(
      EXTRACT(EPOCH FROM (de_resolve.created_at - de_open.created_at)) / 3600
    ) AS avg_hours
    FROM delivery_events de_open
    JOIN delivery_events de_resolve ON de_resolve.delivery_id = de_open.delivery_id
      AND de_resolve.to_status = 'delivered'
      AND de_resolve.created_at > de_open.created_at
    WHERE de_open.failure_cause IS NOT NULL
      AND de_open.created_at >= ${from.toISOString()} AND de_open.created_at <= ${to.toISOString()}
  `);

  // Repeat booking rate: customers who booked again within N days of their first delivery in period
  const now = to;
  const cutoff30 = new Date(now);
  cutoff30.setUTCDate(cutoff30.getUTCDate() - 30);
  const cutoff60 = new Date(now);
  cutoff60.setUTCDate(cutoff60.getUTCDate() - 60);

  const [repeat30] = await db.execute<{ rate: number }>(sql`
    SELECT ROUND(
      100.0 * COUNT(DISTINCT repeat.customer_id) / NULLIF(COUNT(DISTINCT first.customer_id), 0),
    2) AS rate
    FROM deliveries first
    LEFT JOIN deliveries repeat
      ON repeat.customer_id = first.customer_id
      AND repeat.id != first.id
      AND repeat.created_at BETWEEN ${cutoff30.toISOString()} AND ${now.toISOString()}
    WHERE first.created_at >= ${from.toISOString()} AND first.created_at <= ${to.toISOString()}
  `);

  const [repeat60] = await db.execute<{ rate: number }>(sql`
    SELECT ROUND(
      100.0 * COUNT(DISTINCT repeat.customer_id) / NULLIF(COUNT(DISTINCT first.customer_id), 0),
    2) AS rate
    FROM deliveries first
    LEFT JOIN deliveries repeat
      ON repeat.customer_id = first.customer_id
      AND repeat.id != first.id
      AND repeat.created_at BETWEEN ${cutoff60.toISOString()} AND ${now.toISOString()}
    WHERE first.created_at >= ${from.toISOString()} AND first.created_at <= ${to.toISOString()}
  `);

  return {
    updateFrequencyTrend: freqTrend.map((r) => ({ date: r.date, value: r.avg_updates ?? 0 })),
    avgUpdateFrequency: Math.round((avgFreqResult?.avg ?? 0) * 10) / 10,
    disputeRateTrend: disputeTrend.map((r) => ({ date: r.date, value: r.rate ?? 0 })),
    avgDisputeRate: avgDisputeResult?.rate ?? 0,
    avgResolutionHours: Math.round((resolutionResult?.avg_hours ?? 0) * 10) / 10,
    repeatRate30d: repeat30?.rate ?? 0,
    repeatRate60d: repeat60?.rate ?? 0,
  };
}

// ─── Root Cause ────────────────────────────────────────────────────────────────

export async function getRootCause(params: RootCauseParams): Promise<RootCauseData> {
  const { start, end, zone, driverId, carrierId, legType, timeOfDay } = params;

  const zoneClause = zone ? sql`AND dl.dropoff_zone = ${zone}` : sql``;
  const driverClause = driverId ? sql`AND dl.actor_id = ${driverId} AND dl.actor_type = 'driver'` : sql``;
  const carrierClause = carrierId ? sql`AND dl.actor_id = ${carrierId} AND dl.actor_type = 'carrier'` : sql``;
  const legTypeClause = legType ? sql`AND dl.leg_type = ${legType}` : sql``;
  const todClause = timeOfDay ? sql.raw(timeOfDayFilter('de.created_at', timeOfDay)) : sql.raw('TRUE');

  const decomp = await db.execute<{ cause: string; count: number }>(sql`
    SELECT
      COALESCE(de.failure_cause, 'unknown') AS cause,
      COUNT(*)::int AS count
    FROM delivery_events de
    JOIN delivery_legs dl ON dl.id = de.leg_id
    WHERE de.created_at >= ${start.toISOString()} AND de.created_at <= ${end.toISOString()}
      AND de.failure_cause IS NOT NULL
      AND ${todClause}
      ${zoneClause}
      ${driverClause}
      ${carrierClause}
      ${legTypeClause}
    GROUP BY cause
    ORDER BY count DESC
  `);

  const total = decomp.reduce((s, r) => s + r.count, 0);
  const failureDecomposition: FailureShare[] = decomp.map((r) => ({
    cause: r.cause,
    count: r.count,
    pct: total > 0 ? Math.round((r.count / total) * 100 * 10) / 10 : 0,
  }));

  const topRows = await db.execute<{
    actor_type: string;
    actor_id: string;
    name: string;
    late_count: number;
    avg_late_minutes: number;
    top_zone: string;
    top_tod: string;
  }>(sql`
    SELECT
      dl.actor_type,
      dl.actor_id,
      COALESCE(u.name, c.name, 'Unknown') AS name,
      COUNT(*)::int AS late_count,
      AVG(
        EXTRACT(EPOCH FROM (dl.completed_at - COALESCE(dl.driver_eta_at, dl.system_eta_at))) / 60
      )::int AS avg_late_minutes,
      MODE() WITHIN GROUP (ORDER BY dl.dropoff_zone) AS top_zone,
      MODE() WITHIN GROUP (ORDER BY
        CASE
          WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 6 AND 10 THEN 'morning'
          WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 10 AND 15 THEN 'midday'
          WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 15 AND 19 THEN 'evening'
          ELSE 'night'
        END
      ) AS top_tod
    FROM delivery_legs dl
    LEFT JOIN drivers dr ON dr.id = dl.actor_id AND dl.actor_type = 'driver'
    LEFT JOIN users u ON u.id = dr.user_id
    LEFT JOIN carriers c ON c.id = dl.actor_id AND dl.actor_type = 'carrier'
    WHERE dl.completed_at > COALESCE(dl.driver_eta_at, dl.system_eta_at)
      AND dl.completed_at IS NOT NULL
      AND dl.created_at >= ${start.toISOString()} AND dl.created_at <= ${end.toISOString()}
      ${zoneClause}
      ${legTypeClause}
    GROUP BY dl.actor_type, dl.actor_id, COALESCE(u.name, c.name, 'Unknown')
    ORDER BY late_count DESC
    LIMIT 5
  `);

  const heatRows = await db.execute<{ zone: string; time_of_day: string; avg_delay: number }>(sql`
    SELECT
      COALESCE(dl.dropoff_zone, 'Other') AS zone,
      CASE
        WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 6 AND 10 THEN 'morning'
        WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 10 AND 15 THEN 'midday'
        WHEN EXTRACT(HOUR FROM dl.completed_at) BETWEEN 15 AND 19 THEN 'evening'
        ELSE 'night'
      END AS time_of_day,
      AVG(
        EXTRACT(EPOCH FROM (dl.completed_at - COALESCE(dl.driver_eta_at, dl.system_eta_at))) / 60
      )::int AS avg_delay
    FROM delivery_legs dl
    WHERE dl.completed_at > COALESCE(dl.driver_eta_at, dl.system_eta_at)
      AND dl.completed_at IS NOT NULL
      AND dl.created_at >= ${start.toISOString()} AND dl.created_at <= ${end.toISOString()}
    GROUP BY zone, time_of_day
  `);

  return {
    failureDecomposition,
    topContributors: topRows.map((r) => ({
      actorType: r.actor_type as 'driver' | 'carrier',
      actorId: r.actor_id,
      name: r.name,
      lateCount: r.late_count,
      avgMinutesLate: r.avg_late_minutes,
      topZone: r.top_zone ?? 'Other',
      topTimeOfDay: r.top_tod ?? 'midday',
    })),
    heatmap: heatRows.map((r) => ({
      zone: r.zone,
      timeOfDay: r.time_of_day,
      avgDelayMinutes: r.avg_delay ?? 0,
    })),
  };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|analytics-service"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/analytics-service.ts apps/api/src/services/__tests__/analytics-service.test.ts
git commit -m "feat(api): analytics service — six query functions for ops intelligence analytics suite"
```

---

### Task 3: Wire analytics API endpoints

**Files:**
- Modify: `apps/api/src/routes/admin/analytics.ts`

**Interfaces:**
- Consumes: all six functions from Task 2
- Produces:
  - `GET /api/v1/admin/analytics/overview?period=week`
  - `GET /api/v1/admin/analytics/delivery-performance?period=week`
  - `GET /api/v1/admin/analytics/driver-performance?period=week`
  - `GET /api/v1/admin/analytics/carrier-performance?period=week`
  - `GET /api/v1/admin/analytics/customer-experience?period=week`
  - `GET /api/v1/admin/analytics/root-cause?period=week&zone=Lekki&timeOfDay=evening&legType=first_mile`

- [ ] **Step 1: Replace the scaffold with full endpoints**

Replace the entire content of `apps/api/src/routes/admin/analytics.ts`:

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';
import {
  periodToDates,
  getOverviewKpis,
  getDeliveryPerformance,
  getDriverPerformance,
  getCarrierPerformance,
  getCustomerExperience,
  getRootCause,
} from '../../services/analytics-service';

type Env = {
  Variables: { user: AuthUser; accessToken: string; userRoles: UserRole[] };
};

const analyticsRoutes = new Hono<Env>();
analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', requireRole('surewaka_admin'));

function getPeriod(c: { req: { query: (k: string) => string | undefined } }) {
  const period = c.req.query('period') ?? 'week';
  const from = c.req.query('from');
  const to = c.req.query('to');
  return periodToDates(period, from, to);
}

analyticsRoutes.get('/overview', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getOverviewKpis(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/overview]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load overview' }, meta: null }, 500);
  }
});

analyticsRoutes.get('/delivery-performance', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getDeliveryPerformance(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/delivery-performance]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load delivery performance' }, meta: null }, 500);
  }
});

analyticsRoutes.get('/driver-performance', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getDriverPerformance(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/driver-performance]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load driver performance' }, meta: null }, 500);
  }
});

analyticsRoutes.get('/carrier-performance', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getCarrierPerformance(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/carrier-performance]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load carrier performance' }, meta: null }, 500);
  }
});

analyticsRoutes.get('/customer-experience', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getCustomerExperience(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/customer-experience]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load customer experience' }, meta: null }, 500);
  }
});

analyticsRoutes.get('/root-cause', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getRootCause({
      start,
      end,
      zone: c.req.query('zone'),
      driverId: c.req.query('driverId'),
      carrierId: c.req.query('carrierId'),
      legType: c.req.query('legType'),
      timeOfDay: c.req.query('timeOfDay') as 'morning' | 'midday' | 'evening' | 'night' | undefined,
    });
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/root-cause]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load root cause data' }, meta: null }, 500);
  }
});

export default analyticsRoutes;
```

- [ ] **Step 2: Verify endpoints respond**

```bash
pnpm --filter @surewaka/api dev &
sleep 3
curl -s "http://localhost:4000/api/v1/admin/analytics/overview?period=week" -H "Authorization: Bearer test" | python3 -m json.tool | head -5
```

Expected: either data or an auth error (not 501).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/admin/analytics.ts
git commit -m "feat(api): wire six analytics endpoints — overview, delivery, driver, carrier, customer, root-cause"
```

---

### Task 4: Frontend hook — `use-analytics.ts`

**Files:**
- Create: `apps/admin/app/hooks/use-analytics.ts`

**Interfaces:**
- Consumes: all six API endpoints from Task 3
- Produces:
  - `useAnalyticsOverview(params: AnalyticsParams): { data: OverviewKpis | null; isLoading: boolean; error: string | null }`
  - `useAnalyticsDeliveryPerformance(params)`, `useAnalyticsDriverPerformance(params)`, `useAnalyticsCarrierPerformance(params)`, `useAnalyticsCustomerExperience(params)`, `useAnalyticsRootCause(params & RootCauseFilters)`
  - `type AnalyticsParams = { period: 'today' | 'week' | 'month' | 'custom'; from?: string; to?: string }`
  - `type RootCauseFilters = { zone?: string; driverId?: string; carrierId?: string; legType?: string; timeOfDay?: string }`

- [ ] **Step 1: Create the hook file**

```typescript
// apps/admin/app/hooks/use-analytics.ts
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import type {
  OverviewKpis,
  DeliveryPerformanceData,
  DriverPerformanceRow,
  CarrierPerformanceData,
  CustomerExperienceData,
  RootCauseData,
} from '@surewaka/shared';

export type AnalyticsParams = {
  period: 'today' | 'week' | 'month' | 'custom';
  from?: string;
  to?: string;
};

export type RootCauseFilters = {
  zone?: string;
  driverId?: string;
  carrierId?: string;
  legType?: string;
  timeOfDay?: string;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function buildQuery(params: AnalyticsParams & Partial<RootCauseFilters>): string {
  const q = new URLSearchParams();
  if (params.period) q.set('period', params.period);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.zone) q.set('zone', params.zone);
  if (params.driverId) q.set('driverId', params.driverId);
  if (params.carrierId) q.set('carrierId', params.carrierId);
  if (params.legType) q.set('legType', params.legType);
  if (params.timeOfDay) q.set('timeOfDay', params.timeOfDay);
  return q.toString();
}

function useAnalyticsEndpoint<T>(
  endpoint: string,
  params: AnalyticsParams & Partial<RootCauseFilters>,
): { data: T | null; isLoading: boolean; error: string | null } {
  const { getToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = buildQuery(params);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) { setError('Not authenticated'); setIsLoading(false); return; }
        const res = await fetch(`${API_URL}/api/v1/admin/analytics/${endpoint}?${queryString}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? `Request failed: ${res.status}`);
          setData(null);
          setIsLoading(false);
          return;
        }
        const body = await res.json();
        setData(body.data ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Unexpected error');
        setData(null);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    fetchData();
    return () => controller.abort();
  }, [endpoint, queryString]);

  return { data, isLoading, error };
}

export function useAnalyticsOverview(params: AnalyticsParams) {
  return useAnalyticsEndpoint<OverviewKpis>('overview', params);
}

export function useAnalyticsDeliveryPerformance(params: AnalyticsParams) {
  return useAnalyticsEndpoint<DeliveryPerformanceData>('delivery-performance', params);
}

export function useAnalyticsDriverPerformance(params: AnalyticsParams) {
  return useAnalyticsEndpoint<DriverPerformanceRow[]>('driver-performance', params);
}

export function useAnalyticsCarrierPerformance(params: AnalyticsParams) {
  return useAnalyticsEndpoint<CarrierPerformanceData>('carrier-performance', params);
}

export function useAnalyticsCustomerExperience(params: AnalyticsParams) {
  return useAnalyticsEndpoint<CustomerExperienceData>('customer-experience', params);
}

export function useAnalyticsRootCause(params: AnalyticsParams & RootCauseFilters) {
  return useAnalyticsEndpoint<RootCauseData>('root-cause', params);
}
```

Note: `OverviewKpis`, `DeliveryPerformanceData`, etc. must be re-exported from `packages/shared/src/types.ts` (add them in the same commit that adds the backend types, or add them now if they weren't exported yet).

- [ ] **Step 2: Export analytics types from shared package**

In `packages/shared/src/types.ts`, add exports for the analytics types (copy from `analytics-service.ts`):

```typescript
// Analytics types — mirrored from analytics-service response shapes
export type SparkPoint = { date: string; value: number };

export type OverviewKpis = {
  onTimeRate: number; onTimeRateSparkline: SparkPoint[];
  fulfillmentRate: number; fulfillmentRateSparkline: SparkPoint[];
  avgDeliveryMinutes: number; avgDeliveryMinutesSparkline: SparkPoint[];
  disputeRate: number; disputeRateSparkline: SparkPoint[];
  customerUpdateFrequency: number; customerUpdateFrequencySparkline: SparkPoint[];
  driverCompletionRate: number; driverCompletionRateSparkline: SparkPoint[];
};

export type DailyOnTimePoint = { date: string; rate: number; isAnomaly: boolean };
export type OutcomeBar = { status: string; count: number };
export type PhaseBar = { legType: string; avgMinutes: number; slaHours: number };
export type LateDistBar = { bucket: string; count: number };

export type DeliveryPerformanceData = {
  dailyOnTimeRate: DailyOnTimePoint[];
  volumeByOutcome: OutcomeBar[];
  phaseBreakdown: PhaseBar[];
  lateDistribution: LateDistBar[];
};

export type DriverPerformanceRow = {
  driverId: string; name: string; totalLegs: number;
  onTimePct: number; completionPct: number; ghostRate: number;
  avgRating: number; reliabilityScore: number;
};

export type CarrierSlaRow = {
  carrierId: string; name: string; avgActualHours: number;
  slaHours: number; adherencePct: number; fulfillmentPct: number;
};

export type CarrierPerformanceData = {
  rows: CarrierSlaRow[];
  overrideCoverage: { configured: number; total: number };
};

export type CustomerExperienceData = {
  updateFrequencyTrend: SparkPoint[]; avgUpdateFrequency: number;
  disputeRateTrend: SparkPoint[]; avgDisputeRate: number;
  avgResolutionHours: number; repeatRate30d: number; repeatRate60d: number;
};

export type FailureShare = { cause: string; count: number; pct: number };
export type TopContributor = {
  actorType: 'driver' | 'carrier'; actorId: string; name: string;
  lateCount: number; avgMinutesLate: number; topZone: string; topTimeOfDay: string;
};
export type HeatCell = { zone: string; timeOfDay: string; avgDelayMinutes: number };

export type RootCauseData = {
  failureDecomposition: FailureShare[];
  topContributors: TopContributor[];
  heatmap: HeatCell[];
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/shared build && pnpm --filter @surewaka/admin build 2>&1 | tail -10
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/hooks/use-analytics.ts packages/shared/src/types.ts
git commit -m "feat(admin): add use-analytics hooks and shared analytics response types"
```

---

### Task 5: Period selector + KPI card components

**Files:**
- Create: `apps/admin/app/components/analytics/period-selector.tsx`
- Create: `apps/admin/app/components/analytics/kpi-card.tsx`

**Interfaces:**
- Produces:
  - `<PeriodSelector value={AnalyticsParams} onChange={(p: AnalyticsParams) => void} />`
  - `<KpiCard label title value trend sparkline isLoading />`
- Both consumed by all six tab components

- [ ] **Step 1: Create PeriodSelector**

```typescript
// apps/admin/app/components/analytics/period-selector.tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import type { AnalyticsParams } from '~/hooks/use-analytics';

type Props = {
  value: AnalyticsParams;
  onChange: (p: AnalyticsParams) => void;
};

export function PeriodSelector({ value, onChange }: Props) {
  return (
    <Select
      value={value.period}
      onValueChange={(period) =>
        onChange({ period: period as AnalyticsParams['period'] })
      }
    >
      <SelectTrigger className="w-[160px]" aria-label="Select time period">
        <SelectValue placeholder="Select period" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="today">Today</SelectItem>
        <SelectItem value="week">This Week</SelectItem>
        <SelectItem value="month">This Month</SelectItem>
        <SelectItem value="custom">Custom</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Create KpiCard**

```typescript
// apps/admin/app/components/analytics/kpi-card.tsx
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import type { SparkPoint } from '@surewaka/shared';

type Props = {
  label: string;
  value: number | undefined;
  unit?: string;
  sparkline?: SparkPoint[];
  target?: number;
  higherIsBetter?: boolean;
  isLoading?: boolean;
};

export function KpiCard({ label, value, unit = '', sparkline, target, higherIsBetter = true, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-8 w-20" />
        <Skeleton className="mt-2 h-3 w-24" />
      </div>
    );
  }

  const latest = sparkline?.at(-1)?.value;
  const prev = sparkline?.at(-2)?.value;
  const delta = latest !== undefined && prev !== undefined ? latest - prev : undefined;
  const isGood = delta === undefined ? null : (higherIsBetter ? delta >= 0 : delta <= 0);
  const isBelowTarget = target !== undefined && value !== undefined && (higherIsBetter ? value < target : value > target);

  return (
    <div className={cn('rounded-lg border p-4', isBelowTarget ? 'border-destructive/50 bg-destructive/5' : 'border-border')}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold text-foreground">
        {value !== undefined ? `${value}${unit}` : '—'}
      </p>
      {delta !== undefined && (
        <p className={cn('mt-1 flex items-center gap-1 text-xs font-medium',
          isGood ? 'text-green-600 dark:text-green-400' : 'text-destructive',
        )}>
          {isGood === null ? <Minus className="h-3 w-3" /> : isGood ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{isGood ? '+' : ''}{delta.toFixed(1)}{unit} vs prev</span>
        </p>
      )}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-3 h-12" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkline}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={isBelowTarget ? 'var(--color-destructive)' : 'var(--color-primary)'}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/admin build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/components/analytics/period-selector.tsx apps/admin/app/components/analytics/kpi-card.tsx
git commit -m "feat(admin): add PeriodSelector and KpiCard shared analytics components"
```

---

### Task 6: Overview tab

**Files:**
- Create: `apps/admin/app/components/analytics/overview-tab.tsx`

**Interfaces:**
- Consumes: `useAnalyticsOverview`, `KpiCard`, `PeriodSelector`
- Produces: `<OverviewTab params={AnalyticsParams} />`

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/app/components/analytics/overview-tab.tsx
import { KpiCard } from './kpi-card';
import { useAnalyticsOverview } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';

type Props = { params: AnalyticsParams };

export function OverviewTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsOverview(params);

  if (error) {
    return <p className="mt-4 text-sm text-destructive">Failed to load overview: {error}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="On-Time Rate"
        value={data?.onTimeRate}
        unit="%"
        sparkline={data?.onTimeRateSparkline}
        target={90}
        higherIsBetter
        isLoading={isLoading}
      />
      <KpiCard
        label="Fulfillment Rate"
        value={data?.fulfillmentRate}
        unit="%"
        sparkline={data?.fulfillmentRateSparkline}
        target={95}
        higherIsBetter
        isLoading={isLoading}
      />
      <KpiCard
        label="Avg Delivery Time"
        value={data?.avgDeliveryMinutes}
        unit=" min"
        sparkline={data?.avgDeliveryMinutesSparkline}
        higherIsBetter={false}
        isLoading={isLoading}
      />
      <KpiCard
        label="Dispute Rate"
        value={data?.disputeRate}
        unit="%"
        sparkline={data?.disputeRateSparkline}
        target={2}
        higherIsBetter={false}
        isLoading={isLoading}
      />
      <KpiCard
        label="Customer Update Frequency"
        value={data?.customerUpdateFrequency}
        unit=" updates/delivery"
        sparkline={data?.customerUpdateFrequencySparkline}
        target={3}
        higherIsBetter
        isLoading={isLoading}
      />
      <KpiCard
        label="Driver Completion Rate"
        value={data?.driverCompletionRate}
        unit="%"
        sparkline={data?.driverCompletionRateSparkline}
        target={97}
        higherIsBetter
        isLoading={isLoading}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/analytics/overview-tab.tsx
git commit -m "feat(admin): add OverviewTab — six KPI cards with sparklines"
```

---

### Task 7: Delivery Performance tab

**Files:**
- Create: `apps/admin/app/components/analytics/delivery-performance-tab.tsx`

**Interfaces:**
- Consumes: `useAnalyticsDeliveryPerformance`, recharts
- Produces: `<DeliveryPerformanceTab params={AnalyticsParams} />`

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/app/components/analytics/delivery-performance-tab.tsx
import { useAnalyticsDeliveryPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  BarChart, Bar, LabelList, Cell,
} from 'recharts';

type Props = { params: AnalyticsParams };

const STATUS_COLORS: Record<string, string> = {
  delivered: '#16a34a',
  failed: '#dc2626',
  cancelled: '#6b7280',
  returned: '#f59e0b',
};

export function DeliveryPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsDeliveryPerformance(params);

  if (error) return <p className="mt-4 text-sm text-destructive">Failed to load delivery performance: {error}</p>;

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* On-time rate trend */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">On-Time Rate Trend</h3>
        {data.dailyOnTimeRate.length === 0 ? (
          <p className="text-sm text-muted-foreground">No delivery data for this period.</p>
        ) : (
          <>
            <div className="h-52" aria-label="On-time rate trend chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailyOnTimeRate}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'On-Time Rate']} />
                  <ReferenceLine y={80} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '80% target', fontSize: 10, fill: '#dc2626' }} />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload } = props;
                      if (payload.isAnomaly) {
                        return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={5} fill="#dc2626" stroke="white" strokeWidth={1.5} />;
                      }
                      return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={3} fill="#16a34a" />;
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* Accessible table alternative */}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">View as table</summary>
              <table className="mt-2 w-full text-xs">
                <thead><tr><th className="text-left">Date</th><th className="text-right">Rate (%)</th><th className="text-right">Anomaly</th></tr></thead>
                <tbody>{data.dailyOnTimeRate.map((r) => (
                  <tr key={r.date}><td>{r.date}</td><td className="text-right">{r.rate}</td><td className="text-right">{r.isAnomaly ? '⚠ Yes' : '—'}</td></tr>
                ))}</tbody>
              </table>
            </details>
          </>
        )}
      </section>

      {/* Volume by outcome */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Delivery Volume by Outcome</h3>
        {data.volumeByOutcome.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deliveries in this period.</p>
        ) : (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.volumeByOutcome} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="status" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11 }} />
                  {data.volumeByOutcome.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Phase breakdown */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Phase Breakdown vs SLA</h3>
        {data.phaseBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed legs in this period.</p>
        ) : (
          <div className="space-y-3">
            {data.phaseBreakdown.map((p) => {
              const slaMin = p.slaHours * 60;
              const pct = Math.min(100, (p.avgMinutes / slaMin) * 100);
              const isOver = p.avgMinutes > slaMin;
              return (
                <div key={p.legType}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize">{p.legType.replace('_', ' ')}</span>
                    <span className={isOver ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                      {isOver ? '⚠ ' : ''}{p.avgMinutes} min avg / {slaMin} min SLA
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${isOver ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Late distribution */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Late Delivery Distribution</h3>
        {data.lateDistribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">No late deliveries in this period.</p>
        ) : (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.lateDistribution} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="bucket" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/analytics/delivery-performance-tab.tsx
git commit -m "feat(admin): add DeliveryPerformanceTab — on-time trend, volume by outcome, phase breakdown, late distribution"
```

---

### Task 8: Driver Performance tab

**Files:**
- Create: `apps/admin/app/components/analytics/driver-performance-tab.tsx`

**Interfaces:**
- Consumes: `useAnalyticsDriverPerformance`, TanStack Table (already in admin)
- Produces: `<DriverPerformanceTab params={AnalyticsParams} />`

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/app/components/analytics/driver-performance-tab.tsx
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { useAnalyticsDriverPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import type { DriverPerformanceRow } from '@surewaka/shared';
import { cn } from '~/lib/utils';

const col = createColumnHelper<DriverPerformanceRow>();

const columns = [
  col.accessor('name', { header: 'Driver', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
  col.accessor('totalLegs', { header: 'Legs' }),
  col.accessor('onTimePct', { header: 'On-Time %', cell: (i) => `${i.getValue()}%` }),
  col.accessor('completionPct', { header: 'Completion %', cell: (i) => `${i.getValue()}%` }),
  col.accessor('ghostRate', {
    header: 'Ghost Rate',
    cell: (i) => {
      const v = i.getValue();
      return <span className={v > 5 ? 'text-destructive font-medium' : ''}>{v > 5 ? '⚠ ' : ''}{v}%</span>;
    },
  }),
  col.accessor('avgRating', { header: 'Avg Rating', cell: (i) => `${i.getValue()} / 5` }),
  col.accessor('reliabilityScore', {
    header: 'Reliability',
    cell: (i) => {
      const v = i.getValue();
      return (
        <span className={cn('font-bold', v >= 80 ? 'text-green-600' : v >= 60 ? 'text-amber-600' : 'text-destructive')}>
          {v}
        </span>
      );
    },
  }),
];

type Props = { params: AnalyticsParams };

export function DriverPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsDriverPerformance(params);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'reliabilityScore', desc: true }]);

  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (error) return <p className="text-sm text-destructive">Failed to load driver performance: {error}</p>;

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No driver data for this period.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm" aria-label="Driver performance table">
        <thead className="bg-muted/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="cursor-pointer px-4 py-3 text-left font-medium text-muted-foreground select-none"
                  onClick={h.column.getToggleSortingHandler()}
                  aria-sort={h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : 'none'}
                >
                  <span className="flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc' ? <ChevronUp className="h-3 w-3" /> :
                     h.column.getIsSorted() === 'desc' ? <ChevronDown className="h-3 w-3" /> :
                     <ArrowUpDown className="h-3 w-3 opacity-30" />}
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-border hover:bg-muted/30">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/analytics/driver-performance-tab.tsx
git commit -m "feat(admin): add DriverPerformanceTab — sortable table with reliability score, ghost rate, avg rating"
```

---

### Task 9: Carrier Performance tab

**Files:**
- Create: `apps/admin/app/components/analytics/carrier-performance-tab.tsx`

**Interfaces:**
- Consumes: `useAnalyticsCarrierPerformance`, recharts
- Produces: `<CarrierPerformanceTab params={AnalyticsParams} />`

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/app/components/analytics/carrier-performance-tab.tsx
import { useAnalyticsCarrierPerformance } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList, ReferenceLine } from 'recharts';

type Props = { params: AnalyticsParams };

export function CarrierPerformanceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsCarrierPerformance(params);

  if (error) return <p className="text-sm text-destructive">Failed to load carrier performance: {error}</p>;
  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (!data || data.rows.length === 0) return <p className="text-sm text-muted-foreground">No carrier data for this period.</p>;

  const { configured, total } = data.overrideCoverage;
  const coveragePct = total > 0 ? Math.round((configured / total) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* SLA coverage indicator */}
      <div className="flex items-center gap-3 rounded-lg border border-border p-4">
        {coveragePct === 100 ? (
          <CheckCircle className="h-5 w-5 text-green-600" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
        )}
        <div>
          <p className="text-sm font-medium">SLA Override Coverage</p>
          <p className="text-xs text-muted-foreground">
            {configured} of {total} carrier-route combinations have a configured SLA override.
            {coveragePct < 100 && ' Remaining routes use the 24-hour default.'}
          </p>
        </div>
        <span className="ml-auto text-lg font-bold">{coveragePct}%</span>
      </div>

      {/* SLA adherence chart */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">SLA Adherence by Carrier</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.rows} layout="vertical">
              <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'SLA Adherence']} />
              <ReferenceLine x={90} stroke="#16a34a" strokeDasharray="4 2" label={{ value: '90%', fontSize: 10, fill: '#16a34a' }} />
              <Bar dataKey="adherencePct" fill="#16a34a" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="adherencePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Fulfillment rate */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">Fulfillment Rate by Carrier</h3>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...data.rows].sort((a, b) => b.fulfillmentPct - a.fulfillmentPct)} layout="vertical">
              <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Fulfillment Rate']} />
              <Bar dataKey="fulfillmentPct" fill="#0369a1" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="fulfillmentPct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Avg leg duration table */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">Average Leg Duration vs SLA</h3>
        <table className="w-full text-sm" aria-label="Carrier SLA comparison table">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Carrier</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Avg Hours</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">SLA Hours</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.carrierId} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right">{r.avgActualHours}h</td>
                <td className="px-3 py-2 text-right">{r.slaHours}h</td>
                <td className="px-3 py-2 text-right">
                  {r.avgActualHours <= r.slaHours ? (
                    <span className="text-green-600 font-medium">✓ Within SLA</span>
                  ) : (
                    <span className="text-destructive font-medium">⚠ Over by {(r.avgActualHours - r.slaHours).toFixed(1)}h</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/analytics/carrier-performance-tab.tsx
git commit -m "feat(admin): add CarrierPerformanceTab — SLA adherence, fulfillment rate, override coverage"
```

---

### Task 10: Customer Experience tab

**Files:**
- Create: `apps/admin/app/components/analytics/customer-experience-tab.tsx`

**Interfaces:**
- Consumes: `useAnalyticsCustomerExperience`, recharts
- Produces: `<CustomerExperienceTab params={AnalyticsParams} />`

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/app/components/analytics/customer-experience-tab.tsx
import { useAnalyticsCustomerExperience } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

type Props = { params: AnalyticsParams };

export function CustomerExperienceTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsCustomerExperience(params);

  if (error) return <p className="text-sm text-destructive">Failed to load customer experience: {error}</p>;
  if (isLoading) return (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
    </div>
  );
  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* Repeat booking — two windows side by side */}
      <section>
        <h3 className="mb-1 text-sm font-semibold">Repeat Booking Rate</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          A large gap between 30-day and 60-day rates indicates customers on a monthly cycle — not churn.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-3xl font-bold text-foreground">{data.repeatRate30d}%</p>
            <p className="mt-1 text-sm text-muted-foreground">30-day window</p>
            <p className="text-xs text-muted-foreground">Frequent shippers</p>
          </div>
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-3xl font-bold text-foreground">{data.repeatRate60d}%</p>
            <p className="mt-1 text-sm text-muted-foreground">60-day window</p>
            <p className="text-xs text-muted-foreground">Monthly SME cycle</p>
          </div>
        </div>
      </section>

      {/* Update frequency trend */}
      <section>
        <h3 className="mb-1 text-sm font-semibold">Customer Update Frequency</h3>
        <p className="text-xs text-muted-foreground mb-3">Avg customer-facing status events per delivery. Target: ≥ 3.</p>
        {data.updateFrequencyTrend.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this period.</p>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.updateFrequencyTrend}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 6]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, 'Avg updates/delivery']} />
                <ReferenceLine y={3} stroke="#16a34a" strokeDasharray="4 2" label={{ value: 'Target: 3', fontSize: 10, fill: '#16a34a' }} />
                <Line type="monotone" dataKey="value" stroke="#0369a1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Dispute rate trend */}
      <section>
        <h3 className="mb-1 text-sm font-semibold">Dispute Rate Trend</h3>
        <p className="text-xs text-muted-foreground mb-3">% of deliveries with a recorded failure cause. Target: &lt; 2%.</p>
        {data.disputeRateTrend.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for this period.</p>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.disputeRateTrend}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 10]} unit="%" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Dispute Rate']} />
                <ReferenceLine y={2} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '2% limit', fontSize: 10, fill: '#dc2626' }} />
                <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Resolution time */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">Avg Dispute Resolution Time</h3>
        <div className="rounded-lg border border-border p-4">
          <p className="text-3xl font-bold text-foreground">{data.avgResolutionHours}h</p>
          <p className="mt-1 text-sm text-muted-foreground">average hours from issue to resolution</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${data.avgResolutionHours <= 24 ? 'bg-green-500' : 'bg-destructive'}`}
              style={{ width: `${Math.min(100, (data.avgResolutionHours / 48) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.avgResolutionHours <= 24 ? '✓ Within 24-hour target' : `⚠ ${(data.avgResolutionHours - 24).toFixed(1)}h over target`}
          </p>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/analytics/customer-experience-tab.tsx
git commit -m "feat(admin): add CustomerExperienceTab — dual repeat booking windows, update frequency, dispute trend, resolution"
```

---

### Task 11: Root Cause Analysis tab

**Files:**
- Create: `apps/admin/app/components/analytics/root-cause-tab.tsx`

**Interfaces:**
- Consumes: `useAnalyticsRootCause`, recharts PieChart, custom CSS heatmap
- Produces: `<RootCauseTab params={AnalyticsParams} />`

- [ ] **Step 1: Create the component**

```typescript
// apps/admin/app/components/analytics/root-cause-tab.tsx
import { useState } from 'react';
import { useAnalyticsRootCause, type RootCauseFilters } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';
import { Skeleton } from '~/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { LAGOS_ZONES } from '@surewaka/shared';
import { cn } from '~/lib/utils';

const CAUSE_COLORS: Record<string, string> = {
  driver: '#f59e0b',
  carrier: '#0369a1',
  route_traffic: '#6b7280',
  system: '#dc2626',
};

const TIME_SLOTS = ['morning', 'midday', 'evening', 'night'] as const;

type Props = { params: AnalyticsParams };

export function RootCauseTab({ params }: Props) {
  const [filters, setFilters] = useState<RootCauseFilters>({});
  const { data, isLoading, error } = useAnalyticsRootCause({ ...params, ...filters });

  const setFilter = (key: keyof RootCauseFilters, value: string | undefined) =>
    setFilters((f) => ({ ...f, [key]: value || undefined }));

  // Build heatmap grid
  const heatCells = data?.heatmap ?? [];
  const maxDelay = Math.max(...heatCells.map((c) => c.avgDelayMinutes), 1);

  if (error) return <p className="text-sm text-destructive">Failed to load root cause data: {error}</p>;

  return (
    <div className="flex gap-6">
      {/* Filter sidebar */}
      <aside className="w-52 shrink-0 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Lagos Zone</label>
          <Select value={filters.zone ?? ''} onValueChange={(v) => setFilter('zone', v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter by Lagos zone"><SelectValue placeholder="All zones" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All zones</SelectItem>
              {LAGOS_ZONES.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Leg Type</label>
          <Select value={filters.legType ?? ''} onValueChange={(v) => setFilter('legType', v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter by leg type"><SelectValue placeholder="All leg types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All leg types</SelectItem>
              <SelectItem value="first_mile">First Mile</SelectItem>
              <SelectItem value="intercity">Intercity</SelectItem>
              <SelectItem value="last_mile">Last Mile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Time of Day</label>
          <Select value={filters.timeOfDay ?? ''} onValueChange={(v) => setFilter('timeOfDay', v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Filter by time of day"><SelectValue placeholder="All hours" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All hours</SelectItem>
              <SelectItem value="morning">Morning (6–10am)</SelectItem>
              <SelectItem value="midday">Midday (10am–3pm)</SelectItem>
              <SelectItem value="evening">Evening rush (3–7pm)</SelectItem>
              <SelectItem value="night">Night (7pm–6am)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </aside>

      {/* Main output */}
      <div className="flex-1 space-y-8 min-w-0">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
          </div>
        ) : !data ? null : (
          <>
            {/* Failure decomposition donut */}
            <section>
              <h3 className="mb-3 text-sm font-semibold">Failure Decomposition</h3>
              {data.failureDecomposition.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failures recorded for this filter combination.</p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.failureDecomposition} dataKey="count" nameKey="cause" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                          {data.failureDecomposition.map((entry) => (
                            <Cell key={entry.cause} fill={CAUSE_COLORS[entry.cause] ?? '#6b7280'} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, name: string) => [v, name]} />
                        <Legend formatter={(v) => v.replace('_', ' ')} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Accessible table */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">View as table</summary>
                    <table className="mt-2 w-full text-xs">
                      <thead><tr><th className="text-left">Cause</th><th className="text-right">Count</th><th className="text-right">%</th></tr></thead>
                      <tbody>{data.failureDecomposition.map((r) => (
                        <tr key={r.cause}><td className="capitalize">{r.cause.replace('_', ' ')}</td><td className="text-right">{r.count}</td><td className="text-right">{r.pct}%</td></tr>
                      ))}</tbody>
                    </table>
                  </details>
                </>
              )}
            </section>

            {/* Top 5 contributors */}
            <section>
              <h3 className="mb-3 text-sm font-semibold">Top Contributors to Delay</h3>
              {data.topContributors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No late deliveries for this filter.</p>
              ) : (
                <ol className="space-y-2">
                  {data.topContributors.map((c, i) => (
                    <li key={c.actorId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <span className="text-lg font-bold text-muted-foreground w-5 shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{c.actorType}</p>
                        <p className="text-xs mt-1">
                          <span className="text-destructive font-medium">{c.lateCount} late deliveries</span>
                          {' · '}avg {c.avgMinutesLate} min late
                          {' · '}mostly {c.topZone}
                          {' · '}{c.topTimeOfDay}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Heatmap: time-of-day × zone */}
            <section>
              <h3 className="mb-3 text-sm font-semibold">Delay Heatmap — Time of Day × Zone</h3>
              {heatCells.length === 0 ? (
                <p className="text-sm text-muted-foreground">No delay data for this filter.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse" aria-label="Delay heatmap by time of day and zone">
                      <thead>
                        <tr>
                          <th className="py-1 pr-3 text-left text-muted-foreground font-medium">Time of Day</th>
                          {LAGOS_ZONES.slice(0, 6).map((z) => (
                            <th key={z} className="px-2 py-1 text-center text-muted-foreground font-medium whitespace-nowrap">{z}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {TIME_SLOTS.map((slot) => (
                          <tr key={slot}>
                            <td className="py-1 pr-3 capitalize font-medium">{slot}</td>
                            {LAGOS_ZONES.slice(0, 6).map((zone) => {
                              const cell = heatCells.find((c) => c.zone === zone && c.timeOfDay === slot);
                              const delay = cell?.avgDelayMinutes ?? 0;
                              const intensity = delay / maxDelay;
                              return (
                                <td key={zone} className="px-2 py-1 text-center" title={`${delay} min avg delay`}>
                                  <span
                                    className={cn(
                                      'inline-block rounded px-2 py-0.5 font-mono',
                                      delay === 0 ? 'text-muted-foreground' :
                                      intensity > 0.66 ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' :
                                      intensity > 0.33 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                                      'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
                                    )}
                                  >
                                    {delay > 0 ? `${delay}m` : '—'}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Higher values = more average delay minutes. Red = worst, green = best.</p>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/analytics/root-cause-tab.tsx
git commit -m "feat(admin): add RootCauseTab — failure donut, top contributors, delay heatmap with zone × time filters"
```

---

### Task 12: Wire analytics route — replace stub with full tab layout

**Files:**
- Modify: `apps/admin/app/routes/analytics.tsx`

**Interfaces:**
- Consumes: all six tab components, `PeriodSelector`, `useAnalyticsOverview` (for period state)
- Produces: functional `/analytics` page with tab navigation

- [ ] **Step 1: Replace the analytics route**

```typescript
// apps/admin/app/routes/analytics.tsx
import { useState } from 'react';
import type { Route } from './+types/analytics';
import { cn } from '~/lib/utils';
import { PeriodSelector } from '~/components/analytics/period-selector';
import { OverviewTab } from '~/components/analytics/overview-tab';
import { DeliveryPerformanceTab } from '~/components/analytics/delivery-performance-tab';
import { DriverPerformanceTab } from '~/components/analytics/driver-performance-tab';
import { CarrierPerformanceTab } from '~/components/analytics/carrier-performance-tab';
import { CustomerExperienceTab } from '~/components/analytics/customer-experience-tab';
import { RootCauseTab } from '~/components/analytics/root-cause-tab';
import type { AnalyticsParams } from '~/hooks/use-analytics';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Analytics' }];
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'delivery', label: 'Delivery Performance' },
  { id: 'drivers', label: 'Driver Performance' },
  { id: 'carriers', label: 'Carrier SLA' },
  { id: 'customer', label: 'Customer Experience' },
  { id: 'rootcause', label: 'Root Cause' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState<AnalyticsParams>({ period: 'week' });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="mt-1 text-muted-foreground">Platform performance and delivery intelligence</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Tab bar */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border pb-0" role="tablist" aria-label="Analytics sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'shrink-0 rounded-t px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="mt-6">
        {activeTab === 'overview' && <OverviewTab params={period} />}
        {activeTab === 'delivery' && <DeliveryPerformanceTab params={period} />}
        {activeTab === 'drivers' && <DriverPerformanceTab params={period} />}
        {activeTab === 'carriers' && <CarrierPerformanceTab params={period} />}
        {activeTab === 'customer' && <CustomerExperienceTab params={period} />}
        {activeTab === 'rootcause' && <RootCauseTab params={period} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
pnpm --filter @surewaka/admin build 2>&1 | tail -15
```

Expected: successful build with no type errors.

- [ ] **Step 3: Start the admin and visually inspect**

```bash
pnpm --filter @surewaka/admin dev
```

Open `http://localhost:3001/analytics`. Verify:
- Six tabs render and switch without error
- Period selector changes the `period` param passed to all hooks
- KPI cards show skeleton while loading, then display values
- Charts render with seed data from Spec 0
- Empty states appear for tabs with no data in selected period
- All charts have accessible table alternatives (expandable `<details>`)

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/routes/analytics.tsx
git commit -m "feat(admin): replace analytics stub with full six-tab analytics suite"
```
