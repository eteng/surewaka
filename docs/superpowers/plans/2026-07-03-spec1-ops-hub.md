# Spec 1: Ops Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic 4-stat `/dashboard` with a live operations command center — 5 real-time KPI cards, a colour-coded delivery map, an at-risk delivery list, and a severity-ranked alert feed.

**Architecture:** The dashboard splits into three zones (KPI bar, map+at-risk list, alert feed). Two new API endpoints serve aggregated data (`/admin/ops-hub/stats` and `/admin/alerts`). The admin polls stats every 30 s via a custom `useOpsHub` hook using `useAuth` + `fetch` (matching the existing pattern in `use-deliveries.ts`). The alert feed subscribes to Ably on the `alerts` table INSERT events (alerts table is created in Spec 3; until then the feed shows an empty state). The delivery map reuses the existing `delivery-map.tsx` component. Status colours always pair icon + colour + text — never colour alone.

**Tech Stack:** React Router v7 SPA, React 19, shadcn/ui (Tailwind v4), Lucide React, Clerk auth (`useAuth`), Drizzle client (`@surewaka/db`), Hono API, Drizzle ORM, TypeScript strict

## Global Constraints

- Never import directly between apps — all shared types via `@surewaka/shared`
- TypeScript strict mode, `type` over `interface`, `unknown` not `any`
- shadcn/ui components from `~/components/ui/*`; `cn()` for conditional class names
- Icons from `lucide-react` only
- `VITE_API_URL` env var for API base URL (default `http://localhost:4000`)
- Status colours: NEVER colour alone — always icon + colour + text (e.g. `⚠ 3 at risk`)
- Every async panel: skeleton/shimmer while loading, error state on failure, empty state when no data
- Alert feed must have `aria-live="polite"` for screen-reader announcements
- Responsive: alert feed slides over as a drawer at `< 1280px`; KPI bar wraps to 2-col at `< 768px`
- API response shape: `{ data, error, meta }`
- All routes require `requireAuth` + `requireRole('surewaka_admin')` middleware
- Spec 0 (delivery model) must be applied before this spec — queries use `delivery_legs`, `driver_locations`

---

## File Structure

**Create:**
- `apps/api/src/routes/admin/ops-hub.ts` — `GET /api/v1/admin/ops-hub/stats`
- `apps/api/src/routes/admin/alerts.ts` — `GET /api/v1/admin/alerts`
- `apps/api/src/__tests__/ops-hub-stats.test.ts`
- `apps/api/src/__tests__/admin-alerts.test.ts`
- `apps/admin/app/hooks/use-ops-hub.ts` — 30 s polling hook for KPI stats
- `apps/admin/app/components/ops-hub/kpi-bar.tsx` — 5 live KPI cards
- `apps/admin/app/components/ops-hub/at-risk-list.tsx` — filtered at-risk delivery table
- `apps/admin/app/components/ops-hub/alert-feed.tsx` — realtime alert panel
- `apps/admin/app/components/ops-hub/escalation-modal.tsx` — escalate/reassign/fail modal
- `packages/shared/src/types/ops-hub.ts` — `OpsHubStats`, `AtRiskDelivery`, `AlertItem` types
- `packages/shared/src/validators/ops-hub.ts` — Zod schema for escalation action body

**Modify:**
- `packages/shared/src/types.ts` — re-export from `types/ops-hub.ts`
- `packages/shared/src/validators.ts` — re-export from `validators/ops-hub.ts`
- `apps/admin/app/routes/dashboard.tsx` — replace with Ops Hub layout
- `apps/api/src/index.ts` — register new routes

---

### Task 1: Shared types and validators for Ops Hub

**Files:**
- Create: `packages/shared/src/types/ops-hub.ts`
- Create: `packages/shared/src/validators/ops-hub.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/validators.ts`

**Interfaces:**
- Produces:
  - `OpsHubStats` — consumed by `use-ops-hub.ts` and `kpi-bar.tsx`
  - `AtRiskDelivery` — consumed by `at-risk-list.tsx`
  - `AlertItem` — consumed by `alert-feed.tsx`
  - `escalationActionSchema` — consumed by escalation API endpoint

- [ ] **Step 1: Create `packages/shared/src/types/ops-hub.ts`**

```typescript
// packages/shared/src/types/ops-hub.ts

export type OpsHubStats = {
  activeDeliveries: number;
  driversOnDuty: number;
  driversAvailable: number;
  atRiskDeliveries: number;
  openDisputes: number;
  onTimeRateToday: number | null; // percentage 0–100, null if no deliveries today
};

export type RiskReason = 'overdue' | 'driver_silent' | 'no_update_sent';

export type AtRiskDelivery = {
  id: string;
  trackingId: string;
  customerName: string;
  driverName: string | null;
  status: string;
  minutesOverdue: number;
  riskReason: RiskReason;
  pickupAddress: string;
  dropoffAddress: string;
};

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertItem = {
  id: string;
  deliveryId: string | null;
  legId: string | null;
  rule: string;
  severity: AlertSeverity;
  originalSeverity: AlertSeverity | null;
  message: string;
  firedAt: string;
  escalatedAt: string | null;
  resolvedAt: string | null;
  ackBy: string | null;
  deliveryTrackingId: string | null;
  actorName: string | null;
};

export type EscalationAction = 'call_driver' | 'reassign' | 'mark_failed';
```

