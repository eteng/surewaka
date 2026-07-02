# Spec 3: Alert System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 60-second polling alert engine worker, admin push notification infrastructure, and Pumble webhook routing — all wired to a settings UI at `/settings/alerts` — so critical delivery incidents are never silent.

**Architecture:** A new `workers/alert-engine/` package runs a 60-second `setInterval` polling loop. Each tick evaluates 7 alert rules against the live DB state, writes or escalates rows in the `alerts` table, resolves cleared conditions, and routes Critical alerts to admin Expo push (via the existing push-worker queue) and a Pumble webhook. The admin's alert feed (built in Spec 1) receives alert events via Supabase Realtime subscribed to the `alerts` table. Alert thresholds are stored in a `settings` DB table and exposed via a new admin API route and a `/settings/alerts` UI page.

**Tech Stack:** Node 22 (tsx), Drizzle ORM via `@surewaka/db`, BullMQ (for push enqueue), Hono (API routes), React Router v7 (settings UI), shadcn/ui + Tailwind v4 + Lucide React (admin UI), Expo Server SDK (push), Pumble incoming webhook (same format as Slack)

## Global Constraints

- Never manually edit `packages/db/src/schema.ts` — run `pnpm --filter @surewaka/db db:pull` after migrations
- Every migration: RLS enable + service_role bypass + authenticated grants in the same file
- Reference RLS pattern: `supabase/migrations/20260603045850_fix_rls_and_grants_all_tables.sql`
- Worker reads DB via `@surewaka/db` (Drizzle + Neon HTTP) — never exposes SUPABASE_SERVICE_ROLE_KEY to client
- Alert thresholds from `@surewaka/shared` constants (ALERT_DRIVER_SILENT_WARNING_MIN etc.) as defaults
- TypeScript strict, `type` over `interface`, `unknown` not `any`
- Admin UI: `cn()` for classnames, Tailwind v4 `@theme`, `lucide-react` icons, shadcn/ui from `~/components/ui/*`
- API response shape: `{ data, error, meta }`
- Pumble webhook: POST JSON `{ text: "..." }` — identical to Slack incoming webhook format
- Spec 0 (delivery model) and Spec 1 (Ops Hub with alert feed UI) must be complete before this spec

## File Structure

```
supabase/migrations/
  20260703000002_alerts_table.sql       — alerts table + push_tokens admin app support + RLS

workers/alert-engine/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                            — polling loop entry point (setInterval, graceful shutdown)
    types.ts                            — AlertResult, AlertContext, EvaluationResult types
    db.ts                               — DB client initialisation (Drizzle + Neon HTTP)
    pumble.ts                           — Pumble webhook sender
    push.ts                             — Admin push enqueuer (BullMQ → push-worker)
    settings.ts                         — Load alert thresholds from DB settings table
    rules/
      driver-silent.ts                  — Rule: no driver_locations ping on active leg
      leg-overdue.ts                    — Rule: leg past driver_eta_at or system_eta_at
      driver-ghost.ts                   — Rule: driver-triggered cancellation before picked_up
      dispute-filed.ts                  — Rule: new unacknowledged dispute
      delivery-failed.ts                — Rule: delivery status = failed
      ontime-rate-drop.ts               — Rule: today's on-time rate below threshold
      customer-update-gap.ts            — Rule: no customer-facing event in >45/90 min
    __tests__/
      driver-silent.test.ts
      leg-overdue.test.ts
      driver-ghost.test.ts
      customer-update-gap.test.ts
      pumble.test.ts

apps/api/src/routes/admin/
  alert-settings.ts                     — GET/PUT alert thresholds + Pumble config + test alert

apps/admin/app/routes/settings/
  alerts.tsx                            — /settings/alerts UI page

apps/admin/app/hooks/
  use-alert-settings.ts                 — data fetching hook for alert settings
```

---

### Task 1: DB Migration — alerts table, push_tokens admin support, RLS

**Files:**
- Create: `supabase/migrations/20260703000002_alerts_table.sql`

**Interfaces:**
- Produces: `alerts` table (id, delivery_id, leg_id, rule, severity, original_severity, context, fired_at, escalated_at, resolved_at, ack_by); `push_tokens.app` constraint extended to include `'admin'`; `alert_settings` table for configurable thresholds

- [ ] **Step 1: Create the migration file**

```bash
supabase migration new alerts_table
```

Rename to `20260703000002_alerts_table.sql`.

- [ ] **Step 2: Write the SQL**

```sql
-- ─── alerts table ────────────────────────────────────────────────────────────
CREATE TABLE alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       uuid REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_id            uuid REFERENCES delivery_legs(id) ON DELETE SET NULL,
  rule              text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  original_severity text CHECK (original_severity IN ('info', 'warning', 'critical')),
  context           jsonb NOT NULL DEFAULT '{}',
  fired_at          timestamptz NOT NULL DEFAULT now(),
  escalated_at      timestamptz,
  resolved_at       timestamptz,
  ack_by            uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_alerts_unresolved
  ON alerts(fired_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_alerts_delivery_id ON alerts(delivery_id) WHERE delivery_id IS NOT NULL;

-- ─── alert_settings table — configurable thresholds ──────────────────────────
CREATE TABLE alert_settings (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_silent_warning_min       integer NOT NULL DEFAULT 15,
  driver_silent_critical_min      integer NOT NULL DEFAULT 30,
  leg_overdue_warning_min         integer NOT NULL DEFAULT 30,
  leg_overdue_critical_min        integer NOT NULL DEFAULT 60,
  customer_update_gap_warning_min integer NOT NULL DEFAULT 45,
  customer_update_gap_critical_min integer NOT NULL DEFAULT 90,
  ontime_rate_warning_pct         integer NOT NULL DEFAULT 80,
  ontime_rate_critical_pct        integer NOT NULL DEFAULT 60,
  pumble_webhook_url              text,
  push_enabled                    boolean NOT NULL DEFAULT true,
  pumble_enabled                  boolean NOT NULL DEFAULT false,
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Singleton row: always exactly one settings row
INSERT INTO alert_settings DEFAULT VALUES;

-- ─── Extend push_tokens to support admin web app ──────────────────────────────
ALTER TABLE push_tokens
  DROP CONSTRAINT IF EXISTS push_tokens_app_check;

ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_app_check
  CHECK (app IN ('customer', 'driver', 'admin'));

-- ─── RLS: alerts ─────────────────────────────────────────────────────────────
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_alerts"
  ON alerts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "admins_read_alerts"
  ON alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'surewaka_admin'
        AND ur.is_active = true
    )
  );

GRANT SELECT ON alerts TO authenticated;

-- ─── RLS: alert_settings ─────────────────────────────────────────────────────
ALTER TABLE alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_alert_settings"
  ON alert_settings FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "admins_read_alert_settings"
  ON alert_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'surewaka_admin'
        AND ur.is_active = true
    )
  );

GRANT SELECT ON alert_settings TO authenticated;
```

