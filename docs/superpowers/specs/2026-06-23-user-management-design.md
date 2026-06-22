# Design — User Management (Admin + Carrier Portal)

## Overview

SureWaka has two distinct user populations that require managed access:

1. **Internal SureWaka staff** — backoffice ops team managed via `apps/admin`
2. **Carrier organisations** — fleet companies and their drivers managed via `apps/carrier` (new, PWA)

This document covers the full user management picture across both portals: role architecture, data model, carrier vetting pipeline, carrier portal user management, and invitation flows. It supersedes and extends the earlier `admin-user-management` and `rbac-system` specs, which were written against Supabase Auth. The system now runs on Clerk.

---

## Role Architecture (Approach B — split model)

Roles are split into two independent layers to allow each side to evolve without blocking the other.

### Platform roles (Clerk `publicMetadata.roles`, `user_roles` table)

The existing six-value enum stays stable. New internal SureWaka roles are added here one migration at a time as features ship. Adding a new role requires: (1) migration adding the enum value, (2) an entry in `ROLE_PERMISSIONS` in `packages/shared`. The invite dialog and role assignment panel pick up new roles automatically from the enum.

| Role | Scope | Description |
|---|---|---|
| `customer` | Global | Senders and receivers |
| `driver` | Global | Independent drivers, full platform |
| `surewaka_admin` | Global | God mode — full platform access |
| `support_agent` | Global | Read + resolve, capped refunds |
| `carrier_admin` | Org-scoped | Carrier owner/manager — full carrier portal access |
| `carrier_driver` | Org-scoped | Driver employed by a carrier |

Future examples: `kyc_officer`, `finance_staff`, `ops_manager` — added to this enum as features are built.

### Carrier org roles (`carrier_members.role` enum)

Extends independently of the platform enum. No platform migration needed when a new carrier org role is added.

| Role | Description |
|---|---|
| `carrier_admin` | Full access to `apps/carrier` — invites staff and drivers, manages pricing, vehicles, settings |
| `carrier_staff` | Office operations — assigns deliveries, views drivers, manages documents. Cannot invite or change pricing |
| `carrier_driver` | Drive only — `apps/mobile-driver` + light dispatch view |

Future examples: `carrier_dispatcher`, `carrier_finance` — added to the `carrier_member_role` enum only.

**Key separation:** a user's platform role (`carrier_admin`) tells the API who they are broadly. Their carrier org role inside `carrier_members` tells `apps/carrier` what they can do within that specific organisation.

---

## Data Model Changes

All changes follow the database-first workflow: migration file first, no manual edits to `packages/db/src/schema.ts`.

### 1. New table: `carrier_applications`

Tracks self-registration interest through the vetting pipeline. Only approved applications become `carriers` records — rejected or pending ones never pollute the active carrier table.

```sql
CREATE TABLE carrier_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name   text NOT NULL,
  contact_name    text NOT NULL,
  email           text NOT NULL,
  phone           text NOT NULL,
  cac_number      text,
  fleet_size      int,
  service_areas   jsonb,           -- e.g. ["Lagos", "Abuja"]
  notes           text,
  status          carrier_application_status NOT NULL DEFAULT 'pending',
  reviewed_by     uuid REFERENCES users(id),
  review_notes    text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE carrier_application_status AS ENUM (
  'pending', 'under_review', 'approved', 'rejected'
);
```

### 2. New table: `carrier_application_events` (append-only audit trail)

One row per status transition. `from_status` is null on the first event (initial submission), enabling full history replay.

