# System Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a schema-driven, admin-tunable config store for operational parameters — starting with driver matching engine parameters — with a Zod registry that drives both API validation and admin UI rendering.

**Architecture:** A `system_config` key-value table (JSONB) backed by a modular Zod registry in `packages/shared`. Workers read via a 5-min TTL in-memory cache (`getConfig()`). Admin UI renders forms directly from registry schema using a lightweight custom `<ConfigField>` renderer. Role split: `surewaka_admin` reads, `surewaka_superadmin` writes.

**Tech Stack:** Drizzle ORM (NeonDB), Hono (API), Zod v3, React Router v7, shadcn/ui, Clerk (auth), Vitest (tests), fast-check (property tests)

**Spec:** `docs/superpowers/specs/2026-07-27-system-config-design.md`

---

### Task 1: Extend role model — add `surewaka_superadmin`

**Files:**
- Modify: `packages/shared/src/types.ts:10`
- Modify: `packages/shared/src/constants.ts:16`
- Modify: `apps/api/src/middleware/role.ts`
- Modify: `apps/api/src/__tests__/role-middleware.property.test.ts`
- Modify: `apps/api/src/test-utils/auth-mock.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/__tests__/role-middleware.property.test.ts`, inside the outer `describe` block, after the existing `describe('Property 1...')` block:

```typescript
describe('Property 2: surewaka_superadmin bypasses all role checks', () => {
  it('surewaka_superadmin is granted access for any required roles including superadmin-only', async () => {
    await fc.assert(
      fc.asyncProperty(requiredRolesArb, async (requiredRoles) => {
        const user = createMockUser(['surewaka_superadmin']);
        const app = createTestApp(requiredRoles, user);
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }),
      { numRuns: 100 },
    );
  });

  it('surewaka_admin is denied access to surewaka_superadmin-only routes', async () => {
    const user = createMockUser(['surewaka_admin']);
    const app = createTestApp(['surewaka_superadmin'], user);
    const res = await app.request('/test');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
pnpm --filter @surewaka/api test role-middleware.property
```

Expected: 2 new tests fail — `surewaka_superadmin` bypasses fails (not in UserRole), `surewaka_admin` denied fails (admin currently bypasses everything).

- [ ] **Step 3: Add `surewaka_superadmin` to shared types and constants**

In `packages/shared/src/types.ts` line 10, change:
```typescript
export type UserRole = 'customer' | 'driver' | 'surewaka_admin' | 'carrier_driver' | 'carrier_admin' | 'support_agent';
```
to:
```typescript
export type UserRole = 'customer' | 'driver' | 'surewaka_admin' | 'surewaka_superadmin' | 'carrier_driver' | 'carrier_admin' | 'support_agent';
```

In `packages/shared/src/constants.ts` line 16, change:
```typescript
export const USER_ROLES = ['customer', 'driver', 'surewaka_admin', 'carrier_driver', 'carrier_admin', 'support_agent'] as const;
```
to:
```typescript
export const USER_ROLES = ['customer', 'driver', 'surewaka_admin', 'surewaka_superadmin', 'carrier_driver', 'carrier_admin', 'support_agent'] as const;
```

- [ ] **Step 4: Update `requireRole` middleware**

Replace the two bypass lines in `apps/api/src/middleware/role.ts`. Find:
```typescript
    // Hierarchy bypass: surewaka_admin always has access
    if (userRoles.includes('surewaka_admin')) {
      await next();
      return;
    }
```
Replace with:
```typescript
    // Hierarchy: surewaka_superadmin > surewaka_admin > others
    // surewaka_superadmin bypasses all role checks
    if (userRoles.includes('surewaka_superadmin')) {
      await next();
      return;
    }
    // surewaka_admin bypasses all non-superadmin routes
    if (userRoles.includes('surewaka_admin') && !roles.includes('surewaka_superadmin')) {
      await next();
      return;
    }
```

- [ ] **Step 5: Update property test file — filter both bypass roles from `NON_ADMIN_ROLES`**

In `apps/api/src/__tests__/role-middleware.property.test.ts`, change line 16:
```typescript
const NON_ADMIN_ROLES = USER_ROLES.filter((r) => r !== 'surewaka_admin');
```
to:
```typescript
const NON_ADMIN_ROLES = USER_ROLES.filter((r) => r !== 'surewaka_admin' && r !== 'surewaka_superadmin');
```

Also update the existing Property 1 test title and the `requiredRolesArb` used within it to exclude `surewaka_superadmin` from the required roles arbitraries (admin should not bypass superadmin-only routes). Find the `describe('Property 1...')` block and add this constant inside it, then use it in each test:

```typescript
// Within Property 1 describe block — roles that surewaka_admin can bypass
const nonSuperAdminRolesArb = fc
  .subarray([...USER_ROLES.filter((r) => r !== 'surewaka_superadmin')], { minLength: 1 })
  .map((arr) => arr as UserRole[]);
```

Replace all three uses of `requiredRolesArb` inside `describe('Property 1...')` with `nonSuperAdminRolesArb`. The `describe('Property 12...')` tests are unaffected.

