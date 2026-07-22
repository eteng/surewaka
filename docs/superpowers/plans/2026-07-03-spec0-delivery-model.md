# Spec 0: Delivery Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the multi-leg delivery schema foundation that all three ops intelligence specs depend on — new DB tables, shared types/validators/constants, a zone classifier, a driver location endpoint, ETA calculation at booking, and rich seed data for admin visual inspection.

**Architecture:** Five new DB tables (`delivery_legs`, `delivery_events`, `driver_locations`, `delivery_ratings`, `carrier_sla_overrides`) are created in a single migration with full RLS. A DB trigger auto-writes `delivery_events` on every leg status change. The shared package gains new types, validators, and constants. A zone classifier in the API server-side reverse-geocodes Lagos coordinates using LocationIQ into canonical zone labels stored on legs at creation. Seed data populates realistic multi-leg deliveries across Lagos zones for admin visual inspection.

**Tech Stack:** NeonDB migrations, Drizzle ORM (schema generated — never hand-edited), Zod v3, Hono, TypeScript strict, LocationIQ reverse-geocode API, `pnpm --filter` workspace commands

## Global Constraints

- Never manually edit `packages/db/src/schema.ts` — run `pnpm --filter @surewaka/db db:generate + db:migrate` after every migration
- Every migration that creates a table must include RLS enable + service_role bypass + authenticated grants in the same file
- Reference RLS pattern: `drizzle/migrations/20260603045850_fix_rls_and_grants_all_tables.sql`
- Never use `drizzle-kit push/generate/migrate`
- All cross-package types via `@surewaka/shared`
- TypeScript: strict mode, `type` over `interface`, `unknown` not `any`
- Never read `.env` files — reference `.env.example` only
- Prettier: single quotes, semicolons, trailing commas, 100 char width
- API response shape: `{ data, error, meta }`

---

### Task 1: DB Migration — all new tables + triggers + RLS

**Files:**
- Create: `drizzle/migrations/20260703000001_delivery_model_redesign.sql`

**Interfaces:**
- Produces: `delivery_legs`, `delivery_events`, `driver_locations`, `delivery_ratings`, `carrier_sla_overrides` tables; `log_leg_status_change()` trigger function

- [ ] **Step 1: Create the migration file**

```bash
pnpm db:generate new delivery_model_redesign
```

Rename the generated file to match `20260703000001_delivery_model_redesign.sql`.

- [ ] **Step 2: Write the migration SQL**

Paste the entire content below into the migration file:

