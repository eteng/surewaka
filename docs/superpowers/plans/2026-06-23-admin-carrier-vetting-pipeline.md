# Admin Carrier Vetting Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable surewaka_admin to vet carrier applications and onboard approved carriers (plus create strategic partner accounts directly) through the admin portal.

**Architecture:** Database-first — migration creates all new tables and enum values, then the vetting service implements business logic, API routes expose it, and the admin UI consumes it. Self-registration form (on `apps/landing`) is out of scope; the submission endpoint is included so the pipeline has data to work with. Phone SMS delivery (Termii) is deferred to Plan 2 when `apps/carrier` URL is known — the `carrier_member_invitations` record is always created.

**Tech Stack:** Postgres + Drizzle ORM, Hono (API), Clerk admin client (email invitations), React Router v7 (admin SPA), shadcn/ui, Zod, Vitest + fast-check

---

## File Map

**New files:**
- `supabase/migrations/20260623000001_carrier_vetting_pipeline.sql`
- `apps/api/src/routes/admin/carriers.ts`
- `apps/api/src/routes/carrier-applications.ts` — public submission endpoint
- `apps/api/src/services/carrier-vetting-service.ts`
- `apps/api/src/services/__tests__/carrier-vetting-service.test.ts`
- `apps/admin/app/hooks/use-carrier-applications.ts`
- `apps/admin/app/hooks/use-carrier-application-detail.ts`
- `apps/admin/app/components/carriers/application-table.tsx`
- `apps/admin/app/components/carriers/application-toolbar.tsx`
- `apps/admin/app/components/carriers/approve-dialog.tsx`
- `apps/admin/app/components/carriers/reject-dialog.tsx`
- `apps/admin/app/components/carriers/create-strategic-partner-dialog.tsx`
- `apps/admin/app/routes/carriers.applications.tsx`
- `apps/admin/app/routes/carriers.applications.$applicationId.tsx`

**Modified files:**
- `packages/shared/src/validators.ts` — add carrier application schemas
- `packages/shared/src/types.ts` — add carrier application types
- `apps/api/src/index.ts` — register new routes
- `apps/admin/app/routes/carriers.tsx` — replace TODO stub with real carrier list
- `apps/admin/app/routes.ts` — add application queue routes
- `apps/admin/app/components/app-sidebar.tsx` — add Applications submenu

---

## Task 1: Schema Migration

**Files:**
- Create: `supabase/migrations/20260623000001_carrier_vetting_pipeline.sql`

- [ ] **Step 1.1: Write the migration file**

```sql
-- supabase/migrations/20260623000001_carrier_vetting_pipeline.sql

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE carrier_application_status AS ENUM (
  'pending',
  'under_review',
  'approved',
  'rejected'
);

CREATE TYPE carrier_member_action AS ENUM (
  'invited',
  'joined',
  'role_changed',
  'suspended',
  'reactivated',
  'removed'
);

-- carrier_staff is added to the existing carrier_member_role enum.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in PG < 12;
-- Supabase runs migrations outside a transaction, so this is safe.
ALTER TYPE carrier_member_role ADD VALUE IF NOT EXISTS 'carrier_staff';

-- ── carrier_applications ───────────────────────────────────────────────────────

CREATE TABLE carrier_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name   text NOT NULL,
  contact_name    text NOT NULL,
  email           text NOT NULL,
  phone           text NOT NULL,
  cac_number      text,
  fleet_size      int,
  service_areas   jsonb NOT NULL DEFAULT '[]',
  notes           text,
  status          carrier_application_status NOT NULL DEFAULT 'pending',
  reviewed_by     uuid REFERENCES users(id),
  review_notes    text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_applications_status ON carrier_applications(status);
CREATE INDEX idx_carrier_applications_created_at ON carrier_applications(created_at DESC);

ALTER TABLE carrier_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_applications"
  ON carrier_applications FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT, INSERT ON carrier_applications TO authenticated;

-- ── carrier_application_events (append-only) ──────────────────────────────────

CREATE TABLE carrier_application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES carrier_applications(id),
  from_status     carrier_application_status,
  to_status       carrier_application_status NOT NULL,
  performed_by    uuid REFERENCES users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_application_events_application
  ON carrier_application_events(application_id, created_at ASC);

ALTER TABLE carrier_application_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_application_events"
  ON carrier_application_events FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT ON carrier_application_events TO authenticated;

-- ── carrier_member_invitations ────────────────────────────────────────────────

CREATE TABLE carrier_member_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id    uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  phone         text,
  email         text,
  role          carrier_member_role NOT NULL,
  invited_by    uuid NOT NULL REFERENCES users(id),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_or_email_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_carrier_member_invitations_phone
  ON carrier_member_invitations(phone) WHERE phone IS NOT NULL AND accepted_at IS NULL;
CREATE INDEX idx_carrier_member_invitations_email
  ON carrier_member_invitations(email) WHERE email IS NOT NULL AND accepted_at IS NULL;

ALTER TABLE carrier_member_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_member_invitations"
  ON carrier_member_invitations FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT ON carrier_member_invitations TO authenticated;

-- ── carrier_member_events (append-only) ───────────────────────────────────────

CREATE TABLE carrier_member_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id      uuid NOT NULL REFERENCES carriers(id),
  target_user_id  uuid REFERENCES users(id),
  action          carrier_member_action NOT NULL,
  role            carrier_member_role NOT NULL,
  performed_by    uuid REFERENCES users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carrier_member_events_carrier
  ON carrier_member_events(carrier_id, created_at DESC);

ALTER TABLE carrier_member_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_carrier_member_events"
  ON carrier_member_events FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT ON carrier_member_events TO authenticated;

-- ── Update carriers table ─────────────────────────────────────────────────────

ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS driver_vetting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES carrier_applications(id);
```

- [ ] **Step 1.2: Apply migration locally**

```bash
npx supabase migration up
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 1.3: Regenerate schema**

```bash
pnpm --filter @surewaka/db db:pull
```

Expected: `packages/db/src/schema.ts` updates with new tables and enum values. Do not hand-edit this file.

- [ ] **Step 1.4: Build to verify types compile**

```bash
pnpm build --filter @surewaka/db --filter @surewaka/shared
```

Expected: both packages build with zero errors.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/20260623000001_carrier_vetting_pipeline.sql packages/db/src/schema.ts
git commit -m "feat(db): add carrier vetting pipeline tables and enums"
```

---

## Task 2: Shared Validators and Types

**Files:**
- Modify: `packages/shared/src/validators.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 2.1: Add carrier application types to `packages/shared/src/types.ts`**

Add after the existing type definitions:

```typescript
export type CarrierApplicationStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export type CarrierApplicationListItem = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  fleetSize: number | null;
  serviceAreas: string[];
  status: CarrierApplicationStatus;
  createdAt: string;
  updatedAt: string;
};

export type CarrierApplicationDetail = CarrierApplicationListItem & {
  cacNumber: string | null;
  notes: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  events: CarrierApplicationEvent[];
};

export type CarrierApplicationEvent = {
  id: string;
  fromStatus: CarrierApplicationStatus | null;
  toStatus: CarrierApplicationStatus;
  performedBy: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
};