- [ ] **Step 6: Add `superadmin` persona to `auth-mock.ts`**

In `apps/api/src/test-utils/auth-mock.ts`, add to the `personas` object after `admin`:
```typescript
  superadmin: (): AuthUser => ({
    id: 'user-superadmin-id',
    clerkId: 'clerk_superadmin_123',
    email: 'superadmin@surewaka.com',
    roles: ['surewaka_superadmin'],
    role: 'surewaka_superadmin',
  }),
```

- [ ] **Step 7: Run all role tests**

```bash
pnpm --filter @surewaka/api test role-middleware
```

Expected: All pass. The two new Property 2 tests now pass.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts \
  apps/api/src/middleware/role.ts \
  apps/api/src/__tests__/role-middleware.property.test.ts \
  apps/api/src/test-utils/auth-mock.ts
git commit -m "feat(auth): add surewaka_superadmin role with two-tier admin hierarchy"
```

---

### Task 2: DB schema — `system_config` table

**Files:**
- Create: `packages/db/src/schema/system-config.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create schema file**

```typescript
// packages/db/src/schema/system-config.ts
import { pgTable, text, jsonb, uuid, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const systemConfig = pgTable('system_config', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Export from schema index**

Add to `packages/db/src/schema/index.ts` at the end:
```typescript
// System config
export * from './system-config';
```

- [ ] **Step 3: Generate migration**

```bash
pnpm --filter @surewaka/db db:generate
```

Expected: A new migration file created in `packages/db/drizzle/` with `CREATE TABLE system_config`.

- [ ] **Step 4: Apply migration**

```bash
pnpm --filter @surewaka/db db:migrate
```

Expected: Migration applied successfully — no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/system-config.ts packages/db/src/schema/index.ts packages/db/drizzle/
git commit -m "feat(db): add system_config key-value table"
```

---

### Task 3: Config types + modular registry

**Files:**
- Create: `packages/shared/src/config/types.ts`
- Create: `packages/shared/src/config/registries/matching.ts`
- Create: `packages/shared/src/config/registries/pricing.ts`
- Create: `packages/shared/src/config/registries/routing.ts`
- Create: `packages/shared/src/config/registry.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create shared config types**

```typescript
// packages/shared/src/config/types.ts
import type { z } from 'zod';

export type ConfigCategory = 'matching' | 'routing' | 'pricing';

export type ConfigEntry<T extends z.ZodTypeAny> = {
  label: string;
  description?: string;
  category: ConfigCategory;
  schema: T;
  default: z.infer<T>;
};
```

- [ ] **Step 2: Create matching registry module**

```typescript
// packages/shared/src/config/registries/matching.ts
import { z } from 'zod';
import type { ConfigEntry } from '../types';

export const matchingConfig = {
  'matching.first_mile_dispatch_buffer_min': {
    label: 'First-Mile Dispatch Buffer (min)',
    description: 'Minutes before carrier departure to trigger driver matching (5min matching + 10min driver-to-pickup + 30min Lagos traffic headroom)',
    category: 'matching',
    schema: z.number().int().min(10).max(120),
    default: 45,
  },
  'matching.tier1_radius_km': {
    label: 'Tier 1 Search Radius (km)',
    description: 'Initial GEOSEARCH radius for the first broadcast tier',
    category: 'matching',
    schema: z.number().min(1).max(20),
    default: 5,
  },
  'matching.tier1_batch_size': {
    label: 'Tier 1 Batch Size',
    description: 'Max drivers offered the job simultaneously in tier 1',
    category: 'matching',
    schema: z.number().int().min(1).max(20),
    default: 5,
  },
  'matching.tier1_timeout_sec': {
    label: 'Tier 1 Timeout (sec)',
    description: 'Wait time for driver acceptance before escalating to tier 2',
    category: 'matching',
    schema: z.number().int().min(10).max(120),
    default: 30,
  },
  'matching.tier2_radius_km': {
    label: 'Tier 2 Search Radius (km)',
    category: 'matching',
    schema: z.number().min(1).max(30),
    default: 8,
  },
  'matching.tier2_batch_size': {
    label: 'Tier 2 Batch Size',
    category: 'matching',
    schema: z.number().int().min(1).max(30),
    default: 10,
  },
  'matching.tier2_timeout_sec': {
    label: 'Tier 2 Timeout (sec)',
    category: 'matching',
    schema: z.number().int().min(10).max(120),
    default: 30,
  },
  'matching.tier3_radius_km': {
    label: 'Tier 3 Search Radius (km)',
    category: 'matching',
    schema: z.number().min(1).max(50),
    default: 12,
  },
  'matching.tier3_timeout_sec': {
    label: 'Tier 3 Timeout (sec)',
    category: 'matching',
    schema: z.number().int().min(30).max(600),
    default: 180,
  },
  'matching.total_timeout_sec': {
    label: 'Total Match Timeout (sec)',
    description: 'After this total elapsed time, the delivery is auto-cancelled and refund triggered',
    category: 'matching',
    schema: z.number().int().min(60).max(600),
    default: 300,
  },
  'matching.scoring_weights': {
    label: 'Driver Scoring Weights',
    description: 'Composite score factors for ranking candidates. distancePerKm is negative (penalty per km away).',
    category: 'matching',
    schema: z.object({
      distancePerKm:    z.number().min(-50).max(0),
      acceptanceRate:   z.number().min(0).max(50),
      completionRate:   z.number().min(0).max(50),
      highRatingBonus:  z.number().min(0).max(50),
      lowRatingPenalty: z.number().min(-50).max(0),
      idleBonus30min:   z.number().min(0).max(50),
      idleBonus60min:   z.number().min(0).max(50),
      headingBonus:     z.number().min(0).max(50),
    }),
    default: {
      distancePerKm:    -10,
      acceptanceRate:    20,
      completionRate:    15,
      highRatingBonus:   10,
      lowRatingPenalty: -15,
      idleBonus30min:    10,
      idleBonus60min:     5,
      headingBonus:       8,
    },
  },
} satisfies Record<`matching.${string}`, ConfigEntry<z.ZodTypeAny>>;
```

- [ ] **Step 3: Create empty pricing and routing stubs**

```typescript
// packages/shared/src/config/registries/pricing.ts
import { z } from 'zod';
import type { ConfigEntry } from '../types';