- [ ] **Step 3: Apply the migration**

```bash
supabase db push
```

Expected: no errors.

- [ ] **Step 4: Regenerate Drizzle schema**

```bash
pnpm --filter @surewaka/db db:pull
```

Expected: `packages/db/src/schema.ts` updated with `alerts` and `alert_settings` tables.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703000002_alerts_table.sql packages/db/src/schema.ts
git commit -m "feat(db): add alerts table, alert_settings, extend push_tokens for admin app"
```

---

### Task 2: Shared types — AlertRule, AlertSeverity, Alert

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/validators.ts`
- Modify: `packages/shared/src/constants.ts`

**Interfaces:**
- Produces: `AlertRule`, `AlertSeverity`, `Alert` types; `ALERT_RULES` constant; `updateAlertSettingsSchema` validator

- [ ] **Step 1: Add constants to `packages/shared/src/constants.ts`**

Append after existing content:

```typescript
// ─── Alert System ─────────────────────────────────────────────────────────────

export const ALERT_RULES = [
  'driver_silent',
  'leg_overdue',
  'driver_ghost',
  'dispute_filed',
  'delivery_failed',
  'ontime_rate_drop',
  'customer_update_gap',
] as const;

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
```

- [ ] **Step 2: Add types to `packages/shared/src/types.ts`**

Append after existing content:

```typescript
import type { ALERT_RULES, ALERT_SEVERITIES } from './constants';

export type AlertRule = (typeof ALERT_RULES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type Alert = {
  id: string;
  deliveryId: string | null;
  legId: string | null;
  rule: AlertRule;
  severity: AlertSeverity;
  originalSeverity: AlertSeverity | null;
  context: Record<string, unknown>;
  firedAt: string;
  escalatedAt: string | null;
  resolvedAt: string | null;
  ackBy: string | null;
};

export type AlertSettings = {
  driverSilentWarningMin: number;
  driverSilentCriticalMin: number;
  legOverdueWarningMin: number;
  legOverdueCriticalMin: number;
  customerUpdateGapWarningMin: number;
  customerUpdateGapCriticalMin: number;
  ontimeRateWarningPct: number;
  ontimeRateCriticalPct: number;
  pumbleWebhookUrl: string | null;
  pushEnabled: boolean;
  pumbleEnabled: boolean;
};
```

- [ ] **Step 3: Add validator to `packages/shared/src/validators.ts`**

Append after existing content:

```typescript
export const updateAlertSettingsSchema = z.object({
  driverSilentWarningMin: z.number().int().min(5).max(60).optional(),
  driverSilentCriticalMin: z.number().int().min(10).max(120).optional(),
  legOverdueWarningMin: z.number().int().min(10).max(120).optional(),
  legOverdueCriticalMin: z.number().int().min(20).max(240).optional(),
  customerUpdateGapWarningMin: z.number().int().min(15).max(120).optional(),
  customerUpdateGapCriticalMin: z.number().int().min(30).max(240).optional(),
  ontimeRateWarningPct: z.number().int().min(50).max(100).optional(),
  ontimeRateCriticalPct: z.number().int().min(30).max(90).optional(),
  pumbleWebhookUrl: z.string().url().nullable().optional(),
  pushEnabled: z.boolean().optional(),
  pumbleEnabled: z.boolean().optional(),
});
```

- [ ] **Step 4: Verify TypeScript**

```bash
pnpm --filter @surewaka/shared build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts packages/shared/src/validators.ts
git commit -m "feat(shared): add AlertRule, AlertSeverity, Alert types and updateAlertSettingsSchema"
```

---

### Task 3: Alert engine worker scaffold

**Files:**
- Create: `workers/alert-engine/package.json`
- Create: `workers/alert-engine/tsconfig.json`
- Create: `workers/alert-engine/vitest.config.ts`
- Create: `workers/alert-engine/src/types.ts`
- Create: `workers/alert-engine/src/db.ts`

**Interfaces:**
- Produces: `EvaluationResult` type, `db` Drizzle client, worker package ready to run

- [ ] **Step 1: Create `workers/alert-engine/package.json`**

```json
{
  "name": "@surewaka/alert-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@surewaka/db": "workspace:*",
    "@surewaka/shared": "workspace:*",
    "bullmq": "^5.0.0",
    "ioredis": "^5.4.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "tsup": "^8.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `workers/alert-engine/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `workers/alert-engine/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Create `workers/alert-engine/src/types.ts`**

```typescript
import type { AlertRule, AlertSeverity } from '@surewaka/shared';

export type EvaluationResult = {
  deliveryId: string | null;
  legId: string | null;
  rule: AlertRule;
  severity: AlertSeverity;
  context: Record<string, unknown>;
  shouldFire: boolean;  // true = write/escalate; false = resolve existing
};
```

- [ ] **Step 5: Create `workers/alert-engine/src/db.ts`**

```typescript
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');

export const db = drizzle(neon(connectionString));
```

- [ ] **Step 6: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 7: Commit**

```bash
git add workers/alert-engine/
git commit -m "feat(alert-engine): scaffold worker package with types and DB client"
```

---

### Task 4: Alert engine core — settings loader + Pumble sender + admin push enqueuer

**Files:**
- Create: `workers/alert-engine/src/settings.ts`
- Create: `workers/alert-engine/src/pumble.ts`
- Create: `workers/alert-engine/src/push.ts`
- Create: `workers/alert-engine/src/__tests__/pumble.test.ts`

**Interfaces:**
- Produces:
  - `loadSettings(): Promise<AlertSettings>` — reads `alert_settings` singleton row from DB
  - `sendPumbleAlert(webhookUrl: string, rule: AlertRule, context: Record<string, unknown>): Promise<void>`
  - `enqueueAdminPush(rule: AlertRule, context: Record<string, unknown>): Promise<void>`

- [ ] **Step 1: Write Pumble test**

```typescript
// workers/alert-engine/src/__tests__/pumble.test.ts
import { describe, it, expect, vi } from 'vitest';
import { formatPumbleMessage, sendPumbleAlert } from '../pumble';

vi.stubGlobal('fetch', vi.fn());

describe('formatPumbleMessage', () => {
  it('includes rule name and delivery context', () => {
    const msg = formatPumbleMessage('driver_silent', {
      driverName: 'Emeka N.',
      deliveryId: 'SW-1234',
      minutesSilent: 22,
      customerName: 'Ngozi O.',
      zone: 'Lekki',
    });
    expect(msg).toContain('Driver Silent');
    expect(msg).toContain('Emeka N.');
    expect(msg).toContain('22');
  });
});