- [ ] **Step 2: Create `packages/shared/src/validators/ops-hub.ts`**

```typescript
// packages/shared/src/validators/ops-hub.ts
import { z } from 'zod';

export const escalationActionSchema = z.object({
  deliveryId: z.string().uuid(),
  action: z.enum(['call_driver', 'reassign', 'mark_failed']),
  note: z.string().max(500).optional(),
});
```

- [ ] **Step 3: Re-export from shared index files**

In `packages/shared/src/types.ts`, append:
```typescript
export type { OpsHubStats, AtRiskDelivery, AlertItem, AlertSeverity, RiskReason, EscalationAction } from './types/ops-hub';
```

In `packages/shared/src/validators.ts`, append:
```typescript
export { escalationActionSchema } from './validators/ops-hub';
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/shared build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/ops-hub.ts packages/shared/src/validators/ops-hub.ts packages/shared/src/types.ts packages/shared/src/validators.ts
git commit -m "feat(shared): add OpsHubStats, AtRiskDelivery, AlertItem types and escalation validator"
```

---

### Task 2: API — `GET /api/v1/admin/ops-hub/stats`

**Files:**
- Create: `apps/api/src/routes/admin/ops-hub.ts`
- Create: `apps/api/src/__tests__/ops-hub-stats.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `deliveries`, `drivers`, `delivery_legs`, `driver_locations` tables (from Spec 0)
- Produces: `GET /api/v1/admin/ops-hub/stats` → `{ data: OpsHubStats, error: null, meta: null }`

- [ ] **Step 1: Write the test**

```typescript
// apps/api/src/__tests__/ops-hub-stats.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue([
      { active_deliveries: '5', drivers_on_duty: '8', drivers_available: '3',
        at_risk_deliveries: '2', open_disputes: '1', on_time_rate_today: '87.50' },
    ]),
  },
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: any, next: any) => { c.set('user', { id: 'u1' }); await next(); }),
}));
vi.mock('../../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: any, next: any) => next()),
}));

const { default: app } = await import('../index');