export const pricingConfig = {} satisfies Record<`pricing.${string}`, ConfigEntry<z.ZodTypeAny>>;
```

```typescript
// packages/shared/src/config/registries/routing.ts
import { z } from 'zod';
import type { ConfigEntry } from '../types';

export const routingConfig = {} satisfies Record<`routing.${string}`, ConfigEntry<z.ZodTypeAny>>;
```

- [ ] **Step 4: Create top-level registry**

```typescript
// packages/shared/src/config/registry.ts
import { matchingConfig } from './registries/matching';
import { pricingConfig }  from './registries/pricing';
import { routingConfig }  from './registries/routing';

export type { ConfigCategory, ConfigEntry } from './types';

export const configRegistry = {
  ...matchingConfig,
  ...pricingConfig,
  ...routingConfig,
};

export type ConfigKey = keyof typeof configRegistry;
```

- [ ] **Step 5: Export from `packages/shared/src/index.ts`**

Add at the end of `packages/shared/src/index.ts`:
```typescript
export * from './config/registry';
```

- [ ] **Step 6: Type-check the shared package**

```bash
pnpm --filter @surewaka/shared build
```

Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/
git add packages/shared/src/index.ts
git commit -m "feat(shared): add modular config registry with matching engine parameters"
```

---

### Task 4: Config client — `getConfig` with 5-min TTL cache

**Files:**
- Create: `packages/shared/src/__tests__/config-client.test.ts`
- Create: `packages/shared/src/config/client.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/shared/src/__tests__/config-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: { select: vi.fn() },
  systemConfig: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

// Import after mocks
const { getConfig, invalidateConfig, _resetConfigCache } = await import('../config/client');
const { db } = await import('@surewaka/db');

type SelectChain = {
  from: ReturnType<typeof vi.fn>;
};

function mockDbRow(value: unknown) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ key: 'test', value }]),
      }),
    }),
  } as unknown as SelectChain);
}

function mockDbEmpty() {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as unknown as SelectChain);
}

describe('getConfig', () => {
  beforeEach(() => {
    _resetConfigCache();
    vi.clearAllMocks();
  });

  it('returns registry default when no DB row exists', async () => {
    mockDbEmpty();
    const val = await getConfig('matching.first_mile_dispatch_buffer_min');
    expect(val).toBe(45);
  });

  it('returns parsed DB value when row exists', async () => {
    mockDbRow(60);
    const val = await getConfig('matching.first_mile_dispatch_buffer_min');
    expect(val).toBe(60);
  });

  it('returns default for scoring_weights when no DB row', async () => {
    mockDbEmpty();
    const val = await getConfig('matching.scoring_weights');
    expect(val).toEqual({
      distancePerKm: -10, acceptanceRate: 20, completionRate: 15,
      highRatingBonus: 10, lowRatingPenalty: -15, idleBonus30min: 10,
      idleBonus60min: 5, headingBonus: 8,
    });
  });

  it('caches the result — skips DB on second call within TTL', async () => {
    mockDbRow(5);
    await getConfig('matching.tier1_radius_km');
    await getConfig('matching.tier1_radius_km');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('re-fetches from DB after invalidateConfig clears cache entry', async () => {
    mockDbRow(5);
    await getConfig('matching.tier1_radius_km');
    invalidateConfig('matching.tier1_radius_km');
    mockDbRow(8);
    const val = await getConfig('matching.tier1_radius_km');
    expect(val).toBe(8);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('throws a ZodError when DB value fails schema validation', async () => {
    mockDbRow('not-a-number');
    await expect(getConfig('matching.tier1_radius_km')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @surewaka/shared test config-client
```