export type CarrierListItem = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isVerified: boolean;
  isActive: boolean;
  driverVettingEnabled: boolean;
  applicationId: string | null;
  createdAt: string;
};
```

- [ ] **Step 2.2: Add validators to `packages/shared/src/validators.ts`**

Add after the existing validator exports:

```typescript
// ── Carrier Application Validators ──────────────────────────────────────────

export const NIGERIAN_PHONE_REGEX = /^\+234\d{10}$/;

export const submitCarrierApplicationSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters').max(200),
  contactName: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(NIGERIAN_PHONE_REGEX, 'Must be a valid Nigerian number (+234XXXXXXXXXX)'),
  cacNumber: z.string().max(20).optional(),
  fleetSize: z.number().int().positive().optional(),
  serviceAreas: z.array(z.string().min(1)).min(1, 'Select at least one service area'),
  notes: z.string().max(1000).optional(),
});

export const approveCarrierApplicationSchema = z
  .object({
    carrierName: z.string().min(2).max(200),
    slug: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens only'),
    driverVettingEnabled: z.boolean().default(false),
    adminPhone: z.string().regex(NIGERIAN_PHONE_REGEX).optional(),
    adminEmail: z.string().email().optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => d.adminPhone != null || d.adminEmail != null, {
    message: 'Either adminPhone or adminEmail is required to invite the carrier admin',
  });

export const rejectCarrierApplicationSchema = z.object({
  reason: z.string().min(10, 'Provide at least 10 characters explaining the rejection').max(1000),
});

export const carrierApplicationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  status: z.enum(['pending', 'under_review', 'approved', 'rejected']).optional(),
  sortBy: z.enum(['createdAt', 'businessName', 'status']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const createStrategicCarrierSchema = z
  .object({
    carrierName: z.string().min(2).max(200),
    slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
    contactName: z.string().min(2).max(100),
    adminPhone: z.string().regex(NIGERIAN_PHONE_REGEX).optional(),
    adminEmail: z.string().email().optional(),
    driverVettingEnabled: z.boolean().default(false),
  })
  .refine((d) => d.adminPhone != null || d.adminEmail != null, {
    message: 'Either adminPhone or adminEmail is required',
  });

export const carrierListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  isActive: z.coerce.boolean().optional(),
});

export type SubmitCarrierApplicationInput = z.infer<typeof submitCarrierApplicationSchema>;
export type ApproveCarrierApplicationInput = z.infer<typeof approveCarrierApplicationSchema>;
export type RejectCarrierApplicationInput = z.infer<typeof rejectCarrierApplicationSchema>;
export type CarrierApplicationListQuery = z.infer<typeof carrierApplicationListQuerySchema>;
export type CreateStrategicCarrierInput = z.infer<typeof createStrategicCarrierSchema>;
export type CarrierListQuery = z.infer<typeof carrierListQuerySchema>;
```

- [ ] **Step 2.3: Write validator tests**

Create `packages/shared/src/__tests__/carrier-validators.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  submitCarrierApplicationSchema,
  approveCarrierApplicationSchema,
  rejectCarrierApplicationSchema,
} from '../validators';

describe('submitCarrierApplicationSchema', () => {
  const valid = {
    businessName: 'GIG Logistics',
    contactName: 'Adaeze Okafor',
    email: 'adaeze@giglogistics.com',
    phone: '+2348012345678',
    serviceAreas: ['Lagos'],
  };

  it('accepts a valid application', () => {
    expect(submitCarrierApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid Nigerian phone', () => {
    const result = submitCarrierApplicationSchema.safeParse({ ...valid, phone: '08012345678' });
    expect(result.success).toBe(false);
  });

  it('rejects empty serviceAreas', () => {
    const result = submitCarrierApplicationSchema.safeParse({ ...valid, serviceAreas: [] });
    expect(result.success).toBe(false);
  });
});

describe('approveCarrierApplicationSchema', () => {
  const valid = {
    carrierName: 'GIG Logistics',
    slug: 'gig-logistics',
    driverVettingEnabled: false,
    adminEmail: 'admin@gig.com',
  };

  it('accepts email-only invite', () => {
    expect(approveCarrierApplicationSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts phone-only invite', () => {
    const result = approveCarrierApplicationSchema.safeParse({
      ...valid,
      adminEmail: undefined,
      adminPhone: '+2348012345678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when neither phone nor email provided', () => {
    const result = approveCarrierApplicationSchema.safeParse({
      carrierName: 'GIG Logistics',
      slug: 'gig-logistics',
      driverVettingEnabled: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid slug', () => {
    const result = approveCarrierApplicationSchema.safeParse({ ...valid, slug: 'GIG Logistics' });
    expect(result.success).toBe(false);
  });
});

describe('rejectCarrierApplicationSchema', () => {
  it('rejects reason shorter than 10 characters', () => {
    const result = rejectCarrierApplicationSchema.safeParse({ reason: 'Too bad' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid reason', () => {
    const result = rejectCarrierApplicationSchema.safeParse({
      reason: 'CAC number could not be verified after three attempts.',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2.4: Run tests**

```bash
pnpm --filter @surewaka/shared test
```

Expected: all tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add packages/shared/src/validators.ts packages/shared/src/types.ts packages/shared/src/__tests__/carrier-validators.test.ts
git commit -m "feat(shared): add carrier application validators and types"
```

---

## Task 3: Carrier Vetting Service

**Files:**
- Create: `apps/api/src/services/carrier-vetting-service.ts`
- Create: `apps/api/src/services/__tests__/carrier-vetting-service.test.ts`

The service uses `db` from `@surewaka/db` and `clerkClient` from `@surewaka/auth`. Before implementing, verify that `@surewaka/auth` exports `clerkClient` — run `grep -r "clerkClient" packages/` to confirm. If it's not exported, add it to the package alongside the existing `verifyToken` export using `import { createClerkClient } from '@clerk/backend'`. All writes that span multiple tables use a Drizzle transaction. Invitation sending (Clerk email) happens after the transaction so a delivery failure does not roll back the carrier creation.

- [ ] **Step 3.1: Write the failing tests first**

Create `apps/api/src/services/__tests__/carrier-vetting-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB and Clerk before importing the service
vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@surewaka/auth', () => ({
  clerkClient: {
    invitations: {
      createInvitation: vi.fn(),
    },
  },
}));

import { submitApplication, approveApplication, rejectApplication, startReview } from '../carrier-vetting-service';
import { db } from '@surewaka/db';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('submitApplication', () => {
  it('returns CONFLICT when email already has a pending/under_review application', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'existing-id' }]),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await submitApplication({
      businessName: 'Test Co',
      contactName: 'Test User',
      email: 'test@test.com',
      phone: '+2348012345678',
      serviceAreas: ['Lagos'],
    });

    expect(result.error?.code).toBe('CONFLICT');
    expect(result.data).toBeNull();
  });
});

describe('startReview', () => {
  it('returns NOT_FOUND when application does not exist', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await startReview({ applicationId: 'nonexistent', adminId: 'admin-1' });
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('returns INVALID_STATUS when application is not pending', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'app-1', status: 'approved' }]),
        }),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await startReview({ applicationId: 'app-1', adminId: 'admin-1' });
    expect(result.error?.code).toBe('INVALID_STATUS');
  });
});

describe('rejectApplication', () => {
  it('returns INVALID_STATUS when application is not under_review', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'app-1', status: 'pending' }]),
        }),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await rejectApplication({
      applicationId: 'app-1',
      adminId: 'admin-1',
      reason: 'CAC number could not be verified.',
    });
    expect(result.error?.code).toBe('INVALID_STATUS');
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
pnpm --filter @surewaka/api test src/services/__tests__/carrier-vetting-service.test.ts
```

Expected: FAIL — `Cannot find module '../carrier-vetting-service'`

- [ ] **Step 3.3: Implement the carrier vetting service**

Create `apps/api/src/services/carrier-vetting-service.ts`:

```typescript
import { db } from '@surewaka/db';
import {
  carrierApplications,
  carrierApplicationEvents,
  carriers,
  carrierMemberInvitations,
} from '@surewaka/db/schema';
import { clerkClient } from '@surewaka/auth';
import { eq, and, or, ilike, sql } from 'drizzle-orm';
import type {
  SubmitCarrierApplicationInput,
  ApproveCarrierApplicationInput,
  RejectCarrierApplicationInput,
  CarrierApplicationListQuery,
  CarrierListQuery,
  CreateStrategicCarrierInput,
  CarrierApplicationDetail,
  CarrierApplicationListItem,
  CarrierListItem,
} from '@surewaka/shared';

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

const INVITATION_TTL_DAYS = 7;

function invitationExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + INVITATION_TTL_DAYS);
  return d;
}