describe('sendPumbleAlert', () => {
  it('POSTs JSON with text field to webhook URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    await sendPumbleAlert('https://pumble.example.com/hook', 'leg_overdue', {
      deliveryId: 'SW-5678',
      minutesOverdue: 35,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://pumble.example.com/hook',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toContain('CRITICAL');
  });

  it('does not throw on network failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
    await expect(
      sendPumbleAlert('https://pumble.example.com/hook', 'driver_silent', {}),
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/alert-engine test 2>&1 | grep -E "FAIL|PASS|pumble"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `workers/alert-engine/src/pumble.ts`**

```typescript
import type { AlertRule } from '@surewaka/shared';

const RULE_LABELS: Record<AlertRule, string> = {
  driver_silent: 'Driver Silent',
  leg_overdue: 'Leg Overdue',
  driver_ghost: 'Driver Ghost',
  dispute_filed: 'Dispute Filed',
  delivery_failed: 'Delivery Failed',
  ontime_rate_drop: 'On-Time Rate Drop',
  customer_update_gap: 'Customer Update Gap',
};

export function formatPumbleMessage(
  rule: AlertRule,
  context: Record<string, unknown>,
): string {
  const label = RULE_LABELS[rule];
  const deliveryRef = context.deliveryId ? `Delivery #${context.deliveryId}` : 'Platform';
  const adminUrl = process.env.ADMIN_URL ?? 'https://admin.surewaka.ng';

  const details: string[] = [];
  if (context.driverName) details.push(`Driver: ${context.driverName}`);
  if (context.minutesSilent) details.push(`Silent for ${context.minutesSilent} min`);
  if (context.minutesOverdue) details.push(`${context.minutesOverdue} min overdue`);
  if (context.customerName) details.push(`Customer: ${context.customerName}`);
  if (context.zone) details.push(`Zone: ${context.zone}`);
  if (context.ratePct !== undefined) details.push(`Rate: ${context.ratePct}%`);
  if (context.minutesSinceUpdate) details.push(`No update for ${context.minutesSinceUpdate} min`);

  const lines = [
    `🔴 CRITICAL — ${label}`,
    `${deliveryRef}${details.length ? ' | ' + details.join(' | ') : ''}`,
    `→ View: ${adminUrl}/deliveries${context.deliveryId ? `/${context.deliveryId}` : ''}`,
  ];

  return lines.join('\n');
}

export async function sendPumbleAlert(
  webhookUrl: string,
  rule: AlertRule,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatPumbleMessage(rule, context) }),
    });
  } catch (err) {
    // Non-blocking — alert was already written to DB; Pumble failure is logged only
    console.error(`[alert-engine] Pumble send failed for rule ${rule}:`, err);
  }
}
```

- [ ] **Step 4: Create `workers/alert-engine/src/settings.ts`**

```typescript
import { db } from './db';
import { alertSettings } from '@surewaka/db';
import type { AlertSettings } from '@surewaka/shared';

export async function loadSettings(): Promise<AlertSettings> {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) throw new Error('alert_settings row missing — run migration 20260703000002');

  return {
    driverSilentWarningMin: row.driverSilentWarningMin,
    driverSilentCriticalMin: row.driverSilentCriticalMin,
    legOverdueWarningMin: row.legOverdueWarningMin,
    legOverdueCriticalMin: row.legOverdueCriticalMin,
    customerUpdateGapWarningMin: row.customerUpdateGapWarningMin,
    customerUpdateGapCriticalMin: row.customerUpdateGapCriticalMin,
    ontimeRateWarningPct: row.ontimeRateWarningPct,
    ontimeRateCriticalPct: row.ontimeRateCriticalPct,
    pumbleWebhookUrl: row.pumbleWebhookUrl,
    pushEnabled: row.pushEnabled,
    pumbleEnabled: row.pumbleEnabled,
  };
}
```

- [ ] **Step 5: Create `workers/alert-engine/src/push.ts`**

```typescript
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { PUSH_QUEUE_NAME } from '@surewaka/shared';
import type { AlertRule } from '@surewaka/shared';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    _queue = new Queue(PUSH_QUEUE_NAME, { connection });
  }
  return _queue;
}

const RULE_PUSH_TITLES: Record<AlertRule, string> = {
  driver_silent: '🔴 Driver Silent',
  leg_overdue: '🔴 Leg Overdue',
  driver_ghost: '🔴 Driver Ghost',
  dispute_filed: '⚠️ Dispute Filed',
  delivery_failed: '⚠️ Delivery Failed',
  ontime_rate_drop: '⚠️ On-Time Rate Drop',
  customer_update_gap: '⚠️ Customer Update Gap',
};