Expected: FAIL — `getConfig` does not exist yet.

- [ ] **Step 3: Implement the config client**

```typescript
// packages/shared/src/config/client.ts
import { eq } from 'drizzle-orm';
import { db, systemConfig } from '@surewaka/db';
import type { z } from 'zod';
import { configRegistry } from './registry';
import type { ConfigKey } from './registry';

const cache = new Map<string, { value: unknown; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getConfig<K extends ConfigKey>(
  key: K,
): Promise<z.infer<typeof configRegistry[K]['schema']>> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as z.infer<typeof configRegistry[K]['schema']>;
  }

  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  const entry = configRegistry[key];
  const value = row ? entry.schema.parse(row.value) : entry.default;
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value as z.infer<typeof configRegistry[K]['schema']>;
}

export function invalidateConfig(key: string): void {
  cache.delete(key);
}

// Exposed for tests only — clears the entire cache
export function _resetConfigCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @surewaka/shared test config-client
```

Expected: All 6 tests pass.

- [ ] **Step 5: Export from shared index**

Add to `packages/shared/src/index.ts`:
```typescript
export { getConfig, invalidateConfig } from './config/client';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/client.ts \
  packages/shared/src/__tests__/config-client.test.ts \
  packages/shared/src/index.ts
git commit -m "feat(shared): add getConfig client with 5-min TTL cache"
```

---

### Task 5: API routes — CRUD + export + import

**Files:**
- Create: `apps/api/src/routes/admin/system-config.ts`
- Create: `apps/api/src/__tests__/system-config-routes.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/__tests__/system-config-routes.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { stubAuthModule, personas } from '../test-utils/auth-mock';

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            key: 'matching.tier1_radius_km',
            value: 7,
            updatedBy: 'user-id',
            updatedAt: new Date('2026-07-27T10:00:00Z'),
          }]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{}]),
          }),
        }),
      }),
    })),
  },
  systemConfig: {},
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('@surewaka/shared', async () => {
  const actual = await vi.importActual<typeof import('@surewaka/shared')>('@surewaka/shared');
  return { ...actual, invalidateConfig: vi.fn() };
});
vi.mock('../middleware/auth', () => stubAuthModule(personas.admin()));
vi.mock('../middleware/role', () => ({
  requireRole: () => vi.fn(async (_c: Context, next: () => Promise<void>) => next()),
}));

async function createTestApp() {
  const { default: systemConfigRoutes } = await import('../routes/admin/system-config');
  const app = new Hono();
  app.route('/api/v1/admin/config', systemConfigRoutes);
  return app;
}

describe('GET /api/v1/admin/config', () => {
  it('returns all registry keys with defaults for unseeded rows', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ key: string; value: unknown }> };
    expect(body.data.length).toBeGreaterThan(0);
    const bufferItem = body.data.find((d) => d.key === 'matching.first_mile_dispatch_buffer_min');
    expect(bufferItem?.value).toBe(45);
  });
});

describe('GET /api/v1/admin/config/export', () => {
  it('returns flat JSON with all config keys', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/export', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as Record<string, unknown>;
    expect(body['matching.first_mile_dispatch_buffer_min']).toBe(45);
    expect(body['matching.tier1_radius_km']).toBe(5);
  });
});

describe('GET /api/v1/admin/config/:key', () => {
  it('returns 400 for an unknown config key', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/does.not.exist', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNKNOWN_CONFIG_KEY');
  });

  it('returns registry default when no DB row exists', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { key: string; value: unknown } };
    expect(body.data.key).toBe('matching.tier1_radius_km');
    expect(body.data.value).toBe(5);
  });
});

describe('PUT /api/v1/admin/config/:key', () => {
  it('returns 400 for an unknown config key', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/unknown.key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNKNOWN_CONFIG_KEY');
  });

  it('returns 400 when value fails schema validation', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ value: 999 }), // max is 20
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('upserts and returns updated value on valid input', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ value: 7 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { key: string; value: unknown } };
    expect(body.data.value).toBe(7);
  });
});

describe('POST /api/v1/admin/config/:key/reset', () => {
  it('returns 400 for unknown key', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/unknown.key/reset', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(400);
  });

  it('returns registry default after reset', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/matching.tier1_radius_km/reset', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { value: unknown } };
    expect(body.data.value).toBe(5);
  });
});

describe('POST /api/v1/admin/config/import', () => {
  it('returns 400 when a registered key has invalid value — no partial writes', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ 'matching.tier1_radius_km': 999 }), // exceeds max
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveLength(1);
  });

  it('skips unknown keys and imports valid ones', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/v1/admin/config/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({
        'matching.tier1_radius_km': 6,
        'some.unknown.key': 'ignored',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { imported: number; skipped: number } };
    expect(body.data.imported).toBe(1);
    expect(body.data.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @surewaka/api test system-config-routes
```

Expected: FAIL — route does not exist yet.

- [ ] **Step 3: Implement the API route**