```sql
CREATE TABLE carrier_application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES carrier_applications(id),
  from_status     carrier_application_status,   -- null = initial submission
  to_status       carrier_application_status NOT NULL,
  performed_by    uuid REFERENCES users(id),    -- null = system (self-registration)
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3. New table: `carrier_member_invitations`

Single source of truth for both email and phone invitation paths. Used for carrier_admin, carrier_staff, and carrier_driver invitations.

```sql
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
```

**Invitation matching on first login:** phone is matched first (phone IS NOT NULL AND phone = clerk phone). If no phone match, fall back to email match. A `carrier_members` row is created only on acceptance — the invitation record is the pending state. Invitations that have `accepted_at IS NOT NULL` or `expires_at < now()` are skipped.

### 4. New table: `carrier_member_events` (append-only audit trail)

Full audit log of every staff and driver change within a carrier org. Visible to carrier_admin within `apps/carrier` and to surewaka_admin in `apps/admin`.

```sql
CREATE TYPE carrier_member_action AS ENUM (
  'invited', 'joined', 'role_changed', 'suspended', 'reactivated', 'removed'
);

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
```

### 5. Update `carrier_member_role` enum

```sql
ALTER TYPE carrier_member_role ADD VALUE 'carrier_staff';
```

### 6. Update `carriers` table

```sql
ALTER TABLE carriers
  ADD COLUMN driver_vetting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN application_id uuid REFERENCES carrier_applications(id);
```

`driver_vetting_enabled = true` means newly added drivers enter a `pending_vetting` state and require surewaka_admin sign-off before accepting jobs. Strategic partner accounts created directly default to `false`. `application_id` is null for strategic partner accounts.

---

## `apps/admin` Changes

The existing employee management (invite, list, deactivate, role assignment, audit log) is unchanged.

### Addition 1: Carrier vetting pipeline

New "Carriers" section in the admin sidebar with two views:

**Applications queue** — lists all `carrier_applications` sorted by status and submission date.
- Columns: business name, contact, phone, fleet size, service areas, submitted date, status, reviewer
- Filters: status, date range, reviewer
- Actions: Start Review → Approve / Reject

**Carrier accounts** — lists approved `carriers`.
- Toggle `driver_vetting_enabled` per carrier
- Deactivate / reactivate a carrier account
- Create strategic partner account directly (bypasses application queue)

**Vetting workflow:**

```
Application submitted (self-registration form on apps/landing or apps/web)
  └─ surewaka_admin opens application
  └─ Moves status: pending → under_review (logs carrier_application_events entry)
  └─ Reviews CAC number, fleet size, service areas
  └─ Approve → modal collects:
       - Carrier name (may differ from application business_name)
       - Slug (auto-generated, editable)
       - driver_vetting_enabled toggle (default off)
       - carrier_admin contact: phone (required) + email (optional)
     → creates carriers record (links application_id)
     → creates carrier_member_invitations record
     → sends invitation (email via Clerk OR SMS via Termii based on what was provided)
     → logs carrier_application_events: under_review → approved
  └─ Reject → modal collects reason
     → logs carrier_application_events: under_review → rejected
     → optional SMS/email notification to applicant
