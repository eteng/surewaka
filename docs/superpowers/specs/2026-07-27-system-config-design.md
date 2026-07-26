# System Config — Design Document

**Date:** 2026-07-27
**Status:** Approved, pending implementation

---

## Overview

A schema-driven, admin-tunable configuration store for operational parameters that need to change without code deploys. The immediate use case is the driver matching and routing engine (tiered broadcast radii, timeouts, scoring weights, dispatch buffer). The system is designed as a future migration target for `fee_settings` and other singleton settings tables.

Config values are stored as JSONB rows in a `system_config` table (one row per key). A code-side registry defines the Zod schema, label, description, category, and default for each key — making the registry the single source of truth for shape and defaults. Workers read config via a 5-minute TTL in-memory cache. The admin UI renders forms directly from the registry using a lightweight custom field renderer.

---

## Goals

- Ops can tune matching engine parameters without a deploy
- Adding a new config parameter requires only one change: a registry entry (no new UI code, no migration, no API change)
- Type safety end-to-end: registry Zod schema validates on write (API) and on read (worker cache miss)
- Export/import for environment promotion and backup
- Role-split: any admin can view, only superadmin can write

---

## Non-Goals

- Replacing `fee_settings` now — that is a future migration; `fee_settings` stays as-is
- Feature flags / boolean toggles for code paths (this is for numeric/structural operational params)
- Multi-environment config management (staging vs prod managed by export/import manually)
- Real-time push of config changes to workers (5-min TTL cache lag is acceptable)

---

## Role Model

A new role `surewaka_superadmin` is added to the `UserRole` union in `packages/shared/src/types.ts`. This becomes the standard role for high-impact admin operations.

| Operation | Required role |
|-----------|--------------|
| View config, export | `surewaka_admin` |
| Update, reset, import | `surewaka_superadmin` |

---

## Data Layer

### DB Table — `system_config`

File: `packages/db/src/schema/system-config.ts`

```typescript
export const systemConfig = pgTable('system_config', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- One row per config key. Primary key is the key string itself.
- No `description` column — that lives in the registry in code.
- `updatedBy` is nullable (null = default value, never explicitly set by a user).
- Table starts empty. Registry defaults are returned in-code for any missing row.

### Config Registry

File: `packages/shared/src/config/registry.ts`

```typescript
type ConfigEntry<T extends z.ZodTypeAny> = {
  label: string
  description?: string   // optional — omit for self-explanatory fields
  category: 'matching' | 'routing' | 'pricing'
  schema: T
  default: z.infer<T>
}