```typescript
// apps/api/src/routes/admin/system-config.ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { db, systemConfig } from '@surewaka/db';
import { configRegistry, invalidateConfig } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const systemConfigRoutes = new Hono<Env>();
systemConfigRoutes.use('*', requireAuth);

async function buildConfigList() {
  const rows = await db.select().from(systemConfig);
  const rowMap = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(configRegistry).map(([key, entry]) => {
    const row = rowMap.get(key);
    const value = row ? entry.schema.parse(row.value) : entry.default;
    return {
      key,
      value,
      label: entry.label,
      description: entry.description ?? null,
      category: entry.category,
      default: entry.default,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}

// NOTE: /export and /import must be registered BEFORE /:key and /:key/reset
// to prevent Hono matching the literal strings as the :key param.

systemConfigRoutes.get('/', requireRole('surewaka_admin'), async (c) => {
  const list = await buildConfigList();
  return c.json({ data: list, error: null, meta: null });
});

systemConfigRoutes.get('/export', requireRole('surewaka_admin'), async (c) => {
  const list = await buildConfigList();
  const flat = Object.fromEntries(list.map((item) => [item.key, item.value]));
  c.header('Content-Disposition', 'attachment; filename="surewaka-config.json"');
  c.header('Content-Type', 'application/json');
  return c.body(JSON.stringify(flat, null, 2));
});

systemConfigRoutes.post('/import', requireRole('surewaka_superadmin'), async (c) => {
  const body = await c.req.json();
  if (typeof body !== 'object' || Array.isArray(body) || body === null) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Body must be a flat JSON object' }, meta: null },
      400,
    );
  }
  const errors: Array<{ key: string; message: string }> = [];
  const valid: Array<{ key: string; value: unknown }> = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(body)) {
    const entry = configRegistry[key as keyof typeof configRegistry];
    if (!entry) { skipped++; continue; }
    const parsed = entry.schema.safeParse(value);
    if (!parsed.success) {
      errors.push({ key, message: parsed.error.message });
    } else {
      valid.push({ key, value: parsed.data });
    }
  }
  if (errors.length > 0) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Import validation failed', details: errors }, meta: null },
      400,
    );
  }
  const user = c.get('user');
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const { key, value } of valid) {
      await tx
        .insert(systemConfig)
        .values({ key, value, updatedBy: user.id, updatedAt: now })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: { value, updatedBy: user.id, updatedAt: now },
        });
      invalidateConfig(key);
    }
  });
  return c.json({ data: { imported: valid.length, skipped }, error: null, meta: null });
});

systemConfigRoutes.get('/:key', requireRole('surewaka_admin'), async (c) => {
  const key = c.req.param('key');
  const entry = configRegistry[key as keyof typeof configRegistry];
  if (!entry) {
    return c.json(
      { data: null, error: { code: 'UNKNOWN_CONFIG_KEY', message: `Unknown config key: ${key}` }, meta: null },
      400,
    );
  }
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  const value = row ? entry.schema.parse(row.value) : entry.default;
  return c.json({
    data: {
      key,
      value,
      label: entry.label,
      description: entry.description ?? null,
      category: entry.category,
      default: entry.default,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    },
    error: null,
    meta: null,
  });
});

systemConfigRoutes.put('/:key', requireRole('surewaka_superadmin'), async (c) => {
  const key = c.req.param('key');
  const entry = configRegistry[key as keyof typeof configRegistry];
  if (!entry) {
    return c.json(
      { data: null, error: { code: 'UNKNOWN_CONFIG_KEY', message: `Unknown config key: ${key}` }, meta: null },
      400,
    );
  }
  const body = await c.req.json();
  const parsed = entry.schema.safeParse(body.value);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }
  const user = c.get('user');
  const now = new Date();
  const [updated] = await db
    .insert(systemConfig)
    .values({ key, value: parsed.data, updatedBy: user.id, updatedAt: now })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: parsed.data, updatedBy: user.id, updatedAt: now },
    })
    .returning();
  invalidateConfig(key);
  return c.json({
    data: { key, value: parsed.data, updatedAt: updated.updatedAt.toISOString() },
    error: null,
    meta: null,
  });
});

systemConfigRoutes.post('/:key/reset', requireRole('surewaka_superadmin'), async (c) => {
  const key = c.req.param('key');
  const entry = configRegistry[key as keyof typeof configRegistry];
  if (!entry) {
    return c.json(
      { data: null, error: { code: 'UNKNOWN_CONFIG_KEY', message: `Unknown config key: ${key}` }, meta: null },
      400,
    );
  }
  await db.delete(systemConfig).where(eq(systemConfig.key, key));
  invalidateConfig(key);
  return c.json({ data: { key, value: entry.default }, error: null, meta: null });
});

export default systemConfigRoutes;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @surewaka/api test system-config-routes
```

Expected: All tests pass.

- [ ] **Step 5: Mount route in API index**

In `apps/api/src/index.ts`, add after the existing admin imports:
```typescript
import adminSystemConfigRoutes from './routes/admin/system-config';
```