```

### Addition 2: Driver vetting queue (when enabled)

When `driver_vetting_enabled = true` on a carrier, newly invited drivers appear in a "Pending Driver Vetting" queue in `apps/admin`. surewaka_admin reviews and approves/rejects. Approval sets the driver's `carrier_members.is_active = true` and logs a `carrier_member_events` entry.

### Extensible internal roles

The invite dialog for SureWaka staff reads roles from the `userRoleEnum` dynamically. Adding a new internal role (`kyc_officer`, `finance_staff`, etc.) requires:
1. Migration adding the enum value
2. Entry in `ROLE_PERMISSIONS` in `packages/shared`

No UI changes needed — the role dropdown and role assignment panel pick it up automatically.

---

## `apps/carrier` — New App (PWA, B2B, Responsive Web)

Carrier companies have office staff managing fleet operations: reviewing delivery requests, assigning drivers, setting pricing, managing vehicle documents, viewing earnings. `apps/carrier` is a web-first PWA targeting these B2B users. Drivers use `apps/mobile-driver` (with a light dispatch view).

### User management surfaces

**1. Team management (carrier_admin only)**

- Invite office staff → modal collects name + phone (required) + email (optional) → creates `carrier_member_invitations` → sends SMS or email
- View all active staff — name, role, joined date, last active
- Deactivate staff → sets `carrier_members.is_active = false` → logs `carrier_member_events`
- carrier_staff cannot see or access this section

**2. Driver management (carrier_admin + carrier_staff)**

- Invite driver → phone-first → creates `carrier_member_invitations` with `carrier_driver` role → sends SMS with link to `apps/mobile-driver`
- If `driver_vetting_enabled = true` → the `carrier_members` row is created with `is_active = false`; driver appears in surewaka_admin vetting queue before they can accept jobs; approval sets `is_active = true`
- View driver roster — name, phone, status (active / pending_vetting / suspended), assigned jobs today
- Suspend / reactivate driver (carrier_admin only) → logs `carrier_member_events`

**3. Org audit log**

carrier_admin can view full `carrier_member_events` history for their org: who was invited, when they joined, suspensions, role changes.

### Permission boundaries in `apps/carrier`

| Action | carrier_admin | carrier_staff |
|---|---|---|
| Invite / remove staff | ✅ | ❌ |
| Invite / suspend drivers | ✅ | ❌ |
| View team and driver roster | ✅ | ✅ |
| Assign deliveries to drivers | ✅ | ✅ |
| Manage pricing and vehicles | ✅ | ❌ |
| View earnings reports | ✅ | ✅ (read-only) |
| View org audit log | ✅ | ❌ |

---

## Invitation and First-Login Flows (Clerk)

`carrier_member_invitations` is the single source of truth for all carrier-side invitations. Clerk is the identity provider only — role assignment happens entirely in our system.

### Email path (strategic partners, formal B2B with business email)

```
surewaka_admin / carrier_admin creates invitation with email
  → carrier_member_invitations record created
  → Clerk invitation API called: emailAddress + redirectUrl (apps/carrier/accept)
  → recipient receives email, clicks link
  → Clerk authenticates, redirects to /accept
  → API matches invitation by email → assigns carrier org role in carrier_members
  → marks accepted_at, logs carrier_member_events
  → user enters carrier portal or mobile-driver
```

### Phone path (Nigerian-first, self-registered carriers, staff, drivers)

```
surewaka_admin / carrier_admin creates invitation with phone number
  → carrier_member_invitations record created
  → SMS sent via Termii with link to apps/carrier (or apps/mobile-driver for drivers)
  → recipient visits link, enters phone, completes Clerk OTP
  → requireAuth provisions internal users row if first-time login
  → auth flow checks carrier_member_invitations by phone → finds pending invite
  → assigns carrier org role in carrier_members, marks accepted_at
  → logs carrier_member_events
  → user enters carrier portal or mobile-driver
```

### Invitation expiry and resend

- Invitations expire after 7 days (fixed for now; per-carrier configuration is out of scope)
- Admin can resend — creates a new `carrier_member_invitations` record; old record is preserved for audit
- Phone resend → new SMS via Termii; email resend → new Clerk invitation issued

### SureWaka internal staff (unchanged pattern)

Internal staff invitations use the existing employee management flow in `apps/admin`. surewaka_admin invites by email via Clerk. No phone path for internal staff (business email required).

---

## System Map

```
apps/admin  (SureWaka internal, surewaka_admin + support_agent + future roles)
  ├── Employee management         existing, extensible role enum
  ├── Carrier applications queue  vetting pipeline + carrier_application_events
  └── Carrier accounts            toggle vetting, create strategic partners, driver vetting queue

apps/carrier  (fleet management, PWA, carrier_admin + carrier_staff)
  ├── Team management             invite/manage carrier_staff
  ├── Driver management           invite/manage carrier_driver, vetting flag respected
  └── Org audit log               carrier_member_events

apps/mobile-driver  (drivers + light fleet dispatch view)
  └── carrier_driver onboarding   phone OTP → carrier_member_invitations lookup

Shared infrastructure
  ├── carrier_member_invitations  dual-path email + phone, all carrier-side invitations
  ├── carrier_application_events  vetting audit trail (append-only)
  └── carrier_member_events       in-org staff and driver audit trail (append-only)
```

---

## What Is Not In Scope Here

- Full `apps/carrier` feature set (delivery assignment, pricing, vehicle docs, earnings) — separate spec
- Driver KYC flow — separate spec
- `carrier_driver` → `driver` upgrade path — covered in rbac-system spec
- Payment and payout flows — separate spec
- Real-time tracking — separate spec