```sql
-- ─── delivery_legs ────────────────────────────────────────────────────────────
CREATE TABLE delivery_legs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_number      smallint NOT NULL CHECK (leg_number BETWEEN 1 AND 10),
  leg_type        text NOT NULL CHECK (leg_type IN ('first_mile', 'intercity', 'last_mile')),
  actor_type      text NOT NULL CHECK (actor_type IN ('driver', 'carrier')),
  actor_id        uuid NOT NULL,
  pickup_address  text NOT NULL,
  pickup_lat      real NOT NULL,
  pickup_lng      real NOT NULL,
  pickup_zone     text,
  dropoff_address text NOT NULL,
  dropoff_lat     real NOT NULL,
  dropoff_lng     real NOT NULL,
  dropoff_zone    text,
  status          delivery_status NOT NULL DEFAULT 'pending',
  system_eta_at   timestamptz,
  driver_eta_at   timestamptz,
  sla_hours       real,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, leg_number)
);

CREATE INDEX idx_delivery_legs_delivery_id ON delivery_legs(delivery_id);
CREATE INDEX idx_delivery_legs_actor_id    ON delivery_legs(actor_id);
CREATE INDEX idx_delivery_legs_status      ON delivery_legs(status) WHERE status NOT IN ('delivered', 'cancelled', 'failed', 'returned');

-- ─── delivery_events ──────────────────────────────────────────────────────────
CREATE TABLE delivery_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  leg_id        uuid REFERENCES delivery_legs(id) ON DELETE SET NULL,
  from_status   delivery_status,
  to_status     delivery_status NOT NULL,
  triggered_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  failure_cause text CHECK (failure_cause IN ('driver', 'carrier', 'route_traffic', 'system')),
  failure_note  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_events_delivery_id ON delivery_events(delivery_id);
CREATE INDEX idx_delivery_events_leg_id      ON delivery_events(leg_id);
CREATE INDEX idx_delivery_events_created_at  ON delivery_events(created_at DESC);

-- ─── Trigger: auto-log leg status changes ────────────────────────────────────
CREATE OR REPLACE FUNCTION log_leg_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status)
    VALUES (NEW.delivery_id, NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leg_status_change
  AFTER UPDATE OF status ON delivery_legs
  FOR EACH ROW EXECUTE FUNCTION log_leg_status_change();

-- ─── driver_locations ─────────────────────────────────────────────────────────
CREATE TABLE driver_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  lat         real NOT NULL,
  lng         real NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_locations_driver_recent
  ON driver_locations(driver_id, recorded_at DESC);
CREATE INDEX idx_driver_locations_delivery_id
  ON driver_locations(delivery_id) WHERE delivery_id IS NOT NULL;

-- ─── delivery_ratings ─────────────────────────────────────────────────────────
CREATE TABLE delivery_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES drivers(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, customer_id)
);

CREATE INDEX idx_delivery_ratings_driver_id ON delivery_ratings(driver_id);

-- Trigger: keep drivers.rating aggregate in sync
CREATE OR REPLACE FUNCTION sync_driver_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE drivers
  SET rating = (
    SELECT ROUND(AVG(rating)::numeric, 2)
    FROM delivery_ratings
    WHERE driver_id = COALESCE(NEW.driver_id, OLD.driver_id)
  )
  WHERE id = COALESCE(NEW.driver_id, OLD.driver_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_driver_rating
  AFTER INSERT OR UPDATE OR DELETE ON delivery_ratings
  FOR EACH ROW EXECUTE FUNCTION sync_driver_rating();

-- ─── carrier_sla_overrides ────────────────────────────────────────────────────
CREATE TABLE carrier_sla_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id       uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  origin_zone      text NOT NULL,
  destination_zone text NOT NULL,
  sla_hours        real NOT NULL CHECK (sla_hours > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, origin_zone, destination_zone)
);

-- ─── ETA columns on deliveries ────────────────────────────────────────────────
ALTER TABLE deliveries
  ADD COLUMN system_eta_at timestamptz,
  ADD COLUMN driver_eta_at timestamptz;

-- ─── RLS: delivery_legs ───────────────────────────────────────────────────────
ALTER TABLE delivery_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_delivery_legs"
  ON delivery_legs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "customers_read_own_delivery_legs"
  ON delivery_legs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.id = delivery_legs.delivery_id
        AND d.customer_id = auth.uid()
    )
  );

GRANT SELECT ON delivery_legs TO authenticated;

-- ─── RLS: delivery_events ─────────────────────────────────────────────────────
ALTER TABLE delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_delivery_events"
  ON delivery_events FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "customers_read_own_delivery_events"
  ON delivery_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deliveries d
      WHERE d.id = delivery_events.delivery_id
        AND d.customer_id = auth.uid()
    )
  );

GRANT SELECT ON delivery_events TO authenticated;

-- ─── RLS: driver_locations ────────────────────────────────────────────────────
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_driver_locations"
  ON driver_locations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "drivers_insert_own_location"
  ON driver_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drivers dr
      WHERE dr.id = driver_locations.driver_id
        AND dr.user_id = auth.uid()
    )
  );

GRANT INSERT ON driver_locations TO authenticated;

-- ─── RLS: delivery_ratings ────────────────────────────────────────────────────
ALTER TABLE delivery_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_delivery_ratings"
  ON delivery_ratings FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "customers_insert_own_rating"
  ON delivery_ratings FOR INSERT
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "customers_read_own_ratings"
  ON delivery_ratings FOR SELECT
  USING (customer_id = auth.uid());

GRANT SELECT, INSERT ON delivery_ratings TO authenticated;

-- ─── RLS: carrier_sla_overrides ───────────────────────────────────────────────
ALTER TABLE carrier_sla_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_carrier_sla_overrides"
  ON carrier_sla_overrides FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT ON carrier_sla_overrides TO authenticated;
```

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm --filter @surewaka/db db:push
```

Expected: migration applies without errors. If the `deliveries` table doesn't have `id` as uuid, check the existing schema first.

- [ ] **Step 4: Regenerate the Drizzle schema**

```bash
pnpm --filter @surewaka/db db:generate + db:migrate
```

Expected: `packages/db/src/schema.ts` updated with the five new tables. Never edit this file manually.

- [ ] **Step 5: Verify new tables exist**

```bash
pnpm --filter @surewaka/db db:generate (check diff) --schema public | grep -E "delivery_legs|delivery_events|driver_locations|delivery_ratings|carrier_sla_overrides"
```

Expected: no diff (all tables applied). If tables appear in diff, the migration didn't apply cleanly — re-run Step 3.

- [ ] **Step 6: Commit**

```bash
git add drizzle/migrations/20260703000001_delivery_model_redesign.sql packages/db/src/schema.ts
git commit -m "feat(db): add delivery_legs, delivery_events, driver_locations, delivery_ratings, carrier_sla_overrides"
```

---

### Task 2: Shared constants — Lagos zones, leg types, SLA defaults

**Files:**
- Modify: `packages/shared/src/constants.ts`

**Interfaces:**
- Produces: `LAGOS_ZONES`, `LEG_TYPES`, `LEG_ACTOR_TYPES`, `FAILURE_CAUSES`, `DEFAULT_SLA_HOURS`, `CUSTOMER_FACING_STATUSES`, `ETA_MINUTES_PER_KM`, `ETA_BUFFER_MINUTES` — all consumed by Tasks 3, 4, and the seed script

- [ ] **Step 1: Write tests for constants**

Create `packages/shared/src/__tests__/constants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  LAGOS_ZONES,
  DEFAULT_SLA_HOURS,
  CUSTOMER_FACING_STATUSES,
  ETA_MINUTES_PER_KM,
} from '../constants';