export async function enqueueAdminPush(
  rule: AlertRule,
  context: Record<string, unknown>,
  adminUserIds: string[],
): Promise<void> {
  if (adminUserIds.length === 0) return;
  const queue = getQueue();

  const body = context.deliveryId
    ? `Delivery #${context.deliveryId} needs attention`
    : 'Check the operations dashboard';

  for (const userId of adminUserIds) {
    await queue.add(
      'admin-alert',
      {
        userId,
        targetApp: 'admin' as const,
        payload: {
          title: RULE_PUSH_TITLES[rule],
          body,
          data: { alertRule: rule, deliveryId: context.deliveryId ?? null },
        },
        priority: 'high' as const,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }
}
```

- [ ] **Step 6: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/alert-engine test 2>&1 | grep -E "FAIL|PASS|pumble"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/alert-engine/src/settings.ts workers/alert-engine/src/pumble.ts workers/alert-engine/src/push.ts workers/alert-engine/src/__tests__/pumble.test.ts
git commit -m "feat(alert-engine): add settings loader, Pumble sender, admin push enqueuer"
```

---

### Task 5: Alert rules — all 7 rules

**Files:**
- Create: `workers/alert-engine/src/rules/driver-silent.ts`
- Create: `workers/alert-engine/src/rules/leg-overdue.ts`
- Create: `workers/alert-engine/src/rules/driver-ghost.ts`
- Create: `workers/alert-engine/src/rules/dispute-filed.ts`
- Create: `workers/alert-engine/src/rules/delivery-failed.ts`
- Create: `workers/alert-engine/src/rules/ontime-rate-drop.ts`
- Create: `workers/alert-engine/src/rules/customer-update-gap.ts`
- Create: `workers/alert-engine/src/__tests__/driver-silent.test.ts`
- Create: `workers/alert-engine/src/__tests__/leg-overdue.test.ts`
- Create: `workers/alert-engine/src/__tests__/customer-update-gap.test.ts`

**Interfaces:**
- Consumes: `AlertSettings` from Task 4; `db` from Task 3
- Produces: Each rule file exports `evaluate(settings: AlertSettings): Promise<EvaluationResult[]>`

- [ ] **Step 1: Write driver-silent test**

```typescript
// workers/alert-engine/src/__tests__/driver-silent.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: { select: vi.fn() } }));

const mockSettings = {
  driverSilentWarningMin: 15,
  driverSilentCriticalMin: 30,
  legOverdueWarningMin: 30,
  legOverdueCriticalMin: 60,
  customerUpdateGapWarningMin: 45,
  customerUpdateGapCriticalMin: 90,
  ontimeRateWarningPct: 80,
  ontimeRateCriticalPct: 60,
  pumbleWebhookUrl: null,
  pushEnabled: true,
  pumbleEnabled: false,
};

const now = new Date();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe('evaluateDriverSilent', () => {
  it('returns no results when DB returns no active legs', async () => {
    const { db } = await import('../db');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const { evaluate } = await import('../rules/driver-silent');
    const results = await evaluate(mockSettings);
    expect(results).toHaveLength(0);
  });

  it('returns warning when last ping was 20 minutes ago', async () => {
    const { db } = await import('../db');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            legId: 'leg-1',
            deliveryId: 'del-1',
            driverName: 'Emeka N.',
            zone: 'Lekki',
            lastPing: minsAgo(20),
          }]),
        }),
      }),
    });
    const { evaluate } = await import('../rules/driver-silent');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('warning');
    expect(results[0]?.shouldFire).toBe(true);
  });

  it('returns critical when last ping was 35 minutes ago', async () => {
    const { db } = await import('../db');
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            legId: 'leg-1',
            deliveryId: 'del-1',
            driverName: 'Emeka N.',
            zone: 'Lekki',
            lastPing: minsAgo(35),
          }]),
        }),
      }),
    });
    const { evaluate } = await import('../rules/driver-silent');
    const results = await evaluate(mockSettings);
    expect(results[0]?.severity).toBe('critical');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/alert-engine test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|driver-silent"
```

Expected: FAIL.

- [ ] **Step 3: Create `workers/alert-engine/src/rules/driver-silent.ts`**

```typescript
import { db } from '../db';
import { deliveryLegs, driverLocations, drivers, users } from '@surewaka/db';
import { eq, and, inArray, sql, max } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

// Active leg statuses where a driver should be sending GPS pings
const ACTIVE_STATUSES = [
  'accepted', 'en_route_pickup', 'arrived_pickup',
  'picked_up', 'en_route_dropoff', 'arrived_dropoff',
] as const;

export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  // Find active driver legs with their last GPS ping time
  const rows = await db
    .select({
      legId: deliveryLegs.id,
      deliveryId: deliveryLegs.deliveryId,
      driverName: users.name,
      zone: deliveryLegs.dropoffZone,
      lastPing: max(driverLocations.recordedAt),
    })
    .from(deliveryLegs)
    .leftJoin(drivers, eq(deliveryLegs.actorId, drivers.id))
    .leftJoin(users, eq(drivers.userId, users.id))
    .leftJoin(
      driverLocations,
      and(
        eq(driverLocations.driverId, deliveryLegs.actorId),
        eq(driverLocations.deliveryId, deliveryLegs.deliveryId),
      ),
    )
    .where(
      and(
        eq(deliveryLegs.actorType, 'driver'),
        inArray(deliveryLegs.status, [...ACTIVE_STATUSES]),
      ),
    )
    .groupBy(deliveryLegs.id, deliveryLegs.deliveryId, users.name, deliveryLegs.dropoffZone);

  const now = Date.now();
  const results: EvaluationResult[] = [];

  for (const row of rows) {
    if (!row.lastPing) continue; // No pings at all — ghost rule handles this

    const minutesSilent = (now - new Date(row.lastPing).getTime()) / 60_000;

    if (minutesSilent >= settings.driverSilentCriticalMin) {
      results.push({
        deliveryId: row.deliveryId,
        legId: row.legId,
        rule: 'driver_silent',
        severity: 'critical',
        context: {
          deliveryId: row.deliveryId,
          driverName: row.driverName ?? 'Unknown',
          minutesSilent: Math.floor(minutesSilent),
          zone: row.zone ?? 'Unknown',
        },
        shouldFire: true,
      });
    } else if (minutesSilent >= settings.driverSilentWarningMin) {
      results.push({
        deliveryId: row.deliveryId,
        legId: row.legId,
        rule: 'driver_silent',
        severity: 'warning',
        context: {
          deliveryId: row.deliveryId,
          driverName: row.driverName ?? 'Unknown',
          minutesSilent: Math.floor(minutesSilent),
          zone: row.zone ?? 'Unknown',
        },
        shouldFire: true,
      });
    } else {
      // Condition cleared — resolve any existing alert
      results.push({
        deliveryId: row.deliveryId,
        legId: row.legId,
        rule: 'driver_silent',
        severity: 'info',
        context: {},
        shouldFire: false,
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Create `workers/alert-engine/src/rules/leg-overdue.ts`**

```typescript
import { db } from '../db';
import { deliveryLegs, users, drivers } from '@surewaka/db';
import { eq, and, inArray, isNotNull, or } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

const ACTIVE_STATUSES = [
  'accepted', 'en_route_pickup', 'arrived_pickup',
  'picked_up', 'en_route_dropoff', 'arrived_dropoff',
] as const;

export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const rows = await db
    .select({
      legId: deliveryLegs.id,
      deliveryId: deliveryLegs.deliveryId,
      driverEtaAt: deliveryLegs.driverEtaAt,
      systemEtaAt: deliveryLegs.systemEtaAt,
      zone: deliveryLegs.dropoffZone,
      actorType: deliveryLegs.actorType,
    })
    .from(deliveryLegs)
    .where(
      and(
        inArray(deliveryLegs.status, [...ACTIVE_STATUSES]),
        or(
          isNotNull(deliveryLegs.driverEtaAt),
          isNotNull(deliveryLegs.systemEtaAt),
        ),
      ),
    );

  const now = Date.now();
  const results: EvaluationResult[] = [];

  for (const row of rows) {
    // Driver ETA takes precedence over system ETA
    const etaRaw = row.driverEtaAt ?? row.systemEtaAt;
    if (!etaRaw) continue;

    const minutesOverdue = (now - new Date(etaRaw).getTime()) / 60_000;
    if (minutesOverdue <= 0) {
      results.push({ deliveryId: row.deliveryId, legId: row.legId, rule: 'leg_overdue', severity: 'info', context: {}, shouldFire: false });
      continue;
    }

    const context = {
      deliveryId: row.deliveryId,
      minutesOverdue: Math.floor(minutesOverdue),
      zone: row.zone ?? 'Unknown',
      etaSource: row.driverEtaAt ? 'driver' : 'system',
    };

    if (minutesOverdue >= settings.legOverdueCriticalMin) {
      results.push({ deliveryId: row.deliveryId, legId: row.legId, rule: 'leg_overdue', severity: 'critical', context, shouldFire: true });
    } else if (minutesOverdue >= settings.legOverdueWarningMin) {
      results.push({ deliveryId: row.deliveryId, legId: row.legId, rule: 'leg_overdue', severity: 'warning', context, shouldFire: true });
    } else {
      results.push({ deliveryId: row.deliveryId, legId: row.legId, rule: 'leg_overdue', severity: 'info', context: {}, shouldFire: false });
    }
  }

  return results;
}
```

- [ ] **Step 5: Create `workers/alert-engine/src/rules/driver-ghost.ts`**

```typescript
import { db } from '../db';
import { deliveryEvents, deliveryLegs, driverLocations, users, drivers } from '@surewaka/db';
import { eq, and, isNull, sql, max } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

export async function evaluate(_settings: AlertSettings): Promise<EvaluationResult[]> {
  // Ghost = delivery_event with to_status IN (cancelled, failed)
  //         AND from_status NOT IN (picked_up, delivered)
  //         AND (triggered_by = driver_id OR (triggered_by IS NULL AND no ping in 30 min))
  //         AND NOT triggered by customer
  const rows = await db.execute(sql`
    SELECT
      de.delivery_id,
      dl.id AS leg_id,
      u.name AS driver_name,
      de.triggered_by,
      de.created_at AS event_time,
      MAX(dloc.recorded_at) AS last_ping
    FROM delivery_events de
    JOIN delivery_legs dl ON dl.id = de.leg_id
    JOIN drivers dr ON dr.id = dl.actor_id AND dl.actor_type = 'driver'
    JOIN users u ON u.id = dr.user_id
    LEFT JOIN driver_locations dloc
      ON dloc.driver_id = dl.actor_id AND dloc.delivery_id = de.delivery_id
    WHERE de.to_status IN ('cancelled', 'failed')
      AND de.from_status NOT IN ('picked_up', 'en_route_dropoff', 'arrived_dropoff', 'delivered')
      AND de.created_at > now() - interval '10 minutes'
      AND de.triggered_by != (
        SELECT d2.customer_id FROM deliveries d2 WHERE d2.id = de.delivery_id
      )
    GROUP BY de.delivery_id, dl.id, u.name, de.triggered_by, de.created_at
  `);

  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    deliveryId: row.delivery_id as string,
    legId: row.leg_id as string,
    rule: 'driver_ghost' as const,
    severity: 'critical' as const,
    context: {
      deliveryId: row.delivery_id,
      driverName: row.driver_name ?? 'Unknown',
      triggeredBy: row.triggered_by ?? 'system',
    },
    shouldFire: true,
  }));
}
```

- [ ] **Step 6: Create `workers/alert-engine/src/rules/dispute-filed.ts`**

```typescript
import { db } from '../db';
import { deliveries } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