export const configRegistry = {
  'matching.first_mile_dispatch_buffer_min': {
    label: 'First-Mile Dispatch Buffer',
    description: 'Minutes before carrier departure to trigger driver matching (includes 5min matching + 10min driver-to-pickup + 30min Lagos traffic headroom)',
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
    label: 'Tier 1 Timeout (seconds)',
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
    label: 'Tier 2 Timeout (seconds)',
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
    label: 'Tier 3 Timeout (seconds)',
    category: 'matching',
    schema: z.number().int().min(30).max(600),
    default: 180,
  },
  'matching.total_timeout_sec': {
    label: 'Total Match Timeout (seconds)',
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
} satisfies Record<string, ConfigEntry<z.ZodTypeAny>>

export type ConfigKey = keyof typeof configRegistry
```

---

## API Layer

File: `apps/api/src/routes/admin/system-config.ts`
Mounted at: `/api/v1/admin/config`

### Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/` | `surewaka_admin` | List all keys with current values + registry metadata |
| `GET` | `/:key` | `surewaka_admin` | Single key |
| `PUT` | `/:key` | `surewaka_superadmin` | Update one key; validates `body.value` against registry schema |
| `POST` | `/:key/reset` | `surewaka_superadmin` | Reset to registry default |
| `GET` | `/export` | `surewaka_admin` | Download flat JSON of all current values |
| `POST` | `/import` | `surewaka_superadmin` | Bulk upsert from flat JSON |

### Response Shape

All list/single-key responses return:
```typescript
{
  data: {
    key: string
    value: unknown          // Zod-validated on read
    label: string
    description: string
    category: string
    default: unknown
    updatedBy: string | null
    updatedAt: string | null
  }[]   // array for GET /, single object for GET /:key
  error: null
  meta: null
}
```

### Route Registration Order

`GET /export` and `POST /import` must be registered **before** `GET /:key` and `POST /:key/reset` in Hono, otherwise Hono will match the literal strings `"export"` and `"import"` as the `:key` param.

### Validation Rules

- `PUT /:key`: if `key` not in registry → 400 `UNKNOWN_CONFIG_KEY`. Value validated against `registry[key].schema` → 400 `VALIDATION_ERROR` on failure.
- `GET /` / `GET /:key`: missing DB rows return registry default as the live value (no row required, no seed data).
- After a successful `PUT` or `POST /:key/reset`, the API calls `invalidateConfig(key)` so the worker cache is busted immediately.

### Import Rules

- Body: `{ [key: string]: unknown }` flat JSON object
- Unknown keys (not in registry) are silently skipped
- Validation errors collected for all keys before rejecting — returns all issues at once
- If any registered key fails schema validation, the whole import is rejected (no partial write)
- All valid rows upserted in a single DB transaction
- Response: `{ data: { imported: number, skipped: number }, error: null, meta: null }`

### Export Format

```json
{
  "matching.first_mile_dispatch_buffer_min": 45,
  "matching.tier1_radius_km": 5,
  "matching.scoring_weights": { "distancePerKm": -10, "acceptanceRate": 20 }
}
```

---

## Worker Integration

File: `packages/shared/src/config/client.ts`

```typescript
const cache = new Map<string, { value: unknown; expiresAt: number }>()
const TTL_MS = 5 * 60 * 1000

export async function getConfig<K extends ConfigKey>(key: K): Promise<z.infer<typeof configRegistry[K]['schema']>> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value as any

  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1)
  const value = row
    ? configRegistry[key].schema.parse(row.value)
    : configRegistry[key].default
  cache.set(key, { value, expiresAt: now + TTL_MS })
  return value
}

export function invalidateConfig(key: string) {
  cache.delete(key)
}
```

**Properties:**
- Fully typed — return type is inferred from the registry schema for each key
- Falls back to registry default when no DB row exists
- Zod-parsed on every cache miss — corrupt DB values surface immediately
- `invalidateConfig` called by API after write — fresh value on next read without waiting for TTL
- Cache is process-local; multi-instance workers converge within 5 minutes

**Usage in cron sweeper** (replaces the planned `fee_settings` read per driver-matching spec):
```typescript
// Before (per spec Component 6):
const buffer = await getBufferMinutes()  // was reading from fee_settings

// After:
const buffer = await getConfig('matching.first_mile_dispatch_buffer_min')
const bufferMs = buffer * 60 * 1000
```

**Usage in matching worker:**
```typescript
const weights   = await getConfig('matching.scoring_weights')
const tier1Km   = await getConfig('matching.tier1_radius_km')
const tier1Max  = await getConfig('matching.tier1_batch_size')
const tier1Wait = await getConfig('matching.tier1_timeout_sec')
// etc.
```

---

## Admin UI

### Files

```
apps/admin/app/routes/settings/system-config.tsx   ← settings page
apps/admin/app/components/config-field.tsx          ← schema-driven field renderer
apps/admin/app/hooks/use-system-config.ts           ← data hook (fetch + mutations)
```

### Settings Hub

`settings.tsx` gains a new card:
```typescript
{
  to: '/settings/system-config',
  icon: SlidersHorizontal,
  title: 'System Config',
  description: 'Matching engine, routing parameters, operational knobs',
}
```

### Page Layout

- Config keys grouped by `category` — each group renders as a card with a header
- Toolbar (top-right): **Export** button + **Import** button; both visible to all admins; Import disabled + lock icon for non-superadmin
- Each field has an inline **Save** button (superadmin only; disabled with lock icon otherwise)
- **Reset to default** link per field (superadmin only)
- Last updated metadata per field: `"Updated 2h ago by eteng"`

### `<ConfigField>` Renderer

Maps Zod type tag to shadcn/ui control:

| Zod type | Control | Notes |
|----------|---------|-------|
| `z.number()` | `<Input type="number">` | `min`/`max`/`step` extracted from schema checks |
| `z.boolean()` | `<Switch>` | |
| `z.enum()` | `<Select>` | Options from schema values |
| `z.string()` | `<Input type="text">` | |
| `z.object()` (1 level) | Indented sub-field group | One Save for the whole object |

### Import Flow

1. File picker → user selects `.json`
2. Client parses JSON, fetches current values, renders diff table: key / current value / incoming value
3. Confirm → `POST /import`
4. Success toast: `"Imported 11 keys, skipped 0"`

---

## Driver-Matching Spec Update

The driver-matching-routing kiro spec (`design.md`) references `fee_settings.firstMileDispatchBufferMin` and a `getBufferMinutes()` helper reading from `fee_settings` in Component 6 (Cron Sweeper) and the ADR-010 trigger formula section.

As part of this implementation, the spec must be updated to reflect that:
- `firstMileDispatchBufferMin` is **not** added to `fee_settings`
- It is read from `system_config` via `getConfig('matching.first_mile_dispatch_buffer_min')`
- All other tier/scoring parameters also come from `system_config`

---

## Migration Path for `fee_settings`

`fee_settings` is not migrated in this spec. When the time comes:
1. Add each `fee_settings` field to `configRegistry` under category `'pricing'`
2. Migrate existing `fee_settings` row to `system_config` rows via a one-time script
3. Update fee engine and API to use `getConfig(...)` instead of `db.select().from(feeSettings)`
4. Drop the `fee_settings` table

The admin `fee-settings.tsx` page would then be superseded by the `system-config.tsx` page (pricing category).

---

## Implementation Order

1. Add `surewaka_superadmin` to `UserRole` in `packages/shared/src/types.ts`
2. DB schema: `system-config.ts` → generate + apply migration
3. Config registry: `packages/shared/src/config/registry.ts`
4. Config client: `packages/shared/src/config/client.ts`
5. API routes: `apps/api/src/routes/admin/system-config.ts` + mount in `index.ts`
6. Admin UI: hook → renderer component → settings page
7. Update driver-matching spec: replace `fee_settings` references with `getConfig(...)` calls