// ── Public: submit application ───────────────────────────────────────────────

export async function submitApplication(
  input: SubmitCarrierApplicationInput,
): Promise<ServiceResult<{ id: string }>> {
  const existing = await db
    .select({ id: carrierApplications.id })
    .from(carrierApplications)
    .where(
      and(
        eq(carrierApplications.email, input.email),
        or(
          eq(carrierApplications.status, 'pending'),
          eq(carrierApplications.status, 'under_review'),
        ),
      ),
    );

  if (existing.length > 0) {
    return { data: null, error: { code: 'CONFLICT', message: 'An active application already exists for this email' } };
  }

  const [app] = await db
    .insert(carrierApplications)
    .values({
      businessName: input.businessName,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      cacNumber: input.cacNumber ?? null,
      fleetSize: input.fleetSize ?? null,
      serviceAreas: input.serviceAreas,
      notes: input.notes ?? null,
    })
    .returning({ id: carrierApplications.id });

  await db.insert(carrierApplicationEvents).values({
    applicationId: app.id,
    fromStatus: null,
    toStatus: 'pending',
    performedBy: null,
    notes: 'Self-registration submitted',
  });

  return { data: { id: app.id }, error: null };
}

// ── Admin: list applications ─────────────────────────────────────────────────

export async function listApplications(query: CarrierApplicationListQuery): Promise<{
  data: CarrierApplicationListItem[];
  total: number;
}> {
  const { page, pageSize, search, status, sortBy, sortDir } = query;
  const offset = (page - 1) * pageSize;

  const filters = [];
  if (search) {
    filters.push(
      or(
        ilike(carrierApplications.businessName, `%${search}%`),
        ilike(carrierApplications.contactName, `%${search}%`),
        ilike(carrierApplications.email, `%${search}%`),
      ),
    );
  }
  if (status) filters.push(eq(carrierApplications.status, status));

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(carrierApplications)
    .where(whereClause);

  const sortCol =
    sortBy === 'businessName'
      ? carrierApplications.businessName
      : sortBy === 'status'
        ? carrierApplications.status
        : carrierApplications.createdAt;

  const rows = await db
    .select({
      id: carrierApplications.id,
      businessName: carrierApplications.businessName,
      contactName: carrierApplications.contactName,
      email: carrierApplications.email,
      phone: carrierApplications.phone,
      fleetSize: carrierApplications.fleetSize,
      serviceAreas: carrierApplications.serviceAreas,
      status: carrierApplications.status,
      createdAt: carrierApplications.createdAt,
      updatedAt: carrierApplications.updatedAt,
    })
    .from(carrierApplications)
    .where(whereClause)
    .orderBy(sortDir === 'asc' ? sortCol : sql`${sortCol} DESC`)
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows.map((r) => ({
      ...r,
      serviceAreas: (r.serviceAreas as string[]) ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: count,
  };
}

// ── Admin: get application detail ────────────────────────────────────────────

export async function getApplication(
  id: string,
): Promise<ServiceResult<CarrierApplicationDetail>> {
  const rows = await db
    .select()
    .from(carrierApplications)
    .where(eq(carrierApplications.id, id))
    .limit(1);

  if (rows.length === 0) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Application not found' } };
  }

  const app = rows[0];
  const events = await db
    .select()
    .from(carrierApplicationEvents)
    .where(eq(carrierApplicationEvents.applicationId, id))
    .orderBy(carrierApplicationEvents.createdAt);

  return {
    data: {
      id: app.id,
      businessName: app.businessName,
      contactName: app.contactName,
      email: app.email,
      phone: app.phone,
      cacNumber: app.cacNumber,
      fleetSize: app.fleetSize,
      serviceAreas: (app.serviceAreas as string[]) ?? [],
      notes: app.notes,
      status: app.status,
      reviewedBy: null,
      reviewNotes: app.reviewNotes,
      reviewedAt: app.reviewedAt?.toISOString() ?? null,
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
      events: events.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        performedBy: null,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
      })),
    },
    error: null,
  };
}

// ── Admin: start review ──────────────────────────────────────────────────────

export async function startReview(params: {
  applicationId: string;
  adminId: string;
  notes?: string;
}): Promise<ServiceResult<void>> {
  const rows = await db
    .select({ id: carrierApplications.id, status: carrierApplications.status })
    .from(carrierApplications)
    .where(eq(carrierApplications.id, params.applicationId))
    .limit(1);

  if (rows.length === 0) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Application not found' } };
  }

  if (rows[0].status !== 'pending') {
    return { data: null, error: { code: 'INVALID_STATUS', message: `Cannot start review on a ${rows[0].status} application` } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(carrierApplications)
      .set({ status: 'under_review', updatedAt: new Date() })
      .where(eq(carrierApplications.id, params.applicationId));

    await tx.insert(carrierApplicationEvents).values({
      applicationId: params.applicationId,
      fromStatus: 'pending',
      toStatus: 'under_review',
      performedBy: params.adminId,
      notes: params.notes ?? null,
    });
  });

  return { data: null, error: null };
}

// ── Admin: approve application ───────────────────────────────────────────────