describe('delivery model constants', () => {
  it('LAGOS_ZONES contains the expected zones', () => {
    expect(LAGOS_ZONES).toContain('Lekki');
    expect(LAGOS_ZONES).toContain('Victoria Island');
    expect(LAGOS_ZONES).toContain('Ikeja');
    expect(LAGOS_ZONES).toContain('Other');
  });

  it('DEFAULT_SLA_HOURS covers all leg types', () => {
    expect(DEFAULT_SLA_HOURS.first_mile).toBe(1);
    expect(DEFAULT_SLA_HOURS.intercity).toBe(24);
    expect(DEFAULT_SLA_HOURS.last_mile).toBe(2);
  });

  it('CUSTOMER_FACING_STATUSES includes delivered but not en_route_pickup', () => {
    expect(CUSTOMER_FACING_STATUSES).toContain('delivered');
    expect(CUSTOMER_FACING_STATUSES).toContain('picked_up');
    expect(CUSTOMER_FACING_STATUSES).not.toContain('en_route_pickup');
    expect(CUSTOMER_FACING_STATUSES).not.toContain('draft');
  });

  it('ETA_MINUTES_PER_KM is defined for all vehicle types', () => {
    expect(ETA_MINUTES_PER_KM.motorcycle).toBeDefined();
    expect(ETA_MINUTES_PER_KM.car).toBeDefined();
    expect(ETA_MINUTES_PER_KM.van).toBeDefined();
    expect(ETA_MINUTES_PER_KM.truck).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/shared test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|constants"
```

Expected: FAIL — constants not yet exported.

- [ ] **Step 3: Add constants to `packages/shared/src/constants.ts`**

Append to the end of the existing file:

```typescript
// ─── Delivery Model ───────────────────────────────────────────────────────────

export const LAGOS_ZONES = [
  'Lekki',
  'Victoria Island',
  'Ikeja',
  'Surulere',
  'Mainland',
  'Island',
  'Other',
] as const;

export const LEG_TYPES = ['first_mile', 'intercity', 'last_mile'] as const;
export const LEG_ACTOR_TYPES = ['driver', 'carrier'] as const;
export const FAILURE_CAUSES = ['driver', 'carrier', 'route_traffic', 'system'] as const;

export const DEFAULT_SLA_HOURS: Record<string, number> = {
  first_mile: 1,
  intercity: 24,
  last_mile: 2,
};

// Statuses that trigger a customer-facing notification
export const CUSTOMER_FACING_STATUSES = [
  'accepted',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
] as const;

// ETA calculation: minutes per km by vehicle type (server-side use only)
export const ETA_MINUTES_PER_KM: Record<string, number> = {
  motorcycle: 3,
  car: 4,
  van: 5,
  truck: 6,
};
export const ETA_BUFFER_MINUTES = 15;

// Alert engine thresholds (minutes) — all configurable in /settings/alerts
export const ALERT_DRIVER_SILENT_WARNING_MIN = 15;
export const ALERT_DRIVER_SILENT_CRITICAL_MIN = 30;
export const ALERT_LEG_OVERDUE_WARNING_MIN = 30;
export const ALERT_LEG_OVERDUE_CRITICAL_MIN = 60;
export const ALERT_CUSTOMER_UPDATE_GAP_WARNING_MIN = 45;
export const ALERT_CUSTOMER_UPDATE_GAP_CRITICAL_MIN = 90;
export const ALERT_ONTIME_RATE_WARNING_PCT = 80;
export const ALERT_ONTIME_RATE_CRITICAL_PCT = 60;
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/shared test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|constants"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/__tests__/constants.test.ts
git commit -m "feat(shared): add delivery model constants — zones, leg types, SLA defaults, alert thresholds"
```

---

### Task 3: Shared types — DeliveryLeg, DeliveryEvent, DriverLocation, DeliveryRating, CarrierSlaOverride

**Files:**
- Modify: `packages/shared/src/types.ts`

**Interfaces:**
- Consumes: `LAGOS_ZONES`, `LEG_TYPES`, `LEG_ACTOR_TYPES`, `FAILURE_CAUSES` from Task 2
- Produces: `LagosZone`, `LegType`, `LegActorType`, `FailureCause`, `DeliveryLeg`, `DeliveryEvent`, `DriverLocation`, `DeliveryRating`, `CarrierSlaOverride` — consumed by Tasks 4 and 5

- [ ] **Step 1: Append types to `packages/shared/src/types.ts`**

```typescript
import type { LAGOS_ZONES, LEG_TYPES, LEG_ACTOR_TYPES, FAILURE_CAUSES } from './constants';
import type { DeliveryStatus } from './validators';

export type LagosZone = (typeof LAGOS_ZONES)[number];
export type LegType = (typeof LEG_TYPES)[number];
export type LegActorType = (typeof LEG_ACTOR_TYPES)[number];
export type FailureCause = (typeof FAILURE_CAUSES)[number];

export type DeliveryLeg = {
  id: string;
  deliveryId: string;
  legNumber: number;
  legType: LegType;
  actorType: LegActorType;
  actorId: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  pickupZone: LagosZone | null;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffZone: LagosZone | null;
  status: DeliveryStatus;
  systemEtaAt: string | null;   // ISO 8601
  driverEtaAt: string | null;   // ISO 8601
  slaHours: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type DeliveryEvent = {
  id: string;
  deliveryId: string;
  legId: string | null;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
  triggeredBy: string | null;   // user id or null for system
  failureCause: FailureCause | null;
  failureNote: string | null;
  createdAt: string;
};

export type DriverLocation = {
  id: string;
  driverId: string;
  deliveryId: string | null;
  lat: number;
  lng: number;
  recordedAt: string;
};

export type DeliveryRating = {
  id: string;
  deliveryId: string;
  driverId: string | null;
  customerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export type CarrierSlaOverride = {
  id: string;
  carrierId: string;
  originZone: LagosZone;
  destinationZone: LagosZone;
  slaHours: number;
};
```

Note: timestamps are `string` (ISO 8601) not `Date` — API serialises to JSON. Consumers parse if they need Date arithmetic.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @surewaka/shared build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add DeliveryLeg, DeliveryEvent, DriverLocation, DeliveryRating, CarrierSlaOverride types"
```

---

### Task 4: Shared validators — Zod schemas for all new model inputs

**Files:**
- Modify: `packages/shared/src/validators.ts`

**Interfaces:**
- Consumes: `LegType`, `LegActorType`, `FailureCause`, `LagosZone` from Task 3
- Produces: `createDeliveryLegSchema`, `updateDriverEtaSchema`, `recordDriverLocationSchema`, `submitDeliveryRatingSchema`, `overrideFailureCauseSchema`, `createCarrierSlaOverrideSchema`

- [ ] **Step 1: Write validator tests**

Create `packages/shared/src/__tests__/delivery-model-validators.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createDeliveryLegSchema,
  recordDriverLocationSchema,
  submitDeliveryRatingSchema,
  overrideFailureCauseSchema,
} from '../validators';

describe('createDeliveryLegSchema', () => {
  it('accepts a valid first_mile leg', () => {
    const result = createDeliveryLegSchema.safeParse({
      deliveryId: '00000000-0000-0000-0000-000000000001',
      legNumber: 1,
      legType: 'first_mile',
      actorType: 'driver',
      actorId: '00000000-0000-0000-0000-000000000002',
      pickupAddress: '12 Adeola Odeku, Victoria Island',
      pickupLat: 6.4281,
      pickupLng: 3.4219,
      dropoffAddress: 'Mile 2 Park, Amuwo-Odofin',
      dropoffLat: 6.4698,
      dropoffLng: 3.3113,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid legType', () => {
    const result = createDeliveryLegSchema.safeParse({
      deliveryId: '00000000-0000-0000-0000-000000000001',
      legNumber: 1,
      legType: 'overnight',
      actorType: 'driver',
      actorId: '00000000-0000-0000-0000-000000000002',
      pickupAddress: '12 Adeola Odeku',
      pickupLat: 6.4281,
      pickupLng: 3.4219,
      dropoffAddress: 'Mile 2 Park',
      dropoffLat: 6.4698,
      dropoffLng: 3.3113,
    });
    expect(result.success).toBe(false);
  });
});

describe('recordDriverLocationSchema', () => {
  it('accepts valid coords with optional deliveryId', () => {
    const result = recordDriverLocationSchema.safeParse({
      lat: 6.5244,
      lng: 3.3792,
      deliveryId: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('rejects lat out of range', () => {
    const result = recordDriverLocationSchema.safeParse({ lat: 200, lng: 3.3792 });
    expect(result.success).toBe(false);
  });
});

describe('submitDeliveryRatingSchema', () => {
  it('rejects rating 0 and 6', () => {
    expect(submitDeliveryRatingSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(submitDeliveryRatingSchema.safeParse({ rating: 6 }).success).toBe(false);
  });

  it('accepts rating 1–5 with optional comment', () => {
    expect(submitDeliveryRatingSchema.safeParse({ rating: 4, comment: 'Fast!' }).success).toBe(true);
  });
});

describe('overrideFailureCauseSchema', () => {
  it('rejects unknown failure cause', () => {
    const result = overrideFailureCauseSchema.safeParse({ failureCause: 'weather' });
    expect(result.success).toBe(false);
  });

  it('accepts valid cause with note', () => {
    const result = overrideFailureCauseSchema.safeParse({
      failureCause: 'route_traffic',
      failureNote: 'Third Mainland Bridge closure',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @surewaka/shared test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|validators"
```

Expected: FAIL — schemas not yet exported.

- [ ] **Step 3: Add Zod schemas to `packages/shared/src/validators.ts`**

Append to the existing file (after existing schemas):

```typescript
import { z } from 'zod';

// ─── Delivery Model Validators ────────────────────────────────────────────────

export const createDeliveryLegSchema = z.object({
  deliveryId: z.string().uuid(),
  legNumber: z.number().int().min(1).max(10),
  legType: z.enum(['first_mile', 'intercity', 'last_mile']),
  actorType: z.enum(['driver', 'carrier']),
  actorId: z.string().uuid(),
  pickupAddress: z.string().min(1).max(500),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  dropoffAddress: z.string().min(1).max(500),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  slaHours: z.number().positive().optional(),
});

export const updateDriverEtaSchema = z.object({
  driverEtaAt: z.string().datetime(),
});

export const recordDriverLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  deliveryId: z.string().uuid().optional(),
});

export const submitDeliveryRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export const overrideFailureCauseSchema = z.object({
  failureCause: z.enum(['driver', 'carrier', 'route_traffic', 'system']),
  failureNote: z.string().max(500).optional(),
});

export const createCarrierSlaOverrideSchema = z.object({
  carrierId: z.string().uuid(),
  originZone: z.enum([
    'Lekki', 'Victoria Island', 'Ikeja', 'Surulere', 'Mainland', 'Island', 'Other',
  ]),
  destinationZone: z.enum([
    'Lekki', 'Victoria Island', 'Ikeja', 'Surulere', 'Mainland', 'Island', 'Other',
  ]),
  slaHours: z.number().positive().max(720),
});
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/shared test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|validators"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators.ts packages/shared/src/__tests__/delivery-model-validators.test.ts
git commit -m "feat(shared): add Zod validators for delivery legs, driver location, ratings, failure override"
```

---

### Task 5: Zone classifier service

**Files:**
- Create: `apps/api/src/lib/zone-classifier.ts`
- Create: `apps/api/src/__tests__/zone-classifier.test.ts`

**Interfaces:**
- Produces: `classifyZone(lat: number, lng: number): Promise<LagosZone>` — called by the delivery creation route when persisting legs. Uses LocationIQ reverse-geocode with `LOCATIONIQ_API_KEY` env var (server-side key, not the Expo public one).

- [ ] **Step 1: Write the test**

```typescript
// apps/api/src/__tests__/zone-classifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { classifyZone } from '../lib/zone-classifier';

vi.stubGlobal('fetch', vi.fn());

describe('classifyZone', () => {
  it('returns Lekki for a Lekki address suburb', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { suburb: 'Lekki Phase 1', city: 'Lagos' },
      }),
    });
    const zone = await classifyZone(6.4457, 3.4711);
    expect(zone).toBe('Lekki');
  });

  it('returns Victoria Island for VI neighbourhood', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { neighbourhood: 'Victoria Island', city: 'Lagos' },
      }),
    });
    const zone = await classifyZone(6.4281, 3.4219);
    expect(zone).toBe('Victoria Island');
  });

  it('returns Other when no keyword matches', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { suburb: 'Badagry', city: 'Lagos' },
      }),
    });
    const zone = await classifyZone(6.4104, 2.8849);
    expect(zone).toBe('Other');
  });

  it('returns Other on fetch failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const zone = await classifyZone(6.5244, 3.3792);
    expect(zone).toBe('Other');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|zone-classifier"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the classifier**

```typescript
// apps/api/src/lib/zone-classifier.ts
import type { LagosZone } from '@surewaka/shared';

const LOCATIONIQ_BASE = 'https://api.locationiq.com/v1';

const ZONE_KEYWORDS: Array<{ zone: LagosZone; keywords: string[] }> = [
  { zone: 'Lekki', keywords: ['lekki', 'ajah', 'chevron', 'sangotedo', 'abraham adesanya', 'eleko'] },
  { zone: 'Victoria Island', keywords: ['victoria island', 'vi ', 'v.i', 'eko atlantic'] },
  { zone: 'Ikeja', keywords: ['ikeja', 'maryland', 'alausa', 'toyin', 'allen', 'oregun', 'agidingbi'] },
  { zone: 'Surulere', keywords: ['surulere', 'bode thomas', 'ojuelegba', 'itire', 'aguda', 'ijesha'] },
  { zone: 'Mainland', keywords: ['mainland', 'yaba', 'ebute metta', 'mushin', 'mile 12', 'ketu', 'ojota', 'ogudu'] },
  { zone: 'Island', keywords: ['island', 'ikoyi', 'oniru', 'banana island', 'lagos island', 'bar beach'] },
];

function matchZone(text: string): LagosZone {
  const lower = text.toLowerCase();
  for (const { zone, keywords } of ZONE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return zone;
  }
  return 'Other';
}

export async function classifyZone(lat: number, lng: number): Promise<LagosZone> {
  const apiKey = process.env.LOCATIONIQ_API_KEY;
  if (!apiKey) return 'Other';

  try {
    const params = new URLSearchParams({
      key: apiKey,
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      addressdetails: '1',
    });
    const res = await fetch(`${LOCATIONIQ_BASE}/reverse?${params}`);
    if (!res.ok) return 'Other';
    const data = await res.json() as { address?: Record<string, string> };
    const addressText = Object.values(data.address ?? {}).join(' ');
    return matchZone(addressText);
  } catch {
    return 'Other';
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|zone-classifier"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/zone-classifier.ts apps/api/src/__tests__/zone-classifier.test.ts
git commit -m "feat(api): add zone classifier — reverse-geocodes Lagos coords to canonical zone via LocationIQ"
```

---

### Task 6: Driver location API endpoint

**Files:**
- Create: `apps/api/src/routes/driver-locations.ts`
- Create: `apps/api/src/__tests__/driver-locations.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `recordDriverLocationSchema` from Task 4; `driver_locations` table from Task 1
- Produces: `POST /api/v1/driver/location` — mobile driver app calls this on every GPS ping. Returns `{ data: { id: string }, error: null, meta: null }`.

- [ ] **Step 1: Write the test**

```typescript
// apps/api/src/__tests__/driver-locations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@surewaka/db', () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'loc-1' }]) }) }) },
  driverLocations: {},
  drivers: {},
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (c: any, next: any) => {
    c.set('user', { id: 'user-1' });
    await next();
  }),
}));

// Import app after mocks
const { default: app } = await import('../index');

describe('POST /api/v1/driver/location', () => {
  it('returns 400 for invalid coordinates', async () => {
    const res = await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 999, lng: 3.3792 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with location id for valid ping', async () => {
    const res = await app.request('/api/v1/driver/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ lat: 6.5244, lng: 3.3792 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('loc-1');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|driver-locations"
```

Expected: FAIL.

- [ ] **Step 3: Write the route**

```typescript
// apps/api/src/routes/driver-locations.ts
import { Hono } from 'hono';
import { db, driverLocations, drivers } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { recordDriverLocationSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser } };

const driverLocationRoutes = new Hono<Env>();
driverLocationRoutes.use('*', requireAuth);

driverLocationRoutes.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json();
  const parsed = recordDriverLocationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  // Resolve driver record for this user
  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);

  if (!driver) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Driver profile not found' }, meta: null },
      404,
    );
  }

  const [location] = await db
    .insert(driverLocations)
    .values({
      driverId: driver.id,
      deliveryId: parsed.data.deliveryId ?? null,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    })
    .returning({ id: driverLocations.id });

  return c.json({ data: { id: location.id }, error: null, meta: null });
});

export default driverLocationRoutes;
```

- [ ] **Step 4: Register the route in `apps/api/src/index.ts`**

Find the section where existing routes are registered and add:

```typescript
import driverLocationRoutes from './routes/driver-locations';
// ...
app.route('/api/v1/driver/location', driverLocationRoutes);
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|driver-locations"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/driver-locations.ts apps/api/src/__tests__/driver-locations.test.ts apps/api/src/index.ts
git commit -m "feat(api): add POST /api/v1/driver/location — records GPS ping to driver_locations history table"
```

---

### Task 7: ETA calculation at delivery booking

**Files:**
- Create: `apps/api/src/lib/eta-calculator.ts`
- Create: `apps/api/src/__tests__/eta-calculator.test.ts`
- Modify: `apps/api/src/routes/deliveries.ts`

**Interfaces:**
- Consumes: `ETA_MINUTES_PER_KM`, `ETA_BUFFER_MINUTES` from Task 2; driver's `vehicleType` from `drivers` table
- Produces: `calculateSystemEta(pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleType): Date` — called during `POST /api/v1/deliveries`, result stored as `system_eta_at` on `deliveries`

- [ ] **Step 1: Write eta-calculator tests**

```typescript
// apps/api/src/__tests__/eta-calculator.test.ts
import { describe, it, expect } from 'vitest';
import { calculateSystemEta, haversineKm } from '../lib/eta-calculator';

describe('haversineKm', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineKm(6.5244, 3.3792, 6.5244, 3.3792)).toBeCloseTo(0, 2);
  });

  it('returns approximately 12km for Lekki to Island crossing', () => {
    // Lekki Phase 1 → Victoria Island (approx)
    const km = haversineKm(6.4457, 3.4711, 6.4281, 3.4219);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(20);
  });
});

describe('calculateSystemEta', () => {
  it('returns a Date in the future', () => {
    const eta = calculateSystemEta(6.5244, 3.3792, 6.4457, 3.4711, 'motorcycle');
    expect(eta.getTime()).toBeGreaterThan(Date.now());
  });

  it('truck ETA is always >= motorcycle ETA for same route', () => {
    const moto = calculateSystemEta(6.5244, 3.3792, 6.4457, 3.4711, 'motorcycle');
    const truck = calculateSystemEta(6.5244, 3.3792, 6.4457, 3.4711, 'truck');
    expect(truck.getTime()).toBeGreaterThanOrEqual(moto.getTime());
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|eta-calculator"
```

Expected: FAIL.

- [ ] **Step 3: Write the calculator**

```typescript
// apps/api/src/lib/eta-calculator.ts
import { ETA_MINUTES_PER_KM, ETA_BUFFER_MINUTES } from '@surewaka/shared';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateSystemEta(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  vehicleType: string,
): Date {
  const km = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const minsPerKm = ETA_MINUTES_PER_KM[vehicleType] ?? ETA_MINUTES_PER_KM['motorcycle'];
  const totalMinutes = Math.ceil(km * minsPerKm) + ETA_BUFFER_MINUTES;
  return new Date(Date.now() + totalMinutes * 60_000);
}
```

- [ ] **Step 4: Wire ETA into delivery creation in `apps/api/src/routes/deliveries.ts`**

Find the `deliveryRoutes.post('/', ...)` handler. After the driver query (or in the absence of an assigned driver, use motorcycle as default), add:

```typescript
import { calculateSystemEta } from '../lib/eta-calculator';

// Inside the POST handler, before the db.insert:
const systemEtaAt = calculateSystemEta(
  pickup.lat,
  pickup.lng,
  dropoff.lat,
  dropoff.lng,
  'motorcycle', // default — driver vehicle type applied when driver is assigned
);

// Add systemEtaAt to the .values({...}) object:
systemEtaAt: systemEtaAt,
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
pnpm --filter @surewaka/api test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|eta-calculator"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/eta-calculator.ts apps/api/src/__tests__/eta-calculator.test.ts apps/api/src/routes/deliveries.ts
git commit -m "feat(api): calculate system_eta_at at delivery booking using haversine + vehicle speed"
```

---

### Task 8: Seed data — realistic multi-leg deliveries for admin visual inspection

**Files:**
- Create: `packages/db/src/seeds/ops-intelligence.ts`

**Interfaces:**
- Consumes: all new tables from Task 1; existing `users`, `drivers`, `carriers`, `deliveries` tables
- Produces: runnable seed script that populates the admin dashboard with varied delivery states — active, at-risk, completed, disputed — across Lagos zones

Run: `pnpm --filter @surewaka/db tsx src/seeds/ops-intelligence.ts`

- [ ] **Step 1: Write the seed script**

```typescript
// packages/db/src/seeds/ops-intelligence.ts
/**
 * Seed: Ops Intelligence — multi-leg deliveries for admin visual inspection.
 * Populates delivery_legs, delivery_events, driver_locations, delivery_ratings.
 *
 * Run: pnpm --filter @surewaka/db tsx src/seeds/ops-intelligence.ts
 * Prerequisites: DATABASE_URL set in root .env; seed-drivers.ts and seed-customers.ts run first.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

config({ path: resolve(import.meta.dirname, '../../../../.env') });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, sql } from 'drizzle-orm';
import { users } from '../schema/users';
import { drivers } from '../schema/drivers';
import { carriers } from '../schema/carriers';
import { deliveries } from '../schema/deliveries';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');
const db = drizzle(neon(connectionString));

// ─── Fetch existing seeded data ───────────────────────────────────────────────

const allDrivers = await db.select().from(drivers).limit(8);
const allCarriers = await db.select().from(carriers).limit(3);
const allCustomers = await db
  .select()
  .from(users)
  .where(sql`role = 'customer'`)
  .limit(10);

if (allDrivers.length < 3) throw new Error('Run seed-drivers.ts first — need at least 3 drivers');
if (allCustomers.length < 3) throw new Error('Run seed-customers.ts first — need at least 3 customers');

const now = new Date();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const hrsAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

// ─── Lagos zone bounding coords (representative centroids) ───────────────────
const ZONE_COORDS: Record<string, { lat: number; lng: number; address: string }> = {
  Lekki:             { lat: 6.4457, lng: 3.4711, address: 'Lekki Phase 1, Lagos' },
  'Victoria Island': { lat: 6.4281, lng: 3.4219, address: 'Adeola Odeku St, Victoria Island' },
  Ikeja:             { lat: 6.6018, lng: 3.3515, address: 'Allen Avenue, Ikeja' },
  Surulere:          { lat: 6.5059, lng: 3.3506, address: 'Bode Thomas Street, Surulere' },
  Mainland:          { lat: 6.5244, lng: 3.3792, address: 'Yaba, Lagos Mainland' },
  Island:            { lat: 6.4531, lng: 3.3958, address: 'Lagos Island, Lagos' },
};

// ─── Helper ───────────────────────────────────────────────────────────────────
async function insertDelivery(
  customerId: string,
  status: string,
  pickupZone: string,
  dropoffZone: string,
  overrides: Record<string, unknown> = {},
) {
  const pickup = ZONE_COORDS[pickupZone] ?? ZONE_COORDS['Mainland'];
  const dropoff = ZONE_COORDS[dropoffZone] ?? ZONE_COORDS['Island'];
  const [d] = await db
    .insert(deliveries)
    .values({
      id: randomUUID(),
      customerId,
      status: status as any,
      pickupAddress: pickup.address,
      pickupCity: 'Lagos',
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropoffAddress: dropoff.address,
      dropoffCity: dropoffZone === 'intercity' ? 'Abuja' : 'Lagos',
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      packageDescription: 'Parcel — clothing items',
      packageWeight: 2,
      packageCategory: 'parcel',
      recipientName: 'Ngozi Eze',
      recipientPhone: '+2348012345678',
      paymentStatus: 'escrowed',
      ...overrides,
    })
    .returning();
  return d;
}

// ─── 1. Active intra-city — on track ─────────────────────────────────────────
console.log('Seeding: active on-track delivery (Lekki → VI)...');
const d1 = await insertDelivery(allCustomers[0].id, 'en_route_dropoff', 'Lekki', 'Victoria Island', {
  driverId: allDrivers[0].id,
  systemEtaAt: new Date(now.getTime() + 20 * 60_000), // ETA 20 min from now
});

// Delivery events for d1
await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d1.id}, NULL, 'pending', 'accepted', ${allDrivers[0].id}, ${minsAgo(45).toISOString()}),
    (${d1.id}, NULL, 'accepted', 'en_route_pickup', ${allDrivers[0].id}, ${minsAgo(40).toISOString()}),
    (${d1.id}, NULL, 'en_route_pickup', 'arrived_pickup', ${allDrivers[0].id}, ${minsAgo(30).toISOString()}),
    (${d1.id}, NULL, 'arrived_pickup', 'picked_up', ${allDrivers[0].id}, ${minsAgo(25).toISOString()}),
    (${d1.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[0].id}, ${minsAgo(20).toISOString()})
`);

// Live driver location pings for d1
await db.execute(sql`
  INSERT INTO driver_locations (driver_id, delivery_id, lat, lng, recorded_at)
  VALUES
    (${allDrivers[0].id}, ${d1.id}, 6.4400, 3.4500, ${minsAgo(5).toISOString()}),
    (${allDrivers[0].id}, ${d1.id}, 6.4350, 3.4450, ${minsAgo(3).toISOString()}),
    (${allDrivers[0].id}, ${d1.id}, 6.4300, 3.4350, ${minsAgo(1).toISOString()})
`);

// ─── 2. OVERDUE delivery — past ETA by 45 minutes ────────────────────────────
console.log('Seeding: overdue delivery (Ikeja → Surulere)...');
const d2 = await insertDelivery(allCustomers[1].id, 'en_route_dropoff', 'Ikeja', 'Surulere', {
  driverId: allDrivers[1].id,
  systemEtaAt: minsAgo(45), // ETA was 45 minutes ago — overdue
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d2.id}, NULL, 'pending', 'accepted', ${allDrivers[1].id}, ${hrsAgo(2).toISOString()}),
    (${d2.id}, NULL, 'accepted', 'picked_up', ${allDrivers[1].id}, ${hrsAgo(1.5).toISOString()}),
    (${d2.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[1].id}, ${hrsAgo(1).toISOString()})
`);

// Driver location pings — still moving, but late
await db.execute(sql`
  INSERT INTO driver_locations (driver_id, delivery_id, lat, lng, recorded_at)
  VALUES
    (${allDrivers[1].id}, ${d2.id}, 6.5300, 3.3600, ${minsAgo(8).toISOString()}),
    (${allDrivers[1].id}, ${d2.id}, 6.5200, 3.3550, ${minsAgo(4).toISOString()}),
    (${allDrivers[1].id}, ${d2.id}, 6.5100, 3.3520, ${minsAgo(2).toISOString()})
`);

// ─── 3. DRIVER SILENT — no GPS ping for 22 minutes ───────────────────────────
console.log('Seeding: driver-silent delivery (Mainland → Island)...');
const d3 = await insertDelivery(allCustomers[2].id, 'en_route_dropoff', 'Mainland', 'Island', {
  driverId: allDrivers[2].id,
  systemEtaAt: new Date(now.getTime() + 10 * 60_000),
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d3.id}, NULL, 'pending', 'accepted', ${allDrivers[2].id}, ${hrsAgo(1).toISOString()}),
    (${d3.id}, NULL, 'accepted', 'picked_up', ${allDrivers[2].id}, ${minsAgo(40).toISOString()}),
    (${d3.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[2].id}, ${minsAgo(30).toISOString()})
`);

// Last GPS ping was 22 minutes ago — triggers driver silent warning
await db.execute(sql`
  INSERT INTO driver_locations (driver_id, delivery_id, lat, lng, recorded_at)
  VALUES
    (${allDrivers[2].id}, ${d3.id}, 6.4700, 3.3900, ${minsAgo(22).toISOString()})
`);

// ─── 4. COMPLETED delivery with rating ───────────────────────────────────────
console.log('Seeding: completed delivery with rating (Surulere → Lekki)...');
const d4 = await insertDelivery(allCustomers[0].id, 'delivered', 'Surulere', 'Lekki', {
  driverId: allDrivers[0].id,
  systemEtaAt: hrsAgo(2),
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, created_at)
  VALUES
    (${d4.id}, NULL, 'pending', 'accepted', ${allDrivers[0].id}, ${hrsAgo(4).toISOString()}),
    (${d4.id}, NULL, 'accepted', 'picked_up', ${allDrivers[0].id}, ${hrsAgo(3.5).toISOString()}),
    (${d4.id}, NULL, 'picked_up', 'en_route_dropoff', ${allDrivers[0].id}, ${hrsAgo(3).toISOString()}),
    (${d4.id}, NULL, 'en_route_dropoff', 'delivered', ${allDrivers[0].id}, ${hrsAgo(2.1).toISOString()})
`);

await db.execute(sql`
  INSERT INTO delivery_ratings (delivery_id, driver_id, customer_id, rating, comment, created_at)
  VALUES (${d4.id}, ${allDrivers[0].id}, ${allCustomers[0].id}, 5, 'Very fast and professional!', ${hrsAgo(2).toISOString()})
`);

// ─── 5. FAILED delivery with failure attribution ──────────────────────────────
console.log('Seeding: failed delivery with driver attribution (Ikeja)...');
const d5 = await insertDelivery(allCustomers[1].id, 'failed', 'Ikeja', 'Victoria Island', {
  driverId: allDrivers[1].id,
  systemEtaAt: hrsAgo(1),
});

await db.execute(sql`
  INSERT INTO delivery_events (delivery_id, leg_id, from_status, to_status, triggered_by, failure_cause, failure_note, created_at)
  VALUES
    (${d5.id}, NULL, 'pending', 'accepted', ${allDrivers[1].id}, NULL, NULL, ${hrsAgo(3).toISOString()}),
    (${d5.id}, NULL, 'accepted', 'failed', ${allDrivers[1].id}, 'driver', 'Driver could not locate pickup address', ${hrsAgo(1).toISOString()})
`);

// ─── 6. MULTI-LEG intercity delivery — Leg 1 complete, Leg 2 in transit ──────
console.log('Seeding: intercity delivery (Lagos → Abuja, 2 legs active)...');
const d6 = await insertDelivery(allCustomers[2].id, 'en_route_dropoff', 'Mainland', 'Mainland', {
  dropoffCity: 'Abuja',
  systemEtaAt: new Date(now.getTime() + 20 * 3_600_000), // ETA 20 hours from now
});

// Leg 1: first_mile — completed
const leg1Id = randomUUID();
await db.execute(sql`
  INSERT INTO delivery_legs (id, delivery_id, leg_number, leg_type, actor_type, actor_id, pickup_address, pickup_lat, pickup_lng, pickup_zone, dropoff_address, dropoff_lat, dropoff_lng, dropoff_zone, status, system_eta_at, sla_hours, started_at, completed_at, created_at)
  VALUES (
    ${leg1Id}, ${d6.id}, 1, 'first_mile', 'driver', ${allDrivers[2].id},
    'Yaba, Lagos Mainland', 6.5244, 3.3792, 'Mainland',
    'Ojota Park, Lagos', 6.5690, 3.3903, 'Mainland',
    'delivered', ${minsAgo(30).toISOString()}, 1,
    ${hrsAgo(2).toISOString()}, ${minsAgo(30).toISOString()}, ${hrsAgo(3).toISOString()}
  )
`);

// Leg 2: intercity carrier — in progress
const leg2Id = randomUUID();
if (allCarriers.length > 0) {
  await db.execute(sql`
    INSERT INTO delivery_legs (id, delivery_id, leg_number, leg_type, actor_type, actor_id, pickup_address, pickup_lat, pickup_lng, pickup_zone, dropoff_address, dropoff_lat, dropoff_lng, dropoff_zone, status, system_eta_at, sla_hours, started_at, created_at)
    VALUES (
      ${leg2Id}, ${d6.id}, 2, 'intercity', 'carrier', ${allCarriers[0].id},
      'Ojota Park, Lagos', 6.5690, 3.3903, 'Mainland',
      'Utako, Abuja', 9.0765, 7.4983, 'Other',
      'en_route_dropoff', ${new Date(now.getTime() + 18 * 3_600_000).toISOString()}, 24,
      ${minsAgo(25).toISOString()}, ${minsAgo(25).toISOString()}
    )
  `);
}

// ─── 7. Additional completed deliveries for analytics trend data ──────────────
console.log('Seeding: 8 historical completed deliveries for analytics...');
const historicalDeliveries = [
  { customer: 0, driver: 0, from: 'Lekki', to: 'Victoria Island', hrsBack: 6, rating: 4 },
  { customer: 1, driver: 1, from: 'Ikeja', to: 'Mainland', hrsBack: 8, rating: 5 },
  { customer: 2, driver: 2, from: 'Surulere', to: 'Island', hrsBack: 12, rating: 3 },
  { customer: 0, driver: 0, from: 'Mainland', to: 'Lekki', hrsBack: 24, rating: 5 },
  { customer: 1, driver: 1, from: 'Victoria Island', to: 'Ikeja', hrsBack: 26, rating: 4 },
  { customer: 2, driver: 2, from: 'Lekki', to: 'Surulere', hrsBack: 30, rating: 4 },
  { customer: 0, driver: 0, from: 'Island', to: 'Mainland', hrsBack: 48, rating: 5 },
  { customer: 1, driver: 1, from: 'Ikeja', to: 'Victoria Island', hrsBack: 50, rating: 2 },
];

for (const h of historicalDeliveries) {
  const hd = await insertDelivery(
    allCustomers[h.customer % allCustomers.length].id,
    'delivered',
    h.from,
    h.to,
    {
      driverId: allDrivers[h.driver % allDrivers.length].id,
      systemEtaAt: hrsAgo(h.hrsBack - 1),
    },
  );
  await db.execute(sql`
    INSERT INTO delivery_events (delivery_id, from_status, to_status, triggered_by, created_at)
    VALUES
      (${hd.id}, 'pending', 'accepted', ${allDrivers[h.driver % allDrivers.length].id}, ${hrsAgo(h.hrsBack + 1.5).toISOString()}),
      (${hd.id}, 'accepted', 'picked_up', ${allDrivers[h.driver % allDrivers.length].id}, ${hrsAgo(h.hrsBack + 1).toISOString()}),
      (${hd.id}, 'picked_up', 'delivered', ${allDrivers[h.driver % allDrivers.length].id}, ${hrsAgo(h.hrsBack).toISOString()})
  `);
  await db.execute(sql`
    INSERT INTO delivery_ratings (delivery_id, driver_id, customer_id, rating, created_at)
    VALUES (${hd.id}, ${allDrivers[h.driver % allDrivers.length].id}, ${allCustomers[h.customer % allCustomers.length].id}, ${h.rating}, ${hrsAgo(h.hrsBack - 0.5).toISOString()})
  `);
}

console.log('✓ Ops intelligence seed complete.');
console.log('  Active deliveries: 3 (1 on-track, 1 overdue, 1 driver-silent)');
console.log('  Completed deliveries: 9 (1 with rating, 8 historical)');
console.log('  Failed deliveries: 1 (driver attribution)');
console.log('  Multi-leg intercity: 1 (2 legs)');
console.log('  Open admin at http://localhost:3001 to inspect.');
```

- [ ] **Step 2: Add seed script to `packages/db/package.json`**

Find `scripts` in `packages/db/package.json` and add:

```json
"seed:ops": "tsx src/seeds/ops-intelligence.ts"
```

- [ ] **Step 3: Run the seed**

```bash
pnpm --filter @surewaka/db seed:ops
```

Expected output:
```
✓ Ops intelligence seed complete.
  Active deliveries: 3 (1 on-track, 1 overdue, 1 driver-silent)
  Completed deliveries: 9 (1 with rating, 8 historical)
  Failed deliveries: 1 (driver attribution)
  Multi-leg intercity: 1 (2 legs)
  Open admin at http://localhost:3001 to inspect.
```

- [ ] **Step 4: Start the admin and visually inspect**

```bash
pnpm --filter @surewaka/admin dev
```

Open `http://localhost:3001`. Verify:
- Dashboard shows active deliveries count ≥ 3
- Deliveries page shows a mix of statuses (en_route_dropoff, delivered, failed)
- At-risk indicators are visible for the overdue delivery

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seeds/ops-intelligence.ts packages/db/package.json
git commit -m "feat(db): add ops-intelligence seed — multi-leg deliveries, driver locations, ratings for admin inspection"
```