Add after the last `app.route(...)` for admin routes:
```typescript
app.route('/api/v1/admin/config', adminSystemConfigRoutes);
```

- [ ] **Step 6: Run the full API test suite**

```bash
pnpm --filter @surewaka/api test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/system-config.ts \
  apps/api/src/__tests__/system-config-routes.test.ts \
  apps/api/src/index.ts
git commit -m "feat(api): add system config CRUD, export, and import endpoints"
```

---

### Task 6: Admin hook — `useSystemConfig`

**Files:**
- Create: `apps/admin/app/hooks/use-system-config.ts`

- [ ] **Step 1: Create the hook**

```typescript
// apps/admin/app/hooks/use-system-config.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export type ConfigItem = {
  key: string;
  value: unknown;
  label: string;
  description: string | null;
  category: string;
  default: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
};

export function useSystemConfig() {
  const { getToken } = useAuth();
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) { setError('Not authenticated'); return; }
      const res = await fetch(`${API}/api/v1/admin/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      setItems(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  const saveConfig = useCallback(async (key: string, value: unknown): Promise<boolean> => {
    setSaving(key);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API}/api/v1/admin/config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      setItems((prev) =>
        prev.map((item) => item.key === key ? { ...item, value, updatedAt: json.data.updatedAt } : item),
      );
      setSaveSuccess(key);
      setTimeout(() => setSaveSuccess(null), 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      return false;
    } finally {
      setSaving(null);
    }
  }, [getToken]);

  const resetConfig = useCallback(async (key: string): Promise<boolean> => {
    setSaving(key);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API}/api/v1/admin/config/${encodeURIComponent(key)}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
      setItems((prev) =>
        prev.map((item) =>
          item.key === key ? { ...item, value: json.data.value, updatedAt: null, updatedBy: null } : item,
        ),
      );
      setSaveSuccess(key);
      setTimeout(() => setSaveSuccess(null), 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset');
      return false;
    } finally {
      setSaving(null);
    }
  }, [getToken]);

  const exportConfig = useCallback(async (): Promise<void> => {
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`${API}/api/v1/admin/config/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'surewaka-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [getToken]);

  const importConfig = useCallback(async (
    file: File,
  ): Promise<{ imported: number; skipped: number } | null> => {
    const token = await getToken();
    if (!token) return null;
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const res = await fetch(`${API}/api/v1/admin/config/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(parsed),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? `Import failed (${res.status})`);
    await fetchAll();
    return json.data as { imported: number; skipped: number };
  }, [getToken, fetchAll]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    items,
    isLoading,
    error,
    saving,
    saveSuccess,
    saveConfig,
    resetConfig,
    exportConfig,
    importConfig,
    refetch: fetchAll,
  };
}
```

- [ ] **Step 2: Type-check admin app**

```bash
pnpm --filter @surewaka/admin build --dry-run 2>/dev/null || pnpm --filter @surewaka/admin typecheck
```

Expected: No TypeScript errors in the hook.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/hooks/use-system-config.ts
git commit -m "feat(admin): add useSystemConfig hook for config CRUD, export, import"
```

---

### Task 7: `<ConfigField>` schema-driven renderer

**Files:**
- Create: `apps/admin/app/components/config-field.tsx`

- [ ] **Step 1: Create the renderer**