export async function approveApplication(params: {
  applicationId: string;
  adminId: string;
  input: ApproveCarrierApplicationInput;
}): Promise<ServiceResult<{ carrierId: string }>> {
  const { applicationId, adminId, input } = params;

  const rows = await db
    .select()
    .from(carrierApplications)
    .where(eq(carrierApplications.id, applicationId))
    .limit(1);

  if (rows.length === 0) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Application not found' } };
  }

  if (rows[0].status !== 'under_review') {
    return { data: null, error: { code: 'INVALID_STATUS', message: `Cannot approve a ${rows[0].status} application` } };
  }

  const slugCheck = await db
    .select({ id: carriers.id })
    .from(carriers)
    .where(eq(carriers.slug, input.slug))
    .limit(1);

  if (slugCheck.length > 0) {
    return { data: null, error: { code: 'CONFLICT', message: `Slug "${input.slug}" is already taken` } };
  }

  const now = new Date();

  const carrierId = await db.transaction(async (tx) => {
    const [carrier] = await tx
      .insert(carriers)
      .values({
        name: input.carrierName,
        slug: input.slug,
        driverVettingEnabled: input.driverVettingEnabled,
        applicationId,
        isVerified: true,
        isActive: true,
        verifiedBy: adminId,
        verifiedAt: now,
      })
      .returning({ id: carriers.id });

    await tx.insert(carrierMemberInvitations).values({
      carrierId: carrier.id,
      phone: input.adminPhone ?? null,
      email: input.adminEmail ?? null,
      role: 'carrier_admin',
      invitedBy: adminId,
      expiresAt: invitationExpiresAt(),
    });

    await tx
      .update(carrierApplications)
      .set({ status: 'approved', reviewedBy: adminId, reviewNotes: input.notes ?? null, reviewedAt: now, updatedAt: now })
      .where(eq(carrierApplications.id, applicationId));

    await tx.insert(carrierApplicationEvents).values({
      applicationId,
      fromStatus: 'under_review',
      toStatus: 'approved',
      performedBy: adminId,
      notes: input.notes ?? null,
    });

    return carrier.id;
  });

  // Send Clerk email invitation after transaction — failure does not roll back carrier creation
  if (input.adminEmail) {
    try {
      await clerkClient.invitations.createInvitation({
        emailAddress: input.adminEmail,
        redirectUrl: `${process.env.CARRIER_APP_URL ?? 'https://fleet.surewaka.com'}/accept`,
        publicMetadata: { carrierId, role: 'carrier_admin' },
        ignoreExisting: true,
      });
    } catch (err) {
      console.error('[carrier-vetting] Clerk invitation failed for', input.adminEmail, err);
      // Non-fatal: invitation record exists in carrier_member_invitations; admin can resend
    }
  }
  // Phone invitation: SMS via Termii — deferred to Plan 2 when apps/carrier URL is confirmed
  // carrier_member_invitations record is already created above

  return { data: { carrierId }, error: null };
}

// ── Admin: reject application ────────────────────────────────────────────────

export async function rejectApplication(params: {
  applicationId: string;
  adminId: string;
  reason: string;
}): Promise<ServiceResult<void>> {
  const rows = await db
    .select({ id: carrierApplications.id, status: carrierApplications.status })
    .from(carrierApplications)
    .where(eq(carrierApplications.id, params.applicationId))
    .limit(1);

  if (rows.length === 0) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Application not found' } };
  }

  if (rows[0].status !== 'under_review') {
    return { data: null, error: { code: 'INVALID_STATUS', message: `Cannot reject a ${rows[0].status} application` } };
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(carrierApplications)
      .set({ status: 'rejected', reviewedBy: params.adminId, reviewNotes: params.reason, reviewedAt: now, updatedAt: now })
      .where(eq(carrierApplications.id, params.applicationId));

    await tx.insert(carrierApplicationEvents).values({
      applicationId: params.applicationId,
      fromStatus: 'under_review',
      toStatus: 'rejected',
      performedBy: params.adminId,
      notes: params.reason,
    });
  });

  return { data: null, error: null };
}

// ── Admin: create strategic partner ─────────────────────────────────────────

export async function createStrategicCarrier(params: {
  adminId: string;
  input: CreateStrategicCarrierInput;
}): Promise<ServiceResult<{ carrierId: string }>> {
  const { adminId, input } = params;

  const slugCheck = await db
    .select({ id: carriers.id })
    .from(carriers)
    .where(eq(carriers.slug, input.slug))
    .limit(1);

  if (slugCheck.length > 0) {
    return { data: null, error: { code: 'CONFLICT', message: `Slug "${input.slug}" is already taken` } };
  }

  const carrierId = await db.transaction(async (tx) => {
    const [carrier] = await tx
      .insert(carriers)
      .values({
        name: input.carrierName,
        slug: input.slug,
        driverVettingEnabled: input.driverVettingEnabled,
        applicationId: null,
        isVerified: true,
        isActive: true,
        verifiedBy: adminId,
        verifiedAt: new Date(),
      })
      .returning({ id: carriers.id });

    await tx.insert(carrierMemberInvitations).values({
      carrierId: carrier.id,
      phone: input.adminPhone ?? null,
      email: input.adminEmail ?? null,
      role: 'carrier_admin',
      invitedBy: adminId,
      expiresAt: invitationExpiresAt(),
    });

    return carrier.id;
  });

  if (input.adminEmail) {
    try {
      await clerkClient.invitations.createInvitation({
        emailAddress: input.adminEmail,
        redirectUrl: `${process.env.CARRIER_APP_URL ?? 'https://fleet.surewaka.com'}/accept`,
        publicMetadata: { carrierId, role: 'carrier_admin' },
        ignoreExisting: true,
      });
    } catch (err) {
      console.error('[carrier-vetting] Clerk invitation failed for strategic partner', input.adminEmail, err);
    }
  }

  return { data: { carrierId }, error: null };
}

// ── Admin: list active carriers ──────────────────────────────────────────────

export async function listCarriers(query: CarrierListQuery): Promise<{
  data: CarrierListItem[];
  total: number;
}> {
  const { page, pageSize, search, isActive } = query;
  const offset = (page - 1) * pageSize;

  const filters = [];
  if (search) filters.push(ilike(carriers.name, `%${search}%`));
  if (isActive !== undefined) filters.push(eq(carriers.isActive, isActive));
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(carriers)
    .where(whereClause);

  const rows = await db
    .select()
    .from(carriers)
    .where(whereClause)
    .orderBy(sql`${carriers.createdAt} DESC`)
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logoUrl: r.logoUrl,
      isVerified: r.isVerified,
      isActive: r.isActive,
      driverVettingEnabled: r.driverVettingEnabled,
      applicationId: r.applicationId,
      createdAt: r.createdAt.toISOString(),
    })),
    total: count,
  };
}
```

- [ ] **Step 3.4: Run tests**

```bash
pnpm --filter @surewaka/api test src/services/__tests__/carrier-vetting-service.test.ts
```

Expected: all tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/services/carrier-vetting-service.ts apps/api/src/services/__tests__/carrier-vetting-service.test.ts
git commit -m "feat(api): add carrier vetting service"
```

---

## Task 4: API Routes

**Files:**
- Create: `apps/api/src/routes/admin/carriers.ts`
- Create: `apps/api/src/routes/carrier-applications.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 4.1: Create admin carrier routes**

Create `apps/api/src/routes/admin/carriers.ts`:

```typescript
import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import {
  carrierApplicationListQuerySchema,
  approveCarrierApplicationSchema,
  rejectCarrierApplicationSchema,
  createStrategicCarrierSchema,
  carrierListQuerySchema,
} from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import {
  listApplications,
  getApplication,
  startReview,
  approveApplication,
  rejectApplication,
  createStrategicCarrier,
  listCarriers,
} from '../../services/carrier-vetting-service';

type Env = { Variables: { user: AuthUser } };

const adminCarriers = new Hono<Env>();

adminCarriers.use('*', requireAuth);
adminCarriers.use('*', requireRole('surewaka_admin'));