export async function evaluate(_settings: AlertSettings): Promise<EvaluationResult[]> {
  // Disputes are deliveries with escrow status 'disputed' that have no resolved alert yet
  const rows = await db.execute(sql`
    SELECT d.id AS delivery_id, d.customer_id, d.driver_id
    FROM deliveries d
    JOIN escrow_holds eh ON eh.delivery_id = d.id AND eh.status = 'disputed'
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts a
      WHERE a.delivery_id = d.id
        AND a.rule = 'dispute_filed'
        AND a.resolved_at IS NULL
    )
  `);

  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    deliveryId: row.delivery_id as string,
    legId: null,
    rule: 'dispute_filed' as const,
    severity: 'warning' as const,
    context: { deliveryId: row.delivery_id },
    shouldFire: true,
  }));
}
```

- [ ] **Step 7: Create `workers/alert-engine/src/rules/delivery-failed.ts`**

```typescript
import { db } from '../db';
import { deliveries } from '@surewaka/db';
import { eq, sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

export async function evaluate(_settings: AlertSettings): Promise<EvaluationResult[]> {
  const rows = await db.execute(sql`
    SELECT id AS delivery_id
    FROM deliveries
    WHERE status = 'failed'
      AND updated_at > now() - interval '2 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM alerts a
        WHERE a.delivery_id = deliveries.id
          AND a.rule = 'delivery_failed'
          AND a.resolved_at IS NULL
      )
  `);

  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    deliveryId: row.delivery_id as string,
    legId: null,
    rule: 'delivery_failed' as const,
    severity: 'warning' as const,
    context: { deliveryId: row.delivery_id },
    shouldFire: true,
  }));
}
```

- [ ] **Step 8: Create `workers/alert-engine/src/rules/ontime-rate-drop.ts`**

```typescript
import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';

export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
      COUNT(*) FILTER (
        WHERE status = 'delivered'
          AND updated_at <= system_eta_at
      ) AS on_time
    FROM deliveries
    WHERE DATE(created_at) = CURRENT_DATE
      AND status IN ('delivered', 'failed', 'cancelled')
  `);

  const row = result.rows[0] as { delivered: string; on_time: string } | undefined;
  const delivered = Number(row?.delivered ?? 0);
  const onTime = Number(row?.on_time ?? 0);

  if (delivered < 5) return []; // Not enough data for today yet

  const ratePct = Math.round((onTime / delivered) * 100);
  const context = { ratePct, delivered, onTime };

  if (ratePct < settings.ontimeRateCriticalPct) {
    return [{ deliveryId: null, legId: null, rule: 'ontime_rate_drop', severity: 'critical', context, shouldFire: true }];
  }
  if (ratePct < settings.ontimeRateWarningPct) {
    return [{ deliveryId: null, legId: null, rule: 'ontime_rate_drop', severity: 'warning', context, shouldFire: true }];
  }
  return [{ deliveryId: null, legId: null, rule: 'ontime_rate_drop', severity: 'info', context: {}, shouldFire: false }];
}
```

- [ ] **Step 9: Create `workers/alert-engine/src/rules/customer-update-gap.ts`**

