# SureWaka Admin Dashboard

Internal operations dashboard for the SureWaka team. Built with React Router v7 (SPA mode) and the shadcn/ui sidebar-07 block pattern.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Router v7 (SPA mode) |
| UI | shadcn/ui (New York style) + Tailwind CSS v4 |
| Auth | Supabase Auth (email/password + TOTP MFA) |
| API | Calls `apps/api` at `/api/v1` |
| Build | Vite 6 |
| Deployment | Vercel |

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm 9.x
- Supabase project with MFA (TOTP) enabled

### Environment Variables

Create `apps/admin/.env`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### Run

```bash
pnpm --filter @surewaka/admin dev
```

Opens at `http://localhost:3001`

### Build

```bash
pnpm --filter @surewaka/admin build
```

## Authentication Flow

The admin app enforces **email + password login with mandatory TOTP MFA** for all users.

### Flow Diagram

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌───────────┐
│  /login │────▶│ Check AAL    │────▶│ /mfa/enroll │────▶│ Dashboard │
│         │     │              │     │ or          │     │           │
│ Email + │     │ aal1→aal2?  │     │ /mfa/verify │     │ Protected │
│ Password│     │ redirect    │     │             │     │ Routes    │
└─────────┘     └──────────────┘     └─────────────┘     └───────────┘
```

### States

| User State | Redirect To | What Happens |
|-----------|-------------|--------------|
| Not authenticated | `/login` | Email + password form |
| Authenticated, no MFA factor | `/mfa/enroll` | QR code shown, user scans + verifies |
| Authenticated, MFA enrolled but not verified this session | `/mfa/verify` | Enter 6-digit TOTP code |
| Authenticated, AAL2 achieved | `/` (dashboard) | Full access |

### Auth Guard

The `AuthGuard` component wraps all protected routes (in `routes/layout.tsx`). It checks:

1. Is there a session? → No → redirect to `/login`
2. Is `nextLevel === 'aal2'` and `currentLevel === 'aal1'`? → redirect to `/mfa/verify`
3. Is `nextLevel === 'aal1'` (no MFA enrolled)? → redirect to `/mfa/enroll`
4. Otherwise → render children

## MFA Enrollment: "Resume-or-Create" Pattern

The MFA enrollment handles the known Supabase limitation where `mfa.unenroll()` requires AAL2 but enrollment happens at AAL1.

### The Problem

If a user starts enrollment (factor created as `unverified`) but navigates away before verifying, the stale factor cannot be deleted client-side. Re-calling `enroll()` with the same `friendlyName` causes a `mfa_factor_name_conflict` (422) error.

### The Solution

The `useMFAEnrollment` hook (`app/hooks/use-mfa-enrollment.ts`) implements:

```
listFactors()
  ├─ Verified factor exists → redirect to /mfa/verify
  ├─ Unverified factor exists:
  │     ├─ QR in sessionStorage → show QR (resume enrollment)
  │     └─ QR lost → show "enter code" UI (user may have already scanned)
  └─ No factors → enroll() → store QR in sessionStorage → show QR
```

**Key decisions:**

- **No `friendlyName`** on `enroll()` — avoids uniqueness constraint conflicts entirely
- **`sessionStorage`** stores QR code + secret — survives page refresh within the same tab
- **Reuse existing unverified factors** — never creates duplicates
- **`useRef` guard** — prevents React strict mode double-initialization

### Cleanup of Stale Factors

For production, add a periodic cleanup of abandoned enrollments:

```sql
-- Run via pg_cron or Edge Function with service_role
DELETE FROM auth.mfa_factors
WHERE status = 'unverified'
  AND created_at < NOW() - INTERVAL '24 hours';