// GET  /applications        — list all applications (paginated + filterable)
adminCarriers.get('/applications', async (c) => {
  const parsed = carrierApplicationListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const { data, total } = await listApplications(parsed.data);
  const { page, pageSize } = parsed.data;
  return c.json({ data, error: null, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
});

// GET  /applications/:id    — get application detail with event history
adminCarriers.get('/applications/:id', async (c) => {
  const result = await getApplication(c.req.param('id'));
  if (result.error) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: result.data, error: null, meta: null });
});

// POST /applications/:id/review   — move pending → under_review
adminCarriers.post('/applications/:id/review', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const result = await startReview({ applicationId: c.req.param('id'), adminId: user.id, notes: body.notes });
  if (result.error) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'INVALID_STATUS' ? 409 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: null, error: null, meta: null });
});

// POST /applications/:id/approve  — approve and create carrier + invitation
adminCarriers.post('/applications/:id/approve', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = approveCarrierApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const result = await approveApplication({ applicationId: c.req.param('id'), adminId: user.id, input: parsed.data });
  if (result.error) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'CONFLICT' ? 409 : result.error.code === 'INVALID_STATUS' ? 409 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: result.data, error: null, meta: null }, 201);
});

// POST /applications/:id/reject   — reject application
adminCarriers.post('/applications/:id/reject', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = rejectCarrierApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const result = await rejectApplication({ applicationId: c.req.param('id'), adminId: user.id, reason: parsed.data.reason });
  if (result.error) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'INVALID_STATUS' ? 409 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: null, error: null, meta: null });
});

// GET  /                    — list active carriers
adminCarriers.get('/', async (c) => {
  const parsed = carrierListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const { data, total } = await listCarriers(parsed.data);
  const { page, pageSize } = parsed.data;
  return c.json({ data, error: null, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
});

// POST /strategic            — create strategic partner account directly
adminCarriers.post('/strategic', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createStrategicCarrierSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const result = await createStrategicCarrier({ adminId: user.id, input: parsed.data });
  if (result.error) {
    const status = result.error.code === 'CONFLICT' ? 409 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: result.data, error: null, meta: null }, 201);
});

export default adminCarriers;
```

- [ ] **Step 4.2: Create public application submission route**

Create `apps/api/src/routes/carrier-applications.ts`:

```typescript
import { Hono } from 'hono';
import { submitCarrierApplicationSchema } from '@surewaka/shared';
import { submitApplication } from '../services/carrier-vetting-service';

const carrierApplications = new Hono();

// POST / — public endpoint, no auth required
carrierApplications.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = submitCarrierApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const result = await submitApplication(parsed.data);
  if (result.error) {
    const status = result.error.code === 'CONFLICT' ? 409 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: result.data, error: null, meta: null }, 201);
});

export default carrierApplications;
```

- [ ] **Step 4.3: Register routes in `apps/api/src/index.ts`**

Add after the existing admin route registrations:

```typescript
import adminCarrierRoutes from './routes/admin/carriers';
import carrierApplicationRoutes from './routes/carrier-applications';

// ...existing registrations...
app.route('/api/v1/admin/carriers', adminCarrierRoutes);
app.route('/api/v1/carrier-applications', carrierApplicationRoutes);
```

- [ ] **Step 4.4: Build to verify no TypeScript errors**

```bash
pnpm --filter @surewaka/api build
```

Expected: zero errors.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/routes/admin/carriers.ts apps/api/src/routes/carrier-applications.ts apps/api/src/index.ts
git commit -m "feat(api): add carrier vetting and application submission routes"
```

---

## Task 5: Admin Data Hooks

**Files:**
- Create: `apps/admin/app/hooks/use-carrier-applications.ts`
- Create: `apps/admin/app/hooks/use-carrier-application-detail.ts`

These hooks follow the same pattern as `use-employee-data.ts` and `use-waitlist-data.ts`.

- [ ] **Step 5.1: Create `use-carrier-applications.ts`**