```tsx
// apps/admin/app/components/config-field.tsx
import { useState, useEffect } from 'react';
import { z } from 'zod';
import { Lock, Loader2, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

type ConfigFieldProps = {
  configKey: string;
  label: string;
  description?: string | null;
  schema: z.ZodTypeAny;
  value: unknown;
  updatedAt: string | null;
  isSaving: boolean;
  justSaved: boolean;
  canWrite: boolean;
  onSave: (key: string, value: unknown) => Promise<boolean>;
  onReset: (key: string) => Promise<boolean>;
};

function getTypeName(schema: z.ZodTypeAny): string {
  return schema._def.typeName as string;
}

function extractNumberConstraints(schema: z.ZodNumber): { min?: number; max?: number } {
  type Check = { kind: string; value?: number };
  const checks = schema._def.checks as Check[];
  return {
    min: checks.find((c) => c.kind === 'min')?.value,
    max: checks.find((c) => c.kind === 'max')?.value,
  };
}

export function ConfigField({
  configKey,
  label,
  description,
  schema,
  value,
  updatedAt,
  isSaving,
  justSaved,
  canWrite,
  onSave,
  onReset,
}: ConfigFieldProps) {
  const [localValue, setLocalValue] = useState<unknown>(value);
  const typeName = getTypeName(schema);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleSave = () => onSave(configKey, localValue);

  const renderControl = () => {
    if (typeName === 'ZodNumber') {
      const { min, max } = extractNumberConstraints(schema as z.ZodNumber);
      return (
        <Input
          type="number"
          min={min}
          max={max}
          value={String(localValue ?? '')}
          disabled={!canWrite || isSaving}
          onChange={(e) => setLocalValue(Number(e.target.value))}
          className="w-32 tabular-nums"
          aria-label={label}
        />
      );
    }
    if (typeName === 'ZodBoolean') {
      return (
        <Switch
          checked={Boolean(localValue)}
          disabled={!canWrite || isSaving}
          onCheckedChange={(checked) => setLocalValue(checked)}
          aria-label={label}
        />
      );
    }
    if (typeName === 'ZodEnum') {
      const options = (schema as z.ZodEnum<[string, ...string[]]>)._def.values as string[];
      return (
        <Select
          value={String(localValue)}
          disabled={!canWrite || isSaving}
          onValueChange={(val) => setLocalValue(val)}
        >
          <SelectTrigger className="w-40" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (typeName === 'ZodString') {
      return (
        <Input
          type="text"
          value={String(localValue ?? '')}
          disabled={!canWrite || isSaving}
          onChange={(e) => setLocalValue(e.target.value)}
          className="w-48"
          aria-label={label}
        />
      );
    }
    if (typeName === 'ZodObject') {
      const shape = (schema as z.ZodObject<z.ZodRawShape>)._def.shape() as Record<string, z.ZodTypeAny>;
      const objValue = (localValue as Record<string, unknown>) ?? {};
      return (
        <div className="space-y-3 pl-4 border-l border-border">
          {Object.entries(shape).map(([subKey, subSchema]) => {
            const constraints =
              getTypeName(subSchema) === 'ZodNumber'
                ? extractNumberConstraints(subSchema as z.ZodNumber)
                : {};
            return (
              <div key={subKey} className="flex items-center gap-3">
                <Label className="w-44 shrink-0 text-xs text-muted-foreground font-mono">
                  {subKey}
                </Label>
                <Input
                  type="number"
                  min={constraints.min}
                  max={constraints.max}
                  value={String(objValue[subKey] ?? '')}
                  disabled={!canWrite || isSaving}
                  onChange={(e) =>
                    setLocalValue({ ...objValue, [subKey]: Number(e.target.value) })
                  }
                  className="w-24 tabular-nums"
                  aria-label={subKey}
                />
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <span className="text-xs text-muted-foreground">Unsupported type: {typeName}</span>
    );
  };

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
        <div className="mt-3">{renderControl()}</div>
        {updatedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Updated {new Date(updatedAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        {justSaved && (
          <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
        )}
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
        {canWrite ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReset(configKey)}
              disabled={isSaving}
              aria-label={`Reset ${label} to default`}
            >
              <RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              Save
            </Button>
          </>
        ) : (
          <span title="Requires superadmin to edit">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/components/config-field.tsx
git commit -m "feat(admin): add ConfigField schema-driven form renderer"
```

---

### Task 8: Admin settings page + routing

**Files:**
- Create: `apps/admin/app/routes/settings/system-config.tsx`
- Modify: `apps/admin/app/routes/settings.tsx`
- Modify: `apps/admin/app/routes.ts`

- [ ] **Step 1: Create the settings page**

```tsx
// apps/admin/app/routes/settings/system-config.tsx
import { useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { Download, Upload, SlidersHorizontal } from 'lucide-react';
import { z } from 'zod';
import { configRegistry } from '@surewaka/shared';
import type { ConfigKey } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { ConfigField } from '~/components/config-field';
import { useSystemConfig } from '~/hooks/use-system-config';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'SureWaka Admin - System Config' }];

// Group registry keys by category
const grouped = Object.entries(configRegistry).reduce<
  Record<string, Array<{ key: string; entry: (typeof configRegistry)[ConfigKey] }>>
>((acc, [key, entry]) => {
  const cat = entry.category;
  if (!acc[cat]) acc[cat] = [];
  acc[cat].push({ key, entry: entry as (typeof configRegistry)[ConfigKey] });
  return acc;
}, {});

const CATEGORY_LABELS: Record<string, string> = {
  matching: 'Driver Matching Engine',
  routing:  'Routing & Path Optimization',
  pricing:  'Pricing & Fees',
};

export default function SystemConfig() {
  const { user } = useUser();
  const canWrite = ((user?.publicMetadata?.roles as string[]) ?? []).includes('surewaka_superadmin');

  const { items, isLoading, error, saving, saveSuccess, saveConfig, resetConfig, exportConfig, importConfig } =
    useSystemConfig();

  const importRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportStatus(null);
    try {
      const result = await importConfig(file);
      if (result) {
        setImportStatus(`Imported ${result.imported} keys, skipped ${result.skipped}`);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const itemMap = new Map(items.map((i) => [i.key, i]));

  return (
    <div className="pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Config</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational parameters — changes take effect within 5 minutes in workers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportConfig} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canWrite || isLoading}
            title={canWrite ? undefined : 'Requires superadmin'}
            onClick={() => importRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Import
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </div>

      {importStatus && (
        <p className="mt-3 text-sm text-green-600">{importStatus}</p>
      )}
      {importError && (
        <p className="mt-3 text-sm text-destructive">{importError}</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}

      <div className="mt-6 space-y-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))
        ) : (
          Object.entries(grouped).map(([category, keys]) => {
            if (keys.length === 0) return null;
            return (
              <section key={category} className="rounded-xl border border-border bg-card p-6">
                <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  {CATEGORY_LABELS[category] ?? category}
                </h2>
                <div className="mt-4 space-y-3">
                  {keys.map(({ key, entry }) => {
                    const item = itemMap.get(key);
                    return (
                      <ConfigField
                        key={key}
                        configKey={key}
                        label={entry.label}
                        description={entry.description}
                        schema={entry.schema as z.ZodTypeAny}
                        value={item?.value ?? entry.default}
                        updatedAt={item?.updatedAt ?? null}
                        isSaving={saving === key}
                        justSaved={saveSuccess === key}
                        canWrite={canWrite}
                        onSave={saveConfig}
                        onReset={resetConfig}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route to `routes.ts`**

In `apps/admin/app/routes.ts`, add inside the `layout(...)` array after the existing settings routes:
```typescript
route('settings/system-config', 'routes/settings/system-config.tsx'),
```

- [ ] **Step 3: Add card to settings hub**

In `apps/admin/app/routes/settings.tsx`, add `SlidersHorizontal` to the import:
```typescript
import { Banknote, Bell, SlidersHorizontal, User } from 'lucide-react';
```

Add to the `SETTINGS_CARDS` array:
```typescript
  {
    to: '/settings/system-config',
    icon: SlidersHorizontal,
    title: 'System Config',
    description: 'Matching engine, routing parameters, operational knobs',
  },