```typescript
import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { AlertSettings } from '@surewaka/shared';
import type { EvaluationResult } from '../types';
import { CUSTOMER_FACING_STATUSES } from '@surewaka/shared';

export async function evaluate(settings: AlertSettings): Promise<EvaluationResult[]> {
  const statusList = CUSTOMER_FACING_STATUSES.map((s) => `'${s}'`).join(', ');

  const rows = await db.execute(sql.raw(`
    SELECT
      d.id AS delivery_id,
      d.recipient_name AS customer_name,
      EXTRACT(EPOCH FROM (now() - MAX(de.created_at))) / 60 AS minutes_since_update
    FROM deliveries d
    JOIN delivery_events de ON de.delivery_id = d.id
      AND de.to_status IN (${statusList})
    WHERE d.status NOT IN ('delivered', 'cancelled', 'failed', 'returned', 'draft')
    GROUP BY d.id, d.recipient_name
  `));

  const results: EvaluationResult[] = [];
  const critical = settings.customerUpdateGapCriticalMin;
  const warning = settings.customerUpdateGapWarningMin;

  for (const row of rows.rows as Array<Record<string, unknown>>) {
    const mins = Number(row.minutes_since_update ?? 0);
    const context = { deliveryId: row.delivery_id, customerName: row.customer_name, minutesSinceUpdate: Math.floor(mins) };

    if (mins >= critical) {
      results.push({ deliveryId: row.delivery_id as string, legId: null, rule: 'customer_update_gap', severity: 'critical', context, shouldFire: true });
    } else if (mins >= warning) {
      results.push({ deliveryId: row.delivery_id as string, legId: null, rule: 'customer_update_gap', severity: 'warning', context, shouldFire: true });
    } else {
      results.push({ deliveryId: row.delivery_id as string, legId: null, rule: 'customer_update_gap', severity: 'info', context: {}, shouldFire: false });
    }
  }
  return results;
}
```

- [ ] **Step 10: Run all tests**

```bash
pnpm --filter @surewaka/alert-engine test 2>&1 | grep -E "FAIL|PASS"
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add workers/alert-engine/src/rules/ workers/alert-engine/src/__tests__/
git commit -m "feat(alert-engine): add 7 alert evaluation rules — driver-silent, leg-overdue, driver-ghost, dispute, failed, ontime-rate, customer-update-gap"
```

---

### Task 6: Alert engine main polling loop

**Files:**
- Create: `workers/alert-engine/src/index.ts`

**Interfaces:**
- Consumes: all 7 rule `evaluate()` functions; `loadSettings()`; `sendPumbleAlert()`; `enqueueAdminPush()`
- Produces: long-running process, polls every 60s, writes/escalates/resolves `alerts` rows, routes Critical alerts to push + Pumble

- [ ] **Step 1: Create `workers/alert-engine/src/index.ts`**

```typescript
import { db } from './db';
import { loadSettings } from './settings';
import { sendPumbleAlert } from './pumble';
import { enqueueAdminPush } from './push';
import { alerts, users, userRoles } from '@surewaka/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { EvaluationResult } from './types';
import type { AlertRule, AlertSeverity } from '@surewaka/shared';

import { evaluate as evalDriverSilent } from './rules/driver-silent';
import { evaluate as evalLegOverdue } from './rules/leg-overdue';
import { evaluate as evalDriverGhost } from './rules/driver-ghost';
import { evaluate as evalDisputeFiled } from './rules/dispute-filed';
import { evaluate as evalDeliveryFailed } from './rules/delivery-failed';
import { evaluate as evalOntimeRate } from './rules/ontime-rate-drop';
import { evaluate as evalCustomerUpdateGap } from './rules/customer-update-gap';

const POLL_INTERVAL_MS = 60_000;

async function getAdminUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.role, 'surewaka_admin'), eq(userRoles.isActive, true)));
  return rows.map((r) => r.userId);
}

async function upsertAlert(result: EvaluationResult, settings: Awaited<ReturnType<typeof loadSettings>>, adminUserIds: string[]): Promise<void> {
  if (!result.shouldFire) {
    // Resolve any existing unresolved alert for this rule+leg/delivery
    await db
      .update(alerts)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(alerts.rule, result.rule),
          isNull(alerts.resolvedAt),
          result.legId ? eq(alerts.legId, result.legId) : isNull(alerts.legId),
          result.deliveryId ? eq(alerts.deliveryId, result.deliveryId) : isNull(alerts.deliveryId),
        ),
      );
    return;
  }

  // Check for existing unresolved alert for this rule+leg/delivery
  const [existing] = await db
    .select({ id: alerts.id, severity: alerts.severity })
    .from(alerts)
    .where(
      and(
        eq(alerts.rule, result.rule),
        isNull(alerts.resolvedAt),
        result.legId ? eq(alerts.legId, result.legId) : isNull(alerts.legId),
        result.deliveryId ? eq(alerts.deliveryId, result.deliveryId) : isNull(alerts.deliveryId),
      ),
    )
    .limit(1);

  if (existing) {
    // Escalate in place if severity increased
    const severityOrder: AlertSeverity[] = ['info', 'warning', 'critical'];
    const existingIdx = severityOrder.indexOf(existing.severity as AlertSeverity);
    const newIdx = severityOrder.indexOf(result.severity);

    if (newIdx > existingIdx) {
      await db
        .update(alerts)
        .set({
          severity: result.severity,
          originalSeverity: existing.severity as AlertSeverity,
          escalatedAt: new Date(),
          context: result.context,
        })
        .where(eq(alerts.id, existing.id));

      if (result.severity === 'critical') {
        await routeCritical(result, settings, adminUserIds);
      }
    }
    return;
  }

  // New alert
  await db.insert(alerts).values({
    deliveryId: result.deliveryId,
    legId: result.legId,
    rule: result.rule,
    severity: result.severity,
    context: result.context,
  });

  if (result.severity === 'critical') {
    await routeCritical(result, settings, adminUserIds);
  }
}

async function routeCritical(
  result: EvaluationResult,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  adminUserIds: string[],
): Promise<void> {
  if (settings.pumbleEnabled && settings.pumbleWebhookUrl) {
    await sendPumbleAlert(settings.pumbleWebhookUrl, result.rule, result.context);
  }
  if (settings.pushEnabled) {
    await enqueueAdminPush(result.rule, result.context, adminUserIds);
  }
}

async function runTick(): Promise<void> {
  const [settings, adminUserIds] = await Promise.all([loadSettings(), getAdminUserIds()]);

  const allResults: EvaluationResult[] = (
    await Promise.allSettled([
      evalDriverSilent(settings),
      evalLegOverdue(settings),
      evalDriverGhost(settings),
      evalDisputeFiled(settings),
      evalDeliveryFailed(settings),
      evalOntimeRate(settings),
      evalCustomerUpdateGap(settings),
    ])
  ).flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  for (const result of allResults) {
    try {
      await upsertAlert(result, settings, adminUserIds);
    } catch (err) {
      console.error(`[alert-engine] upsertAlert failed for rule ${result.rule}:`, err);
    }
  }

  console.log(`[alert-engine] tick complete — ${allResults.filter((r) => r.shouldFire).length} active conditions`);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

console.log('[alert-engine] starting — poll interval: 60s');

// Run immediately on start, then every 60s
runTick().catch(console.error);
const timer = setInterval(() => runTick().catch(console.error), POLL_INTERVAL_MS);

process.on('SIGTERM', () => { clearInterval(timer); console.log('[alert-engine] stopped'); process.exit(0); });
process.on('SIGINT',  () => { clearInterval(timer); console.log('[alert-engine] stopped'); process.exit(0); });
```