```typescript
// apps/admin/app/hooks/use-carrier-applications.ts
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CarrierApplicationListItem, CarrierApplicationListQuery, CarrierListItem } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type ApplicationsResult = {
  data: CarrierApplicationListItem[];
  meta: { total: number; page: number; pageSize: number; totalPages: number } | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

type CarriersResult = {
  data: CarrierListItem[];
  meta: { total: number; page: number; pageSize: number; totalPages: number } | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useCarrierApplications(params: Partial<CarrierApplicationListQuery>): ApplicationsResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<CarrierApplicationListItem[]>([]);
  const [meta, setMeta] = useState<ApplicationsResult['meta']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const token = await getToken();
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString();

      const res = await fetch(`${API_URL}/api/v1/admin/carriers/applications?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) return;

      if (!res.ok) {
        setError('Failed to load applications');
        setIsLoading(false);
        return;
      }

      const json = await res.json();
      setData(json.data ?? []);
      setMeta(json.meta ?? null);
      setIsLoading(false);
    })().catch((err) => {
      if (!cancelled) { setError(String(err)); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [params.page, params.pageSize, params.search, params.status, params.sortBy, params.sortDir, tick]);

  return { data, meta, isLoading, error, refetch };
}

export function useCarriers(params: { page?: number; pageSize?: number; search?: string; isActive?: boolean }): CarriersResult {
  const { getToken } = useAuth();
  const [data, setData] = useState<CarrierListItem[]>([]);
  const [meta, setMeta] = useState<CarriersResult['meta']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const token = await getToken();
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString();

      const res = await fetch(`${API_URL}/api/v1/admin/carriers?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) return;
      if (!res.ok) { setError('Failed to load carriers'); setIsLoading(false); return; }

      const json = await res.json();
      setData(json.data ?? []);
      setMeta(json.meta ?? null);
      setIsLoading(false);
    })().catch((err) => {
      if (!cancelled) { setError(String(err)); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [params.page, params.pageSize, params.search, params.isActive, tick]);

  return { data, meta, isLoading, error, refetch };
}
```

- [ ] **Step 5.2: Create `use-carrier-application-detail.ts`**

```typescript
// apps/admin/app/hooks/use-carrier-application-detail.ts
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import type { CarrierApplicationDetail, ApproveCarrierApplicationInput, RejectCarrierApplicationInput } from '@surewaka/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type DetailResult = {
  application: CarrierApplicationDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  startReview: (notes?: string) => Promise<{ ok: boolean; error?: string }>;
  approve: (input: ApproveCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
  reject: (input: RejectCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
};

export function useCarrierApplicationDetail(applicationId: string): DetailResult {
  const { getToken } = useAuth();
  const [application, setApplication] = useState<CarrierApplicationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/carriers/applications/${applicationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (cancelled) return;
      if (!res.ok) { setError('Failed to load application'); setIsLoading(false); return; }

      const json = await res.json();
      setApplication(json.data);
      setIsLoading(false);
    })().catch((err) => {
      if (!cancelled) { setError(String(err)); setIsLoading(false); }
    });

    return () => { cancelled = true; };
  }, [applicationId, tick]);

  const post = useCallback(async (path: string, body: unknown) => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/v1/admin/carriers/applications/${applicationId}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { ok: res.ok, error: res.ok ? undefined : (json.error?.message ?? 'Request failed') };
  }, [applicationId, getToken]);

  const startReview = useCallback((notes?: string) => post('review', { notes }), [post]);
  const approve = useCallback((input: ApproveCarrierApplicationInput) => post('approve', input), [post]);
  const reject = useCallback((input: RejectCarrierApplicationInput) => post('reject', input), [post]);

  return { application, isLoading, error, refetch, startReview, approve, reject };
}
```

- [ ] **Step 5.3: Commit**

```bash
git add apps/admin/app/hooks/use-carrier-applications.ts apps/admin/app/hooks/use-carrier-application-detail.ts
git commit -m "feat(admin): add carrier application data hooks"
```

---

## Task 6: Application Table and Toolbar Components

**Files:**
- Create: `apps/admin/app/components/carriers/application-table.tsx`
- Create: `apps/admin/app/components/carriers/application-toolbar.tsx`

- [ ] **Step 6.1: Create `application-toolbar.tsx`**

```typescript
// apps/admin/app/components/carriers/application-toolbar.tsx
import { Input } from '~/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { Button } from '~/components/ui/button';
import { Search } from 'lucide-react';

type ApplicationToolbarProps = {
  search: string;
  status: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onCreateStrategicPartner: () => void;
};

export function ApplicationToolbar({
  search,
  status,
  onSearchChange,
  onStatusChange,
  onCreateStrategicPartner,
}: ApplicationToolbarProps) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search business name, contact, email..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="under_review">Under Review</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="outline" onClick={onCreateStrategicPartner} className="ml-auto">
        Add Strategic Partner
      </Button>
    </div>
  );
}
```

- [ ] **Step 6.2: Create `application-table.tsx`**

```typescript
// apps/admin/app/components/carriers/application-table.tsx
import { useNavigate } from 'react-router';
import type { CarrierApplicationListItem } from '@surewaka/shared';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  under_review: { label: 'Under Review', variant: 'default' },
  approved: { label: 'Approved', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

type ApplicationTableProps = {
  applications: CarrierApplicationListItem[];
  isLoading: boolean;
};

export function ApplicationTable({ applications, isLoading }: ApplicationTableProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        No applications found.
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="py-3 text-left font-medium">Business</th>
          <th className="py-3 text-left font-medium">Contact</th>
          <th className="py-3 text-left font-medium">Fleet</th>
          <th className="py-3 text-left font-medium">Service Areas</th>
          <th className="py-3 text-left font-medium">Status</th>
          <th className="py-3 text-left font-medium">Submitted</th>
        </tr>
      </thead>
      <tbody>
        {applications.map((app) => {
          const statusConfig = STATUS_LABELS[app.status] ?? { label: app.status, variant: 'secondary' as const };
          return (
            <tr
              key={app.id}
              className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate(`/carriers/applications/${app.id}`)}
            >
              <td className="py-3 font-medium">{app.businessName}</td>
              <td className="py-3 text-muted-foreground">
                <div>{app.contactName}</div>
                <div className="text-xs">{app.email}</div>
              </td>
              <td className="py-3">{app.fleetSize ?? '—'}</td>
              <td className="py-3">
                <div className="flex flex-wrap gap-1">
                  {(app.serviceAreas).slice(0, 3).map((area) => (
                    <span key={area} className="text-xs bg-muted px-1.5 py-0.5 rounded">{area}</span>
                  ))}
                  {app.serviceAreas.length > 3 && (
                    <span className="text-xs text-muted-foreground">+{app.serviceAreas.length - 3}</span>
                  )}
                </div>
              </td>
              <td className="py-3">
                <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
              </td>
              <td className="py-3 text-muted-foreground">
                {new Date(app.createdAt).toLocaleDateString('en-NG')}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 6.3: Commit**

```bash
git add apps/admin/app/components/carriers/
git commit -m "feat(admin): add carrier application table and toolbar components"
```

---

## Task 7: Approve, Reject, and Strategic Partner Dialogs

**Files:**
- Create: `apps/admin/app/components/carriers/approve-dialog.tsx`
- Create: `apps/admin/app/components/carriers/reject-dialog.tsx`
- Create: `apps/admin/app/components/carriers/create-strategic-partner-dialog.tsx`

- [ ] **Step 7.1: Create `approve-dialog.tsx`**

```typescript
// apps/admin/app/components/carriers/approve-dialog.tsx
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { approveCarrierApplicationSchema } from '@surewaka/shared';
import type { ApproveCarrierApplicationInput } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';

type ApproveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillName?: string;
  prefillEmail?: string;
  prefillPhone?: string;
  onApprove: (input: ApproveCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
};

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function ApproveDialog({
  open,
  onOpenChange,
  prefillName = '',
  prefillEmail = '',
  prefillPhone = '',
  onApprove,
}: ApproveDialogProps) {
  const [carrierName, setCarrierName] = useState(prefillName);
  const [slug, setSlug] = useState(toSlug(prefillName));
  const [driverVettingEnabled, setDriverVettingEnabled] = useState(false);
  const [inviteMethod, setInviteMethod] = useState<'email' | 'phone'>(prefillEmail ? 'email' : 'phone');
  const [adminEmail, setAdminEmail] = useState(prefillEmail);
  const [adminPhone, setAdminPhone] = useState(prefillPhone);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNameChange = (v: string) => {
    setCarrierName(v);
    setSlug(toSlug(v));
  };

  const handleSubmit = async () => {
    setError('');
    const input = {
      carrierName,
      slug,
      driverVettingEnabled,
      adminEmail: inviteMethod === 'email' ? adminEmail : undefined,
      adminPhone: inviteMethod === 'phone' ? adminPhone : undefined,
      notes: notes || undefined,
    };

    const parsed = approveCarrierApplicationSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    setLoading(true);
    const result = await onApprove(parsed.data);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? 'Approval failed');
      return;
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve Carrier Application</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="carrier-name">Carrier Name</Label>
            <Input id="carrier-name" value={carrierName} onChange={(e) => handleNameChange(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>

          <div>
            <Label>Driver Vetting</Label>
            <Select
              value={driverVettingEnabled ? 'yes' : 'no'}
              onValueChange={(v) => setDriverVettingEnabled(v === 'yes')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — carrier manages drivers independently</SelectItem>
                <SelectItem value="yes">Yes — SureWaka vets each new driver</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Invite carrier admin via</Label>
            <Select value={inviteMethod} onValueChange={(v) => setInviteMethod(v as 'email' | 'phone')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone (SMS)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {inviteMethod === 'email' ? (
            <div>
              <Label htmlFor="admin-email">Admin Email</Label>
              <Input id="admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="admin-phone">Admin Phone (+234...)</Label>
              <Input id="admin-phone" type="tel" placeholder="+2348012345678" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />
            </div>
          )}

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve & Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7.2: Create `reject-dialog.tsx`**

```typescript
// apps/admin/app/components/carriers/reject-dialog.tsx
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { RejectCarrierApplicationInput } from '@surewaka/shared';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';

type RejectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (input: RejectCarrierApplicationInput) => Promise<{ ok: boolean; error?: string }>;
};

export function RejectDialog({ open, onOpenChange, onReject }: RejectDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (reason.trim().length < 10) {
      setError('Provide at least 10 characters explaining the rejection');
      return;
    }

    setLoading(true);
    const result = await onReject({ reason: reason.trim() });
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? 'Rejection failed');
      return;
    }

    setReason('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Application</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This will close the application. The applicant will not be notified automatically.
          </p>
          <div>
            <Label htmlFor="reason">Reason (internal)</Label>
            <textarea
              id="reason"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[100px]"
              placeholder="CAC number could not be verified after three attempts..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7.3: Create `create-strategic-partner-dialog.tsx`**

```typescript
// apps/admin/app/components/carriers/create-strategic-partner-dialog.tsx
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createStrategicCarrierSchema } from '@surewaka/shared';
import { useAuth } from '@clerk/react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type CreateStrategicPartnerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function CreateStrategicPartnerDialog({ open, onOpenChange, onSuccess }: CreateStrategicPartnerDialogProps) {
  const { getToken } = useAuth();
  const [carrierName, setCarrierName] = useState('');
  const [slug, setSlug] = useState('');
  const [contactName, setContactName] = useState('');
  const [inviteMethod, setInviteMethod] = useState<'email' | 'phone'>('email');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [driverVettingEnabled, setDriverVettingEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNameChange = (v: string) => {
    setCarrierName(v);
    setSlug(toSlug(v));
  };

  const handleSubmit = async () => {
    setError('');
    const input = {
      carrierName,
      slug,
      contactName,
      adminEmail: inviteMethod === 'email' ? adminEmail : undefined,
      adminPhone: inviteMethod === 'phone' ? adminPhone : undefined,
      driverVettingEnabled,
    };

    const parsed = createStrategicCarrierSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    setLoading(true);
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/v1/admin/carriers/strategic`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(json.error?.message ?? 'Failed to create carrier');
      return;
    }

    onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Strategic Partner</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="sp-name">Carrier Name</Label>
            <Input id="sp-name" value={carrierName} onChange={(e) => handleNameChange(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sp-slug">Slug</Label>
            <Input id="sp-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sp-contact">Contact Name</Label>
            <Input id="sp-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div>
            <Label>Invite admin via</Label>
            <Select value={inviteMethod} onValueChange={(v) => setInviteMethod(v as 'email' | 'phone')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone (SMS)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {inviteMethod === 'email' ? (
            <div>
              <Label htmlFor="sp-email">Admin Email</Label>
              <Input id="sp-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="sp-phone">Admin Phone (+234...)</Label>
              <Input id="sp-phone" type="tel" placeholder="+2348012345678" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Driver Vetting</Label>
            <Select value={driverVettingEnabled ? 'yes' : 'no'} onValueChange={(v) => setDriverVettingEnabled(v === 'yes')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — carrier manages independently</SelectItem>
                <SelectItem value="yes">Yes — SureWaka vets each driver</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create & Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7.4: Commit**

```bash
git add apps/admin/app/components/carriers/
git commit -m "feat(admin): add approve, reject, and strategic partner dialogs"
```

---

## Task 8: Application Detail Page

**Files:**
- Create: `apps/admin/app/routes/carriers.applications.$applicationId.tsx`

- [ ] **Step 8.1: Create the application detail route**

```typescript
// apps/admin/app/routes/carriers.applications.$applicationId.tsx
import { useParams, useNavigate } from 'react-router';
import { useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import type { Route } from './+types/carriers.applications.$applicationId';
import { useCarrierApplicationDetail } from '~/hooks/use-carrier-application-detail';
import { ApproveDialog } from '~/components/carriers/approve-dialog';
import { RejectDialog } from '~/components/carriers/reject-dialog';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Carrier Application' }];
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  under_review: { label: 'Under Review', variant: 'default' },
  approved: { label: 'Approved', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

export default function ApplicationDetail() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { application, isLoading, error, refetch, startReview, approve, reject } =
    useCarrierApplicationDetail(applicationId!);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error ?? 'Application not found'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/carriers/applications')}>
          Back to Applications
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_LABELS[application.status] ?? { label: application.status, variant: 'secondary' as const };

  const handleStartReview = async () => {
    const result = await startReview();
    if (result.ok) refetch();
  };

  return (
    <div className="p-8 max-w-3xl">
      <button
        onClick={() => navigate('/carriers/applications')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Applications
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{application.businessName}</h1>
          <p className="text-muted-foreground mt-1">{application.contactName} · {application.email} · {application.phone}</p>
        </div>
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">CAC Number</p>
          <p className="mt-1">{application.cacNumber ?? '—'}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Fleet Size</p>
          <p className="mt-1">{application.fleetSize ?? '—'}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Service Areas</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {application.serviceAreas.map((a) => (
              <span key={a} className="text-xs bg-muted px-2 py-0.5 rounded">{a}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Submitted</p>
          <p className="mt-1">{new Date(application.createdAt).toLocaleDateString('en-NG')}</p>
        </div>
        {application.notes && (
          <div className="col-span-2">
            <p className="text-sm font-medium text-muted-foreground">Applicant Notes</p>
            <p className="mt-1 text-sm">{application.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {application.status === 'pending' && (
        <div className="flex gap-3 mb-8">
          <Button onClick={handleStartReview}>Start Review</Button>
        </div>
      )}
      {application.status === 'under_review' && (
        <div className="flex gap-3 mb-8">
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => setApproveOpen(true)}
          >
            Approve
          </Button>
          <Button variant="destructive" onClick={() => setRejectOpen(true)}>Reject</Button>
        </div>
      )}

      {/* Audit Trail */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Audit Trail</h2>
        <div className="space-y-3">
          {application.events.map((event) => (
            <div key={event.id} className="flex items-start gap-3">
              <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm">
                  {event.fromStatus ? (
                    <span>
                      <Badge variant="outline" className="text-xs">{event.fromStatus}</Badge>
                      {' → '}
                      <Badge variant="outline" className="text-xs">{event.toStatus}</Badge>
                    </span>
                  ) : (
                    <span>Application submitted</span>
                  )}
                  {event.performedBy && <span className="text-muted-foreground"> by {event.performedBy.name}</span>}
                </p>
                {event.notes && <p className="text-xs text-muted-foreground mt-0.5">{event.notes}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(event.createdAt).toLocaleString('en-NG')}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ApproveDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        prefillName={application.businessName}
        prefillEmail={application.email}
        prefillPhone={application.phone}
        onApprove={async (input) => {
          const result = await approve(input);
          if (result.ok) { refetch(); setApproveOpen(false); }
          return result;
        }}
      />

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onReject={async (input) => {
          const result = await reject(input);
          if (result.ok) { refetch(); setRejectOpen(false); }
          return result;
        }}
      />
    </div>
  );
}
```

- [ ] **Step 8.2: Commit**

```bash
git add apps/admin/app/routes/carriers.applications.\$applicationId.tsx
git commit -m "feat(admin): add carrier application detail page with audit trail"
```

---

## Task 9: Applications Queue Page and Carriers List Page

**Files:**
- Create: `apps/admin/app/routes/carriers.applications.tsx`
- Modify: `apps/admin/app/routes/carriers.tsx`

- [ ] **Step 9.1: Create `carriers.applications.tsx`**

```typescript
// apps/admin/app/routes/carriers.applications.tsx
import { useState } from 'react';
import type { Route } from './+types/carriers.applications';
import { useCarrierApplications } from '~/hooks/use-carrier-applications';
import { ApplicationTable } from '~/components/carriers/application-table';
import { ApplicationToolbar } from '~/components/carriers/application-toolbar';
import { CreateStrategicPartnerDialog } from '~/components/carriers/create-strategic-partner-dialog';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Carrier Applications' }];
}

export default function CarrierApplications() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page] = useState(1);
  const [strategicOpen, setStrategicOpen] = useState(false);

  const { data, meta, isLoading, refetch } = useCarrierApplications({
    search: search || undefined,
    status: (status && status !== 'all' ? status : undefined) as never,
    page,
    pageSize: 20,
    sortBy: 'createdAt',
    sortDir: 'desc',
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Carrier Applications</h1>
          <p className="mt-1 text-muted-foreground">
            {meta ? `${meta.total} application${meta.total !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>

      <ApplicationToolbar
        search={search}
        status={status}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
        onCreateStrategicPartner={() => setStrategicOpen(true)}
      />

      <ApplicationTable applications={data} isLoading={isLoading} />

      <CreateStrategicPartnerDialog
        open={strategicOpen}
        onOpenChange={setStrategicOpen}
        onSuccess={refetch}
      />
    </div>
  );
}
```

- [ ] **Step 9.2: Replace the carriers stub with a real carriers list**

Replace the entire content of `apps/admin/app/routes/carriers.tsx`:

```typescript
// apps/admin/app/routes/carriers.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Route } from './+types/carriers';
import { useCarriers } from '~/hooks/use-carrier-applications';
import { Input } from '~/components/ui/input';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';
import { Search } from 'lucide-react';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Carriers' }];
}

export default function Carriers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const { data, meta, isLoading } = useCarriers({ search: search || undefined, page: 1, pageSize: 30 });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Carriers</h1>
          <p className="mt-1 text-muted-foreground">
            {meta ? `${meta.total} registered carrier${meta.total !== 1 ? 's' : ''}` : 'Manage registered logistics companies'}
          </p>
        </div>
        <button
          onClick={() => navigate('/carriers/applications')}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          View Applications →
        </button>
      </div>

      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search carriers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
        </div>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center">No carriers found.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-3 text-left font-medium">Name</th>
              <th className="py-3 text-left font-medium">Slug</th>
              <th className="py-3 text-left font-medium">Driver Vetting</th>
              <th className="py-3 text-left font-medium">Status</th>
              <th className="py-3 text-left font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.map((carrier) => (
              <tr key={carrier.id} className="border-b hover:bg-muted/50">
                <td className="py-3 font-medium">{carrier.name}</td>
                <td className="py-3 text-muted-foreground">{carrier.slug}</td>
                <td className="py-3">
                  <Badge variant={carrier.driverVettingEnabled ? 'default' : 'secondary'}>
                    {carrier.driverVettingEnabled ? 'Enabled' : 'Off'}
                  </Badge>
                </td>
                <td className="py-3">
                  <Badge variant={carrier.isActive ? 'outline' : 'destructive'}>
                    {carrier.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="py-3 text-muted-foreground">
                  {new Date(carrier.createdAt).toLocaleDateString('en-NG')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 9.3: Commit**

```bash
git add apps/admin/app/routes/carriers.applications.tsx apps/admin/app/routes/carriers.tsx
git commit -m "feat(admin): add carrier applications queue and replace carriers stub"
```

---

## Task 10: Routes and Sidebar

**Files:**
- Modify: `apps/admin/app/routes.ts`
- Modify: `apps/admin/app/components/app-sidebar.tsx`

- [ ] **Step 10.1: Add new routes to `routes.ts`**

```typescript
// apps/admin/app/routes.ts
import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  route('login', 'routes/login.tsx'),
  route('mfa/enroll', 'routes/mfa/enroll.tsx'),
  route('mfa/verify', 'routes/mfa/verify.tsx'),
  layout('routes/layout.tsx', [
    index('routes/dashboard.tsx'),
    route('deliveries', 'routes/deliveries.tsx'),
    route('drivers', 'routes/drivers.tsx'),
    route('carriers', 'routes/carriers.tsx'),
    route('carriers/applications', 'routes/carriers.applications.tsx'),
    route('carriers/applications/:applicationId', 'routes/carriers.applications.$applicationId.tsx'),
    route('users', 'routes/users.tsx'),
    route('users/:userId', 'routes/users.$userId.tsx'),
    route('analytics', 'routes/analytics.tsx'),
    route('settings', 'routes/settings.tsx'),
    route('settings/profile', 'routes/settings/profile.tsx'),
    route('settings/name-changes', 'routes/settings/name-changes.tsx'),
    route('notifications', 'routes/notifications.tsx'),
    route('disputes', 'routes/disputes.tsx'),
    route('verifications', 'routes/verifications.tsx'),
    route('waitlist', 'routes/waitlist.tsx'),
  ]),
] satisfies RouteConfig;
```

- [ ] **Step 10.2: Update sidebar to add Applications link under Fleet**

In `apps/admin/app/components/app-sidebar.tsx`, update the `navMain` array — replace the Fleet section:

```typescript
{
  title: 'Fleet',
  url: '#',
  icon: Users,
  items: [
    { title: 'Drivers', url: '/drivers' },
    { title: 'Carriers', url: '/carriers' },
    { title: 'Applications', url: '/carriers/applications' },
    { title: 'Verifications', url: '/verifications' },
  ],
},
```

- [ ] **Step 10.3: Commit**

```bash
git add apps/admin/app/routes.ts apps/admin/app/components/app-sidebar.tsx
git commit -m "feat(admin): wire carrier vetting routes and sidebar navigation"
```

---

## Task 11: Final Build Verification

- [ ] **Step 11.1: Run all tests**

```bash
pnpm test
```

Expected: all existing tests pass, new tests pass.

- [ ] **Step 11.2: Build all packages**

```bash
pnpm build
```

Expected: zero TypeScript errors across all packages.

- [ ] **Step 11.3: Start the admin app and verify**

```bash
pnpm --filter @surewaka/api dev &
pnpm --filter @surewaka/admin dev
```

- Navigate to `/carriers` — should show carrier list (empty is fine)
- Navigate to `/carriers/applications` — should show applications queue with toolbar and "Add Strategic Partner" button
- Click "Add Strategic Partner" — dialog should open with name/slug/contact/invite fields
- Navigate to `/carriers/applications/<any-uuid>` — should show 404 state gracefully

- [ ] **Step 11.4: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: address build or runtime issues from final verification"
```

---

## Out of Scope (Plan 2)

The following are intentionally deferred to the `apps/carrier` plan:

- **Driver vetting queue in apps/admin** — when `driver_vetting_enabled = true` on a carrier, newly invited drivers need a pending-vetting queue in admin. This requires drivers to be added via `apps/carrier` first (Plan 2), so the queue UI belongs there.
- **Phone SMS delivery (Termii)** — `carrier_member_invitations` records are created in this plan; SMS sending requires the confirmed `apps/carrier` URL and Termii API setup.
- **Invitation resend** — resend flows for both email and phone, handled in Plan 2.
- **Carrier deactivation / driver_vetting_enabled toggle UI** — carrier account management detail page, deferred to Plan 2.
- **Self-registration form** — the public `POST /api/v1/carrier-applications` endpoint is live after this plan; the form on `apps/landing` or `apps/web` is a separate feature.