```

- [ ] **Step 4: Type-check admin build**

```bash
pnpm --filter @surewaka/admin build
```

Expected: No TypeScript errors, build completes.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/routes/settings/system-config.tsx \
  apps/admin/app/routes/settings.tsx \
  apps/admin/app/routes.ts
git commit -m "feat(admin): add system config settings page with schema-driven UI"
```

---

### Task 9: Update driver-matching kiro spec

**Files:**
- Modify: `.kiro/specs/driver-matching-routing/design.md`

The spec currently references `fee_settings.firstMileDispatchBufferMin` and a `getBufferMinutes()` helper in:
1. **Component 6 (Cron Sweeper)** — `getBufferMinutes()` call and surrounding comment
2. **ADR-010 Trigger Formula section** — description of the `buffer` variable

- [ ] **Step 1: Update Component 6 — replace `getBufferMinutes()` with `getConfig()`**

Find in `.kiro/specs/driver-matching-routing/design.md`:
```typescript
import { getBufferMinutes } from '../lib/fee-settings';
```
Replace with:
```typescript
import { getConfig } from '@surewaka/shared';
```

Find:
```typescript
const buffer = await getBufferMinutes(); // from fee_settings, default 45
```
Replace with:
```typescript
const buffer = await getConfig('matching.first_mile_dispatch_buffer_min');
```

Find and remove the line:
```
 * Read buffer from `fee_settings.firstMileDispatchBufferMin` (default: 45)
```
Replace with:
```
 * Read buffer from system_config via getConfig('matching.first_mile_dispatch_buffer_min') (default: 45)
```

- [ ] **Step 2: Update ADR-010 Trigger Formula section**

Find:
```
- `buffer` = configurable, default 45 min. Stored in `fee_settings` as `firstMileDispatchBufferMin`.
```
Replace with:
```
- `buffer` = configurable, default 45 min. Stored in `system_config` as `matching.first_mile_dispatch_buffer_min`. Read via `getConfig('matching.first_mile_dispatch_buffer_min')` from `@surewaka/shared`.
```

- [ ] **Step 3: Commit**

```bash
git add .kiro/specs/driver-matching-routing/design.md
git commit -m "docs(driver-matching): update spec to use system_config instead of fee_settings for dispatch buffer"
```

---

## Self-Review

**Spec coverage:**
- ✅ `surewaka_superadmin` role — Task 1
- ✅ `system_config` DB table — Task 2
- ✅ Modular config registry with `matching.*` keys — Task 3
- ✅ `getConfig` TTL cache client — Task 4
- ✅ All 6 API endpoints including export/import — Task 5
- ✅ Route registration order (export/import before /:key) — Task 5
- ✅ All-or-nothing import validation — Task 5
- ✅ Admin hook — Task 6
- ✅ Schema-driven `<ConfigField>` renderer (number, boolean, enum, string, object) — Task 7
- ✅ Admin settings page grouped by category — Task 8
- ✅ Export/import toolbar with superadmin gate — Task 8
- ✅ Driver-matching spec updated — Task 9
- ✅ Key naming convention (snake_case) — enforced by `satisfies Record<\`matching.${string}\`, ...>` in Task 3

**Type consistency check:**
- `ConfigItem` in hook matches API response shape
- `ConfigField` props accept `schema: z.ZodTypeAny` — matches registry entry `.schema` field
- `getConfig` return type inferred from `configRegistry[K]['schema']` — matches worker usage
- `invalidateConfig` imported from `@surewaka/shared` in both API route and client — same export