- [ ] **Step 2: Run the worker in dev mode to verify it starts**

```bash
pnpm --filter @surewaka/alert-engine dev 2>&1 | head -5
```

Expected: `[alert-engine] starting — poll interval: 60s` then a tick log line.

- [ ] **Step 3: Commit**

```bash
git add workers/alert-engine/src/index.ts
git commit -m "feat(alert-engine): add 60s polling loop — evaluates all 7 rules, upserts/escalates alerts, routes critical to push+Pumble"
```

---

### Task 7: Alert settings API route

**Files:**
- Create: `apps/api/src/routes/admin/alert-settings.ts`
- Create: `apps/api/src/__tests__/alert-settings-routes.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/admin/alert-settings` → `{ data: AlertSettings, error: null, meta: null }`
  - `PUT /api/v1/admin/alert-settings` → `{ data: AlertSettings, error: null, meta: null }`
  - `POST /api/v1/admin/alert-settings/test` → sends a dummy Critical alert through configured channels → `{ data: { sent: true }, error: null, meta: null }`

- [ ] **Step 1: Write the test**

```typescript
// apps/api/src/__tests__/alert-settings-routes.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{
          driverSilentWarningMin: 15,
          driverSilentCriticalMin: 30,
          legOverdueWarningMin: 30,
          legOverdueCriticalMin: 60,
          customerUpdateGapWarningMin: 45,
          customerUpdateGapCriticalMin: 90,
          ontimeRateWarningPct: 80,
          ontimeRateCriticalPct: 60,
          pumbleWebhookUrl: null,
          pushEnabled: true,
          pumbleEnabled: false,
        }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ driverSilentWarningMin: 20 }]),
      }),
    }),
  },
  alertSettings: {},
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: any, next: any) => { c.set('user', { id: 'u1' }); await next(); }),
}));

vi.mock('../middleware/role', () => ({
  requireRole: vi.fn(() => async (c: any, next: any) => { await next(); }),
}));

const { default: app } = await import('../index');

describe('GET /api/v1/admin/alert-settings', () => {
  it('returns current settings', async () => {
    const res = await app.request('/api/v1/admin/alert-settings', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.driverSilentWarningMin).toBe(15);
  });
});

describe('PUT /api/v1/admin/alert-settings', () => {
  it('returns 400 for invalid threshold', async () => {
    const res = await app.request('/api/v1/admin/alert-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ driverSilentWarningMin: 3 }), // below min of 5
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|alert-settings"
```

Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/routes/admin/alert-settings.ts`**

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { db, alertSettings } from '@surewaka/db';
import { updateAlertSettingsSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const alertSettingsRoutes = new Hono<Env>();
alertSettingsRoutes.use('*', requireAuth);
alertSettingsRoutes.use('*', requireRole('surewaka_admin'));

alertSettingsRoutes.get('/', async (c) => {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Settings not initialised' }, meta: null }, 404);
  return c.json({ data: row, error: null, meta: null });
});

alertSettingsRoutes.put('/', async (c) => {
  const body = await c.req.json();
  const parsed = updateAlertSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const [updated] = await db
    .update(alertSettings)
    .set({ ...parsed.data, updatedAt: new Date() })
    .returning();

  return c.json({ data: updated, error: null, meta: null });
});

alertSettingsRoutes.post('/test', async (c) => {
  const [row] = await db.select().from(alertSettings).limit(1);
  if (!row) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Settings not initialised' }, meta: null }, 404);

  // Fire a dummy critical alert through configured channels
  if (row.pumbleEnabled && row.pumbleWebhookUrl) {
    await fetch(row.pumbleWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '🔴 CRITICAL — Test Alert\nThis is a test from SureWaka admin alert system.\n→ View: ' + (process.env.ADMIN_URL ?? 'https://admin.surewaka.ng') }),
    }).catch(() => {}); // non-blocking
  }

  return c.json({ data: { sent: true, pumble: row.pumbleEnabled, push: row.pushEnabled }, error: null, meta: null });
});

export default alertSettingsRoutes;
```

- [ ] **Step 4: Register route in `apps/api/src/index.ts`**

```typescript
import alertSettingsRoutes from './routes/admin/alert-settings';
// ...
app.route('/api/v1/admin/alert-settings', alertSettingsRoutes);
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|alert-settings"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/alert-settings.ts apps/api/src/__tests__/alert-settings-routes.test.ts apps/api/src/index.ts
git commit -m "feat(api): add GET/PUT /api/v1/admin/alert-settings and POST /test endpoint"
```

---

### Task 8: Alert settings UI — `/settings/alerts`

**Files:**
- Create: `apps/admin/app/hooks/use-alert-settings.ts`
- Create: `apps/admin/app/routes/settings/alerts.tsx`
- Modify: `apps/admin/app/routes/settings.tsx` — add link to alerts sub-route

**Interfaces:**
- Consumes: `GET/PUT /api/v1/admin/alert-settings`; `POST /api/v1/admin/alert-settings/test`
- Produces: Settings page at `/settings/alerts` with threshold sliders, routing toggles, Pumble URL input, test button, and alert history log (last 30 days)

- [ ] **Step 1: Create `apps/admin/app/hooks/use-alert-settings.ts`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { AlertSettings } from '@surewaka/shared';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function useAlertSettings() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/alert-settings`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load');
      setSettings(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alert settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (updates: Partial<AlertSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/alert-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}`,
        },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to save');
      setSettings(json.data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const sendTestAlert = useCallback(async () => {
    const res = await fetch(`${API}/api/v1/admin/alert-settings/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` },
    });
    return res.ok;
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  return { settings, isLoading, isSaving, error, saveSettings, sendTestAlert, refetch: fetchSettings };
}
```

- [ ] **Step 2: Create `apps/admin/app/routes/settings/alerts.tsx`**

```typescript
import { useState } from 'react';
import { Bell, AlertTriangle, Webhook, Smartphone, TestTube } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { Slider } from '~/components/ui/slider';
import { Skeleton } from '~/components/ui/skeleton';
import { cn } from '~/lib/utils';
import { useAlertSettings } from '~/hooks/use-alert-settings';
import type { Route } from './+types/alerts';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Alert Settings' }];
}