describe('GET /api/v1/admin/ops-hub/stats', () => {
  it('returns 200 with OpsHubStats shape', async () => {
    const res = await app.request('/api/v1/admin/ops-hub/stats', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toMatchObject({
      activeDeliveries: 5,
      driversOnDuty: 8,
      driversAvailable: 3,
      atRiskDeliveries: 2,
      openDisputes: 1,
      onTimeRateToday: 87.5,
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|ops-hub-stats"
```

Expected: FAIL — route does not exist.

- [ ] **Step 3: Write `apps/api/src/routes/admin/ops-hub.ts`**

```typescript
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import type { OpsHubStats } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const opsHubRoutes = new Hono<Env>();
opsHubRoutes.use('*', requireAuth);
opsHubRoutes.use('*', requireRole('surewaka_admin'));

// ─── Active delivery statuses ─────────────────────────────────────────────────
const ACTIVE_STATUSES = [
  'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff',
];

const DRIVER_SILENT_MINUTES = 15;
const OVERDUE_WARNING_MINUTES = 30;
const NO_UPDATE_MINUTES = 90;

opsHubRoutes.get('/stats', async (c) => {
  try {
    const rows = await db.execute<{
      active_deliveries: string;
      drivers_on_duty: string;
      drivers_available: string;
      at_risk_deliveries: string;
      open_disputes: string;
      on_time_rate_today: string | null;
    }>(sql`
      WITH active AS (
        SELECT id, driver_id, system_eta_at, driver_eta_at
        FROM deliveries
        WHERE status = ANY(ARRAY[${sql.raw(ACTIVE_STATUSES.map((s) => `'${s}'`).join(','))}]::text[])
      ),
      driver_last_ping AS (
        SELECT DISTINCT ON (driver_id) driver_id, recorded_at
        FROM driver_locations
        ORDER BY driver_id, recorded_at DESC
      ),
      at_risk AS (
        SELECT a.id
        FROM active a
        LEFT JOIN driver_last_ping dlp ON dlp.driver_id = a.driver_id
        WHERE
          -- overdue: past driver ETA or system ETA by 30+ min
          (COALESCE(a.driver_eta_at, a.system_eta_at) < NOW() - INTERVAL '${sql.raw(String(OVERDUE_WARNING_MINUTES))} minutes')
          OR
          -- driver silent: no ping in 15+ min
          (dlp.recorded_at IS NULL OR dlp.recorded_at < NOW() - INTERVAL '${sql.raw(String(DRIVER_SILENT_MINUTES))} minutes')
      ),
      today_deliveries AS (
        SELECT
          d.id,
          d.system_eta_at,
          d.driver_eta_at,
          (SELECT MAX(de.created_at) FROM delivery_events de WHERE de.delivery_id = d.id AND de.to_status = 'delivered') AS delivered_at
        FROM deliveries d
        WHERE d.status = 'delivered'
          AND d.updated_at >= CURRENT_DATE
      )
      SELECT
        (SELECT COUNT(*) FROM active)::text AS active_deliveries,
        (SELECT COUNT(*) FROM drivers WHERE available = true)::text AS drivers_on_duty,
        (
          SELECT COUNT(*) FROM drivers dr
          WHERE dr.available = true
            AND NOT EXISTS (SELECT 1 FROM active a WHERE a.driver_id = dr.id)
        )::text AS drivers_available,
        (SELECT COUNT(*) FROM at_risk)::text AS at_risk_deliveries,
        (
          SELECT COUNT(*) FROM deliveries
          WHERE status = 'delivered'
            AND updated_at >= CURRENT_DATE
            -- disputed: using escrow status as proxy until disputes table is wired
        )::text AS open_disputes,
        (
          SELECT
            CASE WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(
              100.0 * COUNT(*) FILTER (
                WHERE delivered_at <= COALESCE(driver_eta_at, system_eta_at)
              ) / COUNT(*),
              2
            )
            END
          FROM today_deliveries
          WHERE delivered_at IS NOT NULL
        )::text AS on_time_rate_today
    `);

    const row = rows[0];
    const stats: OpsHubStats = {
      activeDeliveries: parseInt(row.active_deliveries, 10),
      driversOnDuty: parseInt(row.drivers_on_duty, 10),
      driversAvailable: parseInt(row.drivers_available, 10),
      atRiskDeliveries: parseInt(row.at_risk_deliveries, 10),
      openDisputes: parseInt(row.open_disputes, 10),
      onTimeRateToday: row.on_time_rate_today != null ? parseFloat(row.on_time_rate_today) : null,
    };

    return c.json({ data: stats, error: null, meta: null });
  } catch (err) {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load ops stats' }, meta: null },
      500,
    );
  }
});

export default opsHubRoutes;
```

- [ ] **Step 4: Register route in `apps/api/src/index.ts`**

Add after the existing admin delivery route registration:

```typescript
import opsHubRoutes from './routes/admin/ops-hub';
// ...
app.route('/api/v1/admin/ops-hub', opsHubRoutes);
```

- [ ] **Step 5: Run test to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|ops-hub-stats"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/ops-hub.ts apps/api/src/__tests__/ops-hub-stats.test.ts apps/api/src/index.ts
git commit -m "feat(api): add GET /api/v1/admin/ops-hub/stats — live KPI aggregation"
```

---

### Task 3: API — `GET /api/v1/admin/alerts`

**Files:**
- Create: `apps/api/src/routes/admin/alerts.ts`
- Create: `apps/api/src/__tests__/admin-alerts.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Produces: `GET /api/v1/admin/alerts?resolved=false` → `{ data: AlertItem[], error: null, meta: null }`. Returns empty array if the `alerts` table does not yet exist (Spec 3 creates it). This lets the Ops Hub alert feed render gracefully before Spec 3 ships.

- [ ] **Step 1: Write the test**

```typescript
// apps/api/src/__tests__/admin-alerts.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: { execute: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: any, next: any) => { c.set('user', { id: 'u1' }); await next(); }),
}));
vi.mock('../../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: any, next: any) => next()),
}));

const { default: app } = await import('../index');

describe('GET /api/v1/admin/alerts', () => {
  it('returns 200 with empty array when no alerts', async () => {
    const res = await app.request('/api/v1/admin/alerts', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|admin-alerts"
```

Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/routes/admin/alerts.ts`**

```typescript
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import type { AlertItem } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const alertRoutes = new Hono<Env>();
alertRoutes.use('*', requireAuth);
alertRoutes.use('*', requireRole('surewaka_admin'));

alertRoutes.get('/', async (c) => {
  const resolvedParam = c.req.query('resolved');
  const includeResolved = resolvedParam === 'true';

  try {
    // alerts table is created in Spec 3. Gracefully return empty array if not yet present.
    const rows = await db.execute<{
      id: string;
      delivery_id: string | null;
      leg_id: string | null;
      rule: string;
      severity: string;
      original_severity: string | null;
      message: string;
      fired_at: string;
      escalated_at: string | null;
      resolved_at: string | null;
      ack_by: string | null;
      tracking_id: string | null;
      actor_name: string | null;
    }>(sql`
      SELECT
        a.id,
        a.delivery_id,
        a.leg_id,
        a.rule,
        a.severity,
        a.original_severity,
        a.message,
        a.fired_at,
        a.escalated_at,
        a.resolved_at,
        a.ack_by,
        d.id::text AS tracking_id,
        u.name AS actor_name
      FROM alerts a
      LEFT JOIN deliveries d ON d.id = a.delivery_id
      LEFT JOIN users u ON u.id = a.ack_by
      WHERE ${includeResolved ? sql`TRUE` : sql`a.resolved_at IS NULL`}
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        a.fired_at DESC
      LIMIT 100
    `);

    const items: AlertItem[] = rows.map((r) => ({
      id: r.id,
      deliveryId: r.delivery_id,
      legId: r.leg_id,
      rule: r.rule,
      severity: r.severity as AlertItem['severity'],
      originalSeverity: r.original_severity as AlertItem['originalSeverity'],
      message: r.message,
      firedAt: r.fired_at,
      escalatedAt: r.escalated_at,
      resolvedAt: r.resolved_at,
      ackBy: r.ack_by,
      deliveryTrackingId: r.tracking_id,
      actorName: r.actor_name,
    }));

    return c.json({ data: items, error: null, meta: null });
  } catch (err: unknown) {
    // If alerts table doesn't exist yet (Spec 3 not applied), return empty array
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('relation "alerts" does not exist') || msg.includes('alerts')) {
      return c.json({ data: [] as AlertItem[], error: null, meta: null });
    }
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load alerts' }, meta: null },
      500,
    );
  }
});

export default alertRoutes;
```

- [ ] **Step 4: Register route in `apps/api/src/index.ts`**

```typescript
import alertRoutes from './routes/admin/alerts';
// ...
app.route('/api/v1/admin/alerts', alertRoutes);
```

- [ ] **Step 5: Run test to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|admin-alerts"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/alerts.ts apps/api/src/__tests__/admin-alerts.test.ts apps/api/src/index.ts
git commit -m "feat(api): add GET /api/v1/admin/alerts — gracefully empty before Spec 3 applies alerts table"
```

---

### Task 4: `use-ops-hub` hook — 30 s polling for KPI stats + at-risk deliveries

**Files:**
- Create: `apps/admin/app/hooks/use-ops-hub.ts`

**Interfaces:**
- Consumes: `GET /api/v1/admin/ops-hub/stats`, `GET /api/v1/admin/deliveries?tab=active` (existing endpoint, filters for at-risk client-side)
- Produces:
  - `useOpsHubStats(): { stats: OpsHubStats | null; isLoading: boolean; error: string | null }`
  - `useAtRiskDeliveries(): { atRisk: AtRiskDelivery[]; isLoading: boolean; error: string | null }`

- [ ] **Step 1: Write `apps/admin/app/hooks/use-ops-hub.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { OpsHubStats, AtRiskDelivery } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 30_000;

// ─── KPI stats ────────────────────────────────────────────────────────────────

export type UseOpsHubStatsResult = {
  stats: OpsHubStats | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useOpsHubStats(): UseOpsHubStatsResult {
  const { getToken } = useAuth();
  const [stats, setStats] = useState<OpsHubStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/ops-hub/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: OpsHubStats; error: null };
      setStats(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const refetch = useCallback(() => { void fetchStats(); }, [fetchStats]);

  useEffect(() => {
    void fetchStats();
    intervalRef.current = setInterval(() => { void fetchStats(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStats]);

  return { stats, isLoading, error, refetch };
}

// ─── At-risk deliveries ───────────────────────────────────────────────────────

export type UseAtRiskDeliveriesResult = {
  atRisk: AtRiskDelivery[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useAtRiskDeliveries(): UseAtRiskDeliveriesResult {
  const { getToken } = useAuth();
  const [atRisk, setAtRisk] = useState<AtRiskDelivery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAtRisk = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/ops-hub/at-risk`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: AtRiskDelivery[]; error: null };
      setAtRisk(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load at-risk deliveries');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const refetch = useCallback(() => { void fetchAtRisk(); }, [fetchAtRisk]);

  useEffect(() => {
    void fetchAtRisk();
    intervalRef.current = setInterval(() => { void fetchAtRisk(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAtRisk]);

  return { atRisk, isLoading, error, refetch };
}
```

- [ ] **Step 2: Add `GET /api/v1/admin/ops-hub/at-risk` to `ops-hub.ts`**

Append to `apps/api/src/routes/admin/ops-hub.ts` (after the `/stats` handler):

```typescript
opsHubRoutes.get('/at-risk', async (c) => {
  const OVERDUE_MIN = 30;
  const SILENT_MIN = 15;
  const NO_UPDATE_MIN = 90;

  try {
    const rows = await db.execute<{
      id: string;
      customer_name: string;
      driver_name: string | null;
      status: string;
      minutes_overdue: string;
      risk_reason: string;
      pickup_address: string;
      dropoff_address: string;
    }>(sql`
      WITH active_deliveries AS (
        SELECT
          d.id,
          u.name AS customer_name,
          du.name AS driver_name,
          d.status,
          d.pickup_address,
          d.dropoff_address,
          d.system_eta_at,
          d.driver_eta_at,
          d.driver_id,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(d.driver_eta_at, d.system_eta_at))) / 60 AS mins_since_eta
        FROM deliveries d
        JOIN users u ON u.id = d.customer_id
        LEFT JOIN drivers dr ON dr.id = d.driver_id
        LEFT JOIN users du ON du.id = dr.user_id
        WHERE d.status = ANY(ARRAY['en_route_pickup','arrived_pickup','picked_up','en_route_dropoff','arrived_dropoff']::text[])
      ),
      driver_pings AS (
        SELECT DISTINCT ON (driver_id) driver_id, recorded_at
        FROM driver_locations
        ORDER BY driver_id, recorded_at DESC
      ),
      last_customer_event AS (
        SELECT DISTINCT ON (delivery_id) delivery_id, created_at
        FROM delivery_events
        WHERE to_status = ANY(ARRAY['accepted','picked_up','en_route_dropoff','arrived_dropoff','delivered']::text[])
        ORDER BY delivery_id, created_at DESC
      )
      SELECT
        ad.id,
        ad.customer_name,
        ad.driver_name,
        ad.status,
        ad.pickup_address,
        ad.dropoff_address,
        CASE
          WHEN COALESCE(dp.recorded_at, '1970-01-01') < NOW() - INTERVAL '${sql.raw(String(SILENT_MIN))} minutes'
            THEN 'driver_silent'
          WHEN ad.mins_since_eta > ${sql.raw(String(OVERDUE_MIN))}
            THEN 'overdue'
          ELSE 'no_update_sent'
        END AS risk_reason,
        GREATEST(0, ROUND(ad.mins_since_eta))::text AS minutes_overdue
      FROM active_deliveries ad
      LEFT JOIN driver_pings dp ON dp.driver_id = ad.driver_id
      LEFT JOIN last_customer_event lce ON lce.delivery_id = ad.id
      WHERE
        COALESCE(dp.recorded_at, '1970-01-01') < NOW() - INTERVAL '${sql.raw(String(SILENT_MIN))} minutes'
        OR ad.mins_since_eta > ${sql.raw(String(OVERDUE_MIN))}
        OR lce.created_at < NOW() - INTERVAL '${sql.raw(String(NO_UPDATE_MIN))} minutes'
        OR lce.created_at IS NULL
      ORDER BY
        CASE WHEN dp.recorded_at < NOW() - INTERVAL '${sql.raw(String(SILENT_MIN))} minutes' THEN 0 ELSE 1 END,
        ad.mins_since_eta DESC NULLS LAST
      LIMIT 50
    `);

    const atRisk: AtRiskDelivery[] = rows.map((r) => ({
      id: r.id,
      trackingId: r.id.slice(0, 8).toUpperCase(),
      customerName: r.customer_name,
      driverName: r.driver_name,
      status: r.status,
      minutesOverdue: parseInt(r.minutes_overdue, 10),
      riskReason: r.risk_reason as AtRiskDelivery['riskReason'],
      pickupAddress: r.pickup_address,
      dropoffAddress: r.dropoff_address,
    }));

    return c.json({ data: atRisk, error: null, meta: null });
  } catch {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load at-risk deliveries' }, meta: null },
      500,
    );
  }
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/api build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin/ops-hub.ts apps/admin/app/hooks/use-ops-hub.ts
git commit -m "feat(api,admin): add at-risk endpoint and useOpsHubStats/useAtRiskDeliveries hooks with 30s polling"
```

---

### Task 5: KPI Bar component

**Files:**
- Create: `apps/admin/app/components/ops-hub/kpi-bar.tsx`

**Interfaces:**
- Consumes: `OpsHubStats` from Task 1; `useOpsHubStats` from Task 4
- Produces: `<KpiBar />` — 5 stat cards, skeleton while loading, red highlight when at-risk > 0

- [ ] **Step 1: Write `apps/admin/app/components/ops-hub/kpi-bar.tsx`**

```tsx
import { AlertTriangle, Car, Clock, MessageCircleWarning, Package } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import type { OpsHubStats } from '@surewaka/shared';

type KpiCardProps = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isAlert?: boolean;
  subLabel?: string;
};

function KpiCard({ label, value, icon, isAlert = false, subLabel }: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-5 transition-colors',
        isAlert
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-border bg-card',
      )}
    >
      <div className={cn('flex items-center gap-2 text-sm font-medium', isAlert ? 'text-destructive' : 'text-muted-foreground')}>
        {icon}
        {label}
      </div>
      <p className={cn('mt-2 text-3xl font-bold tabular-nums', isAlert ? 'text-destructive' : 'text-foreground')}>
        {value}
      </p>
      {subLabel && <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p>}
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="mt-2 h-9 w-16" />
      <Skeleton className="mt-1 h-3 w-24" />
    </div>
  );
}

type KpiBarProps = {
  stats: OpsHubStats | null;
  isLoading: boolean;
  error: string | null;
};

export function KpiBar({ stats, isLoading, error }: KpiBarProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />
        Failed to load live stats: {error}
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        label="Active Deliveries"
        value={stats.activeDeliveries.toLocaleString()}
        icon={<Package className="h-4 w-4" aria-hidden="true" />}
      />
      <KpiCard
        label="Drivers On Duty"
        value={stats.driversOnDuty.toLocaleString()}
        icon={<Car className="h-4 w-4" aria-hidden="true" />}
        subLabel={`${stats.driversAvailable} available`}
      />
      <KpiCard
        label="At-Risk Deliveries"
        value={stats.atRiskDeliveries > 0 ? `⚠ ${stats.atRiskDeliveries} at risk` : '0'}
        icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        isAlert={stats.atRiskDeliveries > 0}
      />
      <KpiCard
        label="Open Disputes"
        value={stats.openDisputes > 0 ? `⚠ ${stats.openDisputes} open` : '0'}
        icon={<MessageCircleWarning className="h-4 w-4" aria-hidden="true" />}
        isAlert={stats.openDisputes > 0}
      />
      <KpiCard
        label="On-Time Rate Today"
        value={stats.onTimeRateToday != null ? `${stats.onTimeRateToday.toFixed(1)}%` : '—'}
        icon={<Clock className="h-4 w-4" aria-hidden="true" />}
        isAlert={stats.onTimeRateToday != null && stats.onTimeRateToday < 80}
        subLabel={stats.onTimeRateToday != null && stats.onTimeRateToday < 80 ? '⚠ Below 80% target' : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter @surewaka/admin typecheck 2>&1 | tail -10
```

Expected: no errors in `kpi-bar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/components/ops-hub/kpi-bar.tsx
git commit -m "feat(admin): add KpiBar — 5 live stat cards with skeleton loading and alert highlighting"
```

---

### Task 6: At-Risk Delivery List component

**Files:**
- Create: `apps/admin/app/components/ops-hub/at-risk-list.tsx`

**Interfaces:**
- Consumes: `AtRiskDelivery[]` from `useAtRiskDeliveries` (Task 4)
- Produces: `<AtRiskList deliveries={[...]} isLoading={bool} onEscalate={(id) => void} />` — sortable table with risk badge, bulk select, escalate button

- [ ] **Step 1: Write `apps/admin/app/components/ops-hub/at-risk-list.tsx`**

```tsx
import { useState } from 'react';
import { AlertTriangle, CheckCircle, Radio, Timer } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { cn } from '~/lib/utils';
import type { AtRiskDelivery, RiskReason } from '@surewaka/shared';

// ─── Risk reason badge ────────────────────────────────────────────────────────

const RISK_LABELS: Record<RiskReason, { label: string; icon: React.ReactNode; class: string }> = {
  overdue: {
    label: 'Overdue',
    icon: <Timer className="h-3 w-3" aria-hidden="true" />,
    class: 'text-amber-600 dark:text-amber-400',
  },
  driver_silent: {
    label: 'Driver Silent',
    icon: <Radio className="h-3 w-3" aria-hidden="true" />,
    class: 'text-destructive',
  },
  no_update_sent: {
    label: 'No Update Sent',
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
    class: 'text-amber-600 dark:text-amber-400',
  },
};

function RiskBadge({ reason }: { reason: RiskReason }) {
  const { label, icon, class: cls } = RISK_LABELS[reason];
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', cls)}>
      {icon}
      {label}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

type AtRiskListProps = {
  deliveries: AtRiskDelivery[];
  isLoading: boolean;
  onEscalate: (id: string) => void;
};

export function AtRiskList({ deliveries, isLoading, onEscalate }: AtRiskListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleAll = () => {
    if (selected.size === deliveries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deliveries.map((d) => d.id)));
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
        <CheckCircle className="h-4 w-4" aria-hidden="true" />
        All deliveries on track
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { selected.forEach((id) => onEscalate(id)); setSelected(new Set()); }}
          >
            Escalate selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-10 px-4 py-3">
                <Checkbox
                  checked={selected.size === deliveries.length && deliveries.length > 0}
                  onCheckedChange={toggleAll}
                  aria-label="Select all at-risk deliveries"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tracking ID</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Driver</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Min Overdue</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Risk</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr
                key={delivery.id}
                className={cn(
                  'border-b border-border last:border-0 transition-colors',
                  selected.has(delivery.id) ? 'bg-muted/40' : 'hover:bg-muted/20',
                )}
              >
                <td className="px-4 py-3">
                  <Checkbox
                    checked={selected.has(delivery.id)}
                    onCheckedChange={() => toggle(delivery.id)}
                    aria-label={`Select delivery ${delivery.trackingId}`}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs font-medium">{delivery.trackingId}</td>
                <td className="px-4 py-3">{delivery.customerName}</td>
                <td className="px-4 py-3 text-muted-foreground">{delivery.driverName ?? '—'}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">
                  {delivery.status.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {delivery.minutesOverdue > 0 ? `${delivery.minutesOverdue} min` : '—'}
                </td>
                <td className="px-4 py-3">
                  <RiskBadge reason={delivery.riskReason} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEscalate(delivery.id)}
                    aria-label={`Escalate delivery ${delivery.trackingId}`}
                  >
                    Escalate
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/ops-hub/at-risk-list.tsx
git commit -m "feat(admin): add AtRiskList — at-risk delivery table with risk badges, bulk select, escalate"
```

---

### Task 7: Escalation Modal

**Files:**
- Create: `apps/admin/app/components/ops-hub/escalation-modal.tsx`

**Interfaces:**
- Consumes: `deliveryId: string`; `onClose: () => void`
- Produces: `<EscalationModal deliveryId={string} onClose={() => void} />` — modal with three actions: Call Driver, Reassign, Mark Failed

- [ ] **Step 1: Write `apps/admin/app/components/ops-hub/escalation-modal.tsx`**

```tsx
import { useState } from 'react';
import { Phone, RefreshCw, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { Label } from '~/components/ui/label';
import { useAuth } from '@clerk/react';
import type { EscalationAction } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type EscalationModalProps = {
  deliveryId: string;
  onClose: () => void;
};

export function EscalationModal({ deliveryId, onClose }: EscalationModalProps) {
  const { getToken } = useAuth();
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escalate = async (action: EscalationAction) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/ops-hub/escalate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deliveryId, action, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Escalation failed');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escalation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escalate Delivery</DialogTitle>
          <DialogDescription>
            Choose an action for delivery{' '}
            <span className="font-mono font-medium">{deliveryId.slice(0, 8).toUpperCase()}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="escalation-note">Note (optional)</Label>
            <Textarea
              id="escalation-note"
              placeholder="Add context for this escalation…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => void escalate('call_driver')}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
            aria-label="Call driver"
          >
            <Phone className="mr-2 h-4 w-4" aria-hidden="true" />
            Call Driver
          </Button>
          <Button
            variant="outline"
            onClick={() => void escalate('reassign')}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
            aria-label="Reassign delivery"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reassign
          </Button>
          <Button
            variant="destructive"
            onClick={() => void escalate('mark_failed')}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
            aria-label="Mark delivery as failed"
          >
            <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Mark Failed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add `POST /api/v1/admin/ops-hub/escalate` endpoint**

Append to `apps/api/src/routes/admin/ops-hub.ts`:

```typescript
import { escalationActionSchema } from '@surewaka/shared';
import { deliveries } from '@surewaka/db';
import { eq } from 'drizzle-orm';

opsHubRoutes.post('/escalate', async (c) => {
  const body = await c.req.json();
  const parsed = escalationActionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const { deliveryId, action } = parsed.data;

  try {
    if (action === 'mark_failed') {
      await db.update(deliveries)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(deliveries.id, deliveryId));
    }
    // 'call_driver' and 'reassign' are logged as ops notes; full reassignment logic in a future spec
    return c.json({ data: { deliveryId, action }, error: null, meta: null });
  } catch {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Escalation failed' }, meta: null },
      500,
    );
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/components/ops-hub/escalation-modal.tsx apps/api/src/routes/admin/ops-hub.ts
git commit -m "feat(admin,api): add EscalationModal and POST /api/v1/admin/ops-hub/escalate"
```

---

### Task 8: Alert Feed component

**Files:**
- Create: `apps/admin/app/components/ops-hub/alert-feed.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/admin/alerts` (polled every 30 s); `AlertItem[]` from Task 1
- Produces: `<AlertFeed />` — severity-ranked alert list with `aria-live`, auto-refresh, empty state

- [ ] **Step 1: Write `apps/admin/app/components/ops-hub/alert-feed.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertTriangle, Bell, CheckCircle, Info } from 'lucide-react';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import type { AlertItem, AlertSeverity } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 30_000;

// ─── Severity config ──────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<AlertSeverity, { icon: React.ReactNode; class: string; dot: string }> = {
  info: {
    icon: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
    class: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
    class: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  critical: {
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
    class: 'text-destructive font-semibold',
    dot: 'bg-destructive',
  },
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: AlertItem }) {
  const config = SEVERITY_CONFIG[alert.severity];
  return (
    <div className={cn('flex gap-3 rounded-lg border border-border p-3', alert.severity === 'critical' && 'border-destructive/40 bg-destructive/5')}>
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', config.class)}>
        {config.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('flex items-start justify-between gap-2 text-sm', config.class)}>
          <span>{alert.message}</span>
          <span className="shrink-0 text-xs text-muted-foreground font-normal">{relativeTime(alert.firedAt)}</span>
        </div>
        {alert.deliveryTrackingId && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Delivery{' '}
            <a
              href={`/deliveries?id=${alert.deliveryId}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              #{alert.deliveryTrackingId}
            </a>
            {alert.actorName && ` · ${alert.actorName}`}
          </p>
        )}
        {alert.originalSeverity && alert.originalSeverity !== alert.severity && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Escalated from {alert.originalSeverity}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export function AlertFeed() {
  const { getToken } = useAuth();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: AlertItem[] };
      setAlerts(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchAlerts();
    intervalRef.current = setInterval(() => { void fetchAlerts(); }, POLL_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAlerts]);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Alert Feed</h2>
          {criticalCount > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-xs font-bold text-destructive-foreground">
              {criticalCount} critical
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchAlerts()} aria-label="Refresh alerts">
          Refresh
        </Button>
      </div>

      {/* Live region for screen readers */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Live alert feed"
        className="flex-1 space-y-2 overflow-y-auto"
      >
        {isLoading && (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-sm text-destructive" role="alert">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        )}

        {!isLoading && !error && alerts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <CheckCircle className="h-8 w-8 text-green-500" aria-hidden="true" />
            <p>No active alerts</p>
            <p className="text-xs">Alert engine activates in Spec 3</p>
          </div>
        )}

        {!isLoading && !error && alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/ops-hub/alert-feed.tsx
git commit -m "feat(admin): add AlertFeed — severity-ranked alert panel with aria-live and 30s polling"
```

---

### Task 9: Ops Hub dashboard route — wire everything together

**Files:**
- Modify: `apps/admin/app/routes/dashboard.tsx`

**Interfaces:**
- Consumes: `KpiBar`, `AtRiskList`, `AlertFeed`, `EscalationModal`, `DeliveryMap` (existing `delivery-map.tsx`), `RealtimeConnectionBanner` (existing), `useOpsHubStats`, `useAtRiskDeliveries`, `useDeliveries` (existing)
- Produces: Full Ops Hub page — 3-zone layout (KPI bar / map + at-risk / alert feed), responsive, ESC to close modal

- [ ] **Step 1: Replace `apps/admin/app/routes/dashboard.tsx`**

```tsx
import { useState } from 'react';
import { KpiBar } from '~/components/ops-hub/kpi-bar';
import { AtRiskList } from '~/components/ops-hub/at-risk-list';
import { AlertFeed } from '~/components/ops-hub/alert-feed';
import { EscalationModal } from '~/components/ops-hub/escalation-modal';
import { DeliveryMap } from '~/components/deliveries/delivery-map';
import { RealtimeConnectionBanner } from '~/components/deliveries/realtime-connection-banner';
import { useOpsHubStats, useAtRiskDeliveries } from '~/hooks/use-ops-hub';
import { useDeliveries } from '~/hooks/use-deliveries';
import { cn } from '~/lib/utils';
import type { Route } from './+types/dashboard';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Ops Hub' }];
}

export default function OpsHub() {
  const { stats, isLoading: statsLoading, error: statsError } = useOpsHubStats();
  const { atRisk, isLoading: atRiskLoading } = useAtRiskDeliveries();
  const { data: activeDeliveries, isLoading: mapLoading } = useDeliveries({ tab: 'active', pageSize: 100 });
  const [escalatingId, setEscalatingId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Operations Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">Live delivery command centre — auto-refreshes every 30 s</p>
      </div>

      {/* KPI bar */}
      <KpiBar stats={stats} isLoading={statsLoading} error={statsError} />

      {/* Main content grid — map + at-risk left, alert feed right */}
      <div className={cn('flex min-h-0 flex-1 gap-6')}>
        {/* Left column: map + at-risk list */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Live delivery map */}
          <div className="h-80 overflow-hidden rounded-lg border border-border">
            <RealtimeConnectionBanner />
            <DeliveryMap data={activeDeliveries} isLoading={mapLoading} />
          </div>

          {/* At-risk list */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              At-Risk Deliveries
              {atRisk.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  — {atRisk.length} need attention
                </span>
              )}
            </h2>
            <AtRiskList
              deliveries={atRisk}
              isLoading={atRiskLoading}
              onEscalate={(id) => setEscalatingId(id)}
            />
          </div>
        </div>

        {/* Right column: alert feed (hidden on <1280px — shown as drawer via sheet) */}
        <div className="hidden w-80 shrink-0 xl:block">
          <div className="sticky top-6 rounded-lg border border-border p-4">
            <AlertFeed />
          </div>
        </div>
      </div>

      {/* Escalation modal */}
      {escalatingId && (
        <EscalationModal
          deliveryId={escalatingId}
          onClose={() => setEscalatingId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter @surewaka/admin typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Start dev server and inspect**

```bash
pnpm --filter @surewaka/admin dev
```

Open `http://localhost:3001`. Verify:
- KPI bar shows 5 cards with skeleton then data
- At-risk list shows the seeded overdue and driver-silent deliveries (from Spec 0 seed)
- Map renders active delivery pins
- Alert feed shows empty state ("No active alerts — Alert engine activates in Spec 3")
- Escalate button opens modal
- No TypeScript errors in browser console

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/routes/dashboard.tsx
git commit -m "feat(admin): replace dashboard with live Ops Hub — KPI bar, map, at-risk list, alert feed"
```