```

## Project Structure

```
apps/admin/
├── app/
│   ├── app.css                    # Tailwind v4 theme + base styles
│   ├── root.tsx                   # Root layout (html/body)
│   ├── routes.ts                  # Route config
│   ├── components/
│   │   ├── app-sidebar.tsx        # Main sidebar with navigation data
│   │   ├── auth-guard.tsx         # Auth + MFA protection wrapper
│   │   ├── nav-main.tsx           # Collapsible nav groups
│   │   ├── nav-projects.tsx       # Quick-access project links
│   │   ├── nav-user.tsx           # User avatar + dropdown (sign out)
│   │   ├── team-switcher.tsx      # Brand header in sidebar
│   │   └── ui/                    # shadcn/ui components
│   │       ├── avatar.tsx
│   │       ├── breadcrumb.tsx
│   │       ├── button.tsx
│   │       ├── collapsible.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── input.tsx
│   │       ├── separator.tsx
│   │       ├── sheet.tsx
│   │       ├── sidebar.tsx        # Full shadcn sidebar component
│   │       ├── skeleton.tsx
│   │       └── tooltip.tsx
│   ├── hooks/
│   │   ├── use-auth.ts            # Auth state + helper functions
│   │   ├── use-mfa-enrollment.ts  # MFA enrollment state machine
│   │   └── use-mobile.ts          # Mobile breakpoint detection
│   ├── lib/
│   │   ├── supabase.ts            # Browser Supabase client
│   │   └── utils.ts               # cn() utility
│   └── routes/
│       ├── layout.tsx             # Sidebar + header + AuthGuard
│       ├── login.tsx              # Email + password login
│       ├── dashboard.tsx          # Main dashboard
│       ├── deliveries.tsx         # Delivery management
│       ├── drivers.tsx            # Driver management
│       ├── carriers.tsx           # Carrier management
│       ├── verifications.tsx      # KYC verification queue
│       ├── disputes.tsx           # Dispute handling
│       ├── analytics.tsx          # Platform metrics
│       ├── settings.tsx           # Admin settings
│       └── mfa/
│           ├── enroll.tsx         # MFA setup (QR code + verify)
│           └── verify.tsx         # MFA challenge (enter TOTP code)
├── components.json                # shadcn CLI config
├── package.json
├── react-router.config.ts         # SPA mode (ssr: false)
├── tsconfig.json
└── vite.config.ts                 # Tailwind + path aliases
```

## Routes

| Path | Auth Required | Description |
|------|:---:|-------------|
| `/login` | No | Email + password sign in |
| `/mfa/enroll` | Partial (AAL1) | First-time MFA setup |
| `/mfa/verify` | Partial (AAL1) | TOTP code entry |
| `/` | Yes (AAL2) | Dashboard overview |
| `/deliveries` | Yes (AAL2) | Manage deliveries |
| `/drivers` | Yes (AAL2) | Manage drivers |
| `/carriers` | Yes (AAL2) | Manage carriers |
| `/verifications` | Yes (AAL2) | KYC verification queue |
| `/disputes` | Yes (AAL2) | Handle disputes |
| `/analytics` | Yes (AAL2) | Platform metrics |
| `/settings` | Yes (AAL2) | Admin configuration |

## Sidebar

Uses the **shadcn/ui sidebar-07** block — a collapsible icon sidebar with:

- **Team switcher** header (SureWaka branding)
- **Collapsible nav groups** with sub-items (Operations, Fleet, Support, Settings)
- **Quick-access projects** section
- **User menu** footer with avatar + dropdown (sign out)
- **Keyboard shortcut**: `Ctrl+B` / `Cmd+B` to toggle
- **Rail**: drag edge to collapse/expand
- **Mobile**: sheet-based drawer

## Adding New Routes

1. Create route file in `app/routes/`
2. Add to `app/routes.ts` inside the layout group
3. Add nav item in `app/components/app-sidebar.tsx` (either in `navMain` or `projects`)
4. Add breadcrumb title in `app/routes/layout.tsx` `routeTitles` map

## Adding shadcn Components

```bash
npx shadcn@latest add <component> --cwd apps/admin
```

The `components.json` is configured with the correct aliases.