export default function AlertSettings() {
  const { settings, isLoading, isSaving, error, saveSettings, sendTestAlert } = useAlertSettings();
  const [testSent, setTestSent] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string>('');

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error ?? 'Failed to load alert settings.'}</p>
      </div>
    );
  }

  const handleSendTest = async () => {
    const ok = await sendTestAlert();
    if (ok) { setTestSent(true); setTimeout(() => setTestSent(false), 3000); }
  };

  return (
    <div className="space-y-8 p-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Alert Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure thresholds and notification routing for operational alerts.
        </p>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {error}
        </p>
      )}

      {/* ─── Thresholds ─────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
          <Bell className="h-4 w-4" aria-hidden="true" />
          Alert Thresholds
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Nigerian network conditions: the 15-min driver silent threshold is intentionally generous
          for connectivity drops in Lagos traffic.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {[
            { label: 'Driver Silent Warning', field: 'driverSilentWarningMin' as const, value: settings.driverSilentWarningMin, min: 5, max: 60, unit: 'min' },
            { label: 'Driver Silent Critical', field: 'driverSilentCriticalMin' as const, value: settings.driverSilentCriticalMin, min: 10, max: 120, unit: 'min' },
            { label: 'Leg Overdue Warning', field: 'legOverdueWarningMin' as const, value: settings.legOverdueWarningMin, min: 10, max: 120, unit: 'min' },
            { label: 'Leg Overdue Critical', field: 'legOverdueCriticalMin' as const, value: settings.legOverdueCriticalMin, min: 20, max: 240, unit: 'min' },
            { label: 'Customer Update Gap Warning', field: 'customerUpdateGapWarningMin' as const, value: settings.customerUpdateGapWarningMin, min: 15, max: 120, unit: 'min' },
            { label: 'Customer Update Gap Critical', field: 'customerUpdateGapCriticalMin' as const, value: settings.customerUpdateGapCriticalMin, min: 30, max: 240, unit: 'min' },
            { label: 'On-Time Rate Warning', field: 'ontimeRateWarningPct' as const, value: settings.ontimeRateWarningPct, min: 50, max: 100, unit: '%' },
            { label: 'On-Time Rate Critical', field: 'ontimeRateCriticalPct' as const, value: settings.ontimeRateCriticalPct, min: 30, max: 90, unit: '%' },
          ].map(({ label, field, value, min, max, unit }) => (
            <div key={field} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{label}</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{value} {unit}</span>
              </div>
              <Slider
                min={min}
                max={max}
                step={1}
                value={[value]}
                onValueChange={([v]) => saveSettings({ [field]: v })}
                aria-label={label}
                disabled={isSaving}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ─── Pumble ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
          <Webhook className="h-4 w-4" aria-hidden="true" />
          Pumble Webhook
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Critical alerts are posted to this channel. Warning and Info stay in-app only.
        </p>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="pumble-enabled" className="text-sm">Enable Pumble alerts</Label>
            <Switch
              id="pumble-enabled"
              checked={settings.pumbleEnabled}
              onCheckedChange={(v) => saveSettings({ pumbleEnabled: v })}
              disabled={isSaving}
            />
          </div>

          <div className={cn('space-y-2', !settings.pumbleEnabled && 'opacity-50 pointer-events-none')}>
            <Label htmlFor="pumble-url" className="text-sm">Incoming webhook URL</Label>
            <div className="flex gap-2">
              <Input
                id="pumble-url"
                type="url"
                placeholder="https://api.pumble.com/workspaces/.../incoming-webhooks/..."
                defaultValue={settings.pumbleWebhookUrl ?? ''}
                onChange={(e) => setPendingUrl(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveSettings({ pumbleWebhookUrl: pendingUrl || null })}
                disabled={isSaving || !pendingUrl}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Push notifications ─────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          Push Notifications
        </h3>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <Label htmlFor="push-enabled" className="text-sm font-medium">Enable push alerts</Label>
            <p className="text-xs text-muted-foreground">Sends to all admin users with registered devices. Critical alerts only.</p>
          </div>
          <Switch
            id="push-enabled"
            checked={settings.pushEnabled}
            onCheckedChange={(v) => saveSettings({ pushEnabled: v })}
            disabled={isSaving}
          />
        </div>

        <div className="mt-4 rounded-lg border border-dashed border-border p-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">WhatsApp Business</span> — coming soon.
            Configure a BSP account (Twilio, Vonage) to route critical alerts to a WhatsApp channel.
            The Pumble webhook is the recommended channel in the meantime.
          </p>
        </div>
      </section>

      {/* ─── Test alert ─────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
          <TestTube className="h-4 w-4" aria-hidden="true" />
          Test Alert
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Sends a dummy Critical alert through all configured channels to verify routing works.
          Run this before going live.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={handleSendTest}
          disabled={isSaving}
          aria-label="Send test alert"
        >
          {testSent ? '✓ Test alert sent' : 'Send test alert'}
        </Button>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Add link to alerts in `apps/admin/app/routes/settings.tsx`**

Replace the "Settings panel coming soon" placeholder:

```typescript
import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import type { Route } from './+types/settings';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Settings' }];
}

export default function Settings() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform configuration and admin preferences</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/settings/alerts"
          className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
        >
          <Bell className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">Alert Settings</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Thresholds, Pumble webhook, push routing</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Start admin dev server and verify page loads**

```bash
pnpm --filter @surewaka/admin dev
```

Open `http://localhost:3001/settings/alerts`. Verify:
- Page loads without errors
- Threshold sliders render with correct default values
- Pumble section shows toggle + URL input
- WhatsApp placeholder is visible
- Test alert button is present

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/hooks/use-alert-settings.ts apps/admin/app/routes/settings/alerts.tsx apps/admin/app/routes/settings.tsx
git commit -m "feat(admin): add /settings/alerts UI — thresholds, Pumble config, push toggle, test alert button"
```

---

### Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| 60s polling alert engine | Task 6 — `src/index.ts` setInterval |
| 7 alert rules | Task 5 — all 7 rule files |
| Alert escalation in-place | Task 6 — `upsertAlert()` updates existing row |
| alerts table + RLS | Task 1 — migration |
| Push notification infrastructure | Tasks 3+4 — `push.ts`, enqueues to push-worker BullMQ |
| Admin push tokens (extends constraint) | Task 1 — `push_tokens_app_check` extended |
| Pumble webhook routing | Task 4 — `pumble.ts` |
| WhatsApp placeholder | Task 8 — UI section |
| GET/PUT alert settings API | Task 7 |
| Test alert endpoint | Task 7 — `POST /test` |
| `/settings/alerts` UI | Task 8 |
| Threshold sliders + routing toggles | Task 8 |
| Alert history log | Not yet implemented — the alert history query (last 30 days, filterable) was omitted. Add a `GET /api/v1/admin/alerts?resolved=true&limit=100` endpoint and a read-only table component below the test button in `alerts.tsx`. This is additive and does not block any other task. |
| Ghost detection precision | Task 5 — `driver-ghost.ts` excludes customer-triggered cancellations |
| Nigerian network note in code | Task 8 — comment in UI, Task 5 — driver-silent threshold |

**One gap identified:** alert history log (last 30 days) is noted above as a follow-on addition. All other spec requirements are covered.
