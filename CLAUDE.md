# SureWaka — Claude Code Guide

---

## Product

SureWaka connects senders with verified logistics providers and independent drivers across Nigeria, using a **multi-leg delivery model**: a delivery is composed of one or more legs — `first_mile`, `intercity`, `last_mile` — each served by either **on-demand dispatch** (SureWaka's own drivers; first/last-mile only) or a **carrier** (registered companies like GIG, DHL; intercity only — carriers never do first/last-mile). Customers choose in-city on-demand, a specific carrier's fixed intercity route, or end-to-end "SureWaka way" auto-routing, where the system picks the cheapest path across carrier routes — possibly chaining more than one intercity leg when no direct route exists (routing/path-optimization engine not yet specced). See `CONTEXT.md` for the full leg/actor-type glossary and `docs/decisions/009-carrier-vs-ondemand-pricing-model.md` for how pricing splits across leg types. We don't own vehicles — we build the technology layer: booking, matching, pricing, payments, KYC, ratings.

**Primary market:** SME e-commerce sellers and everyday senders in Lagos.  
**Revenue:** Commission per delivery + service coordination + premium fees.  
**Goal:** Lagos launch → 3 more Nigerian cities Year 1 → 520K users + 22K driver partners by Year 3.

---

## Absolute Rules

1. **Never import directly between apps.** Share through `packages/*`. All cross-package types via `@surewaka/shared`.
2. **Database-first schema workflow.** NeonDB (Postgres, London — `aws-eu-west-2`) is the database. Drizzle ORM is the schema source of truth. The flow for any schema change is:
   1. Edit the relevant file in `packages/db/src/schema/` (one file per table, e.g. `deliveries.ts`)
   2. Generate a migration: `pnpm --filter @surewaka/db db:generate`
   3. Apply it: `pnpm --filter @surewaka/db db:migrate`
   4. For local dev iteration, `pnpm --filter @surewaka/db db:push` applies directly without creating a migration file

   Schema files in `packages/db/src/schema/` are **hand-maintained** — this directory is the authoritative source. Generated migration files in `packages/db/drizzle/` are committed to git.

   **No RLS policies** — all DB access goes through the Hono API using the service-level `DATABASE_URL`. Authorization is enforced at the API layer.

   The legacy `supabase/` directory has been removed. All schema management is via Drizzle ORM in `packages/db/src/schema/`.
3. **Never read `.env`, `.env.local`, or `.env.*.local`.** Reference `.env.example` for structure only. (Kiro `block-env-reads` hook enforces this.)
4. **Auth is Clerk.** Session tokens are verified by `requireAuth` middleware in the API layer. Roles stored in Clerk `publicMetadata.roles` (synced from `user_roles` DB table). Mobile: `@clerk/expo`. Web: `@clerk/react-router`. Never expose `CLERK_SECRET_KEY` to the client. `packages/auth` provides `verifyToken()`, `getClerkClient()`, `AuthUser` type.
5. **Zod schemas are the single source of truth** for validation — keep in sync with DB schema.

---

## Feature Development Workflow

When Et asks to build or change something, use this decision tree:

### Create a kiro spec when:
- The feature touches 3+ files or requires new UI flows
- API contracts or DB schema change
- Work spans multiple sessions (tracked in Notion)
- Requirements are ambiguous or need alignment first

### Code directly when:
- Bug fix < ~50 lines, or isolated refactor without behavior change
- Config, dependency, or env update
- Adding one endpoint or one component to an already-specced feature
- Requirements are fully clear and scope is tight

### Kiro spec format
Create at `.kiro/specs/<feature-name>/` with these four files:

```
requirements.md   # User stories in WHEN/THEN format with acceptance criteria
tasks.md          # Numbered checkbox implementation plan (bottom-up: schema → logic → UI)
design.md         # Architecture decisions, data models, component structure
.config.kiro      # {"specId": "<uuid>", "workflowType": "requirements-first", "specType": "feature"}
```

**Before implementing any feature:** check if a spec already exists in `.kiro/specs/`. If it does, read `tasks.md` and pick up from the first unchecked task.

### When a feature request comes in without a spec:
1. Ask: does this need a spec (per criteria above)?
2. If yes — draft `requirements.md` first, get alignment, then `tasks.md`, then code
3. If no — state the scope clearly, then code

---

## Git Workflow

- **Branch naming:** `feat/<short-name>`, `fix/<issue-or-description>`, `chore/<name>`
- **Commits:** atomic and imperative mood — `"add waitlist schema"` not `"added schema changes"`
- **PRs:** link the Notion task, squash if ≤ 3 commits, rebase if more
- **Two remotes:** always push both:
  ```bash
  git push origin <branch> && git push personal <branch>
  ```
- **Draft PRs** for work in progress; mark ready when CI passes

---

## Monorepo at a Glance

**Build:** Turborepo + pnpm 9.x | **Node:** >=22 (`nvm use`) | **Prefix:** `@surewaka/`

| Directory | Purpose | Port |
|-----------|---------|------|
| `apps/web` | Customer web app (React Router v7, SSR) | 3000 |
| `apps/admin` | Ops dashboard (React Router v7, SPA) | 3001 |
| `apps/landing` | Marketing site (React Router v7, SSR) | 3002 |
| `apps/api` | REST API (Hono) | 4000 |
| `apps/mobile-customer` | Customer mobile (Expo/RN) | — |
| `apps/mobile-driver` | Driver mobile (Expo/RN) | — |
| `packages/shared` | Domain types, Zod validators, constants | — |
| `packages/ui` | shadcn/ui components + Tailwind | — |
| `packages/db` | Drizzle ORM schema + Neon client | — |
| `packages/auth` | Clerk auth verification + user types | — |
| `packages/realtime` | Realtime pub/sub abstraction (Ably) | — |
| `packages/ai` | LLM client (Vercel AI SDK) | — |
| `packages/mobile-shared` | Shared RN components/hooks | — |
| `agents/*` | AI agents (customer-support, onboarding, internal-ops) | — |
| `workers/*` | Background workers (email, payment, agent, cron) | — |

Commands, setup, and DB workflow: see `AGENTS.md`.

---

## Code Conventions

- **TypeScript:** strict mode, `type` over `interface`, `unknown` not `any`
- **Exports:** named preferred; default only for route components
- **Files:** kebab-case files, PascalCase components
- **Prettier:** single quotes, semicolons, trailing commas, 100 char width
- **Frontend:** `cn()` for class names; Tailwind v4 `@theme` directive; path alias `~/*` → `./app/*`
- **API:** routes under `/api/v1/`, response shape `{ data, error, meta }`, Zod validation
- **Auth:** Clerk JWT via `requireAuth` middleware (from `packages/auth`)
- **Brand:** green `#16a34a`, icons via `lucide-react`

Full standards: `.kiro/steering/coding-standards.md`  
Frontend resilience: `.kiro/steering/frontend-resilience.md`  
Architecture patterns: `.kiro/steering/project-context.md`

---

## Deploy & CI

- **CI:** GitHub Actions on `main` — build → lint → test
- **Web/Admin/Landing:** Vercel auto-deploy on push to `main`
- **API + Workers:** Fly.io (London — `lhr` region)
- **Database:** NeonDB `aws-eu-west-2` (London) — `DATABASE_URL` in env
- **Auth:** Clerk (EU region) — `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` in env

---

## Task Tracking — Notion

- Database: `collection://34fbbd69-ff4a-815e-957e-000b081ef0b7` ("Master Task Hub")
- Engineering tasks → Workstream: **"Tech"**
- On start: Status → "In Progress" | On finish: Status → "Done", Complete → "__YES__"
- Kiro hooks `sync-notion-progress` and `update-notion-task` prompt updates automatically

---

## Product Decisions — Google Sheet

Sheet ID: `1XtFLm_vPAW_rq1KBpHQxmAKmSNt1E2fvjXsLPs1TT-M`

Write to the sheet when a product decision, insight, or feature scope is worth preserving:
- New idea → `Ideas` | Agreed requirement → `Requirements` | Decision made → `Decisions`
- Market/competitor insight → `Analysis` | Good but premature → `Parking Lot`

Check before writing — never duplicate existing entries.

---

## Current State

```
[x] Tech stack + monorepo scaffold
[x] Mobile customer app (booking, maps, tracking, auth)
[x] Admin dashboard (user management, RBAC)
[x] API — carrier aggregation endpoints
[x] Landing page (waitlist, campaign pages)
[x] Storage (avatars → Cloudinary, private docs → Cloudflare R2)
[x] Auth migrated to Clerk (from Supabase Auth)
[x] Database migrated to NeonDB (from Supabase Postgres)
[x] Realtime via Ably (from Supabase Realtime)
[x] Payment integration (Paystack flow) — wallet-first + escrow, see ADR-006
[x] Push notifications — spec complete (17/17); extend push-triggers.ts per-feature as new notification types are needed
[x] Alert system (ops monitoring engine) — 7 rules live in workers/alert-engine (spec 39/47, core loop functional)
[x] Multi-leg pricing / fee engine — spec complete (68/68 tasks); fee engine, quote lifecycle, vehicle-type multipliers, weight correction, admin rate maintenance all implemented
[ ] Intercity routing / path optimization — not yet specced; prerequisite for "SureWaka way" auto-routed multi-hop delivery
[ ] Production launch in Lagos
[ ] Seed funding closed
```

For active spec progress, check `.kiro/specs/*/tasks.md` directly — those are the authoritative task state.

## Known Issues / Tech Debt

- `packages/shared` test files have pre-existing type errors (missing RBAC validator exports) — source files are clean, only tests affected
- `packages/mobile-shared/src/maps/locationiq.ts` — `API_KEY` uses `?? ''` fallback; throws at runtime if env var is not set
- `booking/carriers.tsx`'s "Instant Match" on-demand option still shows a hardcoded `₦3,000` and `review.tsx` has a hardcoded `350000` kobo total — these were placeholders pending the fee engine (now implemented via `.kiro/specs/pricing-transparency/`), but the mobile UI wiring to the live quote API has not been verified end-to-end on device
- Mobile app requires an EAS development build — `@rnmapbox/maps` has native modules, Expo Go won't work
- Finance ledger: any future admin-initiated cancellation or refund route that bypasses the existing cancel (`booking-payment.ts`) and payment-worker refund flows must wire `writeLedgerEvent` for `commission_reversal` if escrow was already released. The current cancel endpoint is safe (delivered deliveries are non-cancellable, so commission can't have been earned yet), but this constraint must be preserved when admin override cancellation is built.

---

## API Logs (dev only)

File logging is active whenever `NODE_ENV !== 'production'`. Files live at `logs/api/` in the repo root, partitioned by day so each file is at most 24 hours of traffic.

```
logs/api/
  access/YYYY-MM-DD.log   ← every request, Apache Combined format + ms
  error/YYYY-MM-DD.log    ← only ≥400 responses and thrown exceptions, one JSON line each
```

**Access log format** (Apache Combined + response-time extension):
```
41.200.x.x - <userId|-> [07/Jun/2026:14:22:11 +0000] "POST /api/v1/wallet/topup HTTP/1.1" 200 842 "-" "okhttp/4.12.0" 45ms
```
User field is the Clerk user ID, or `-` for unauthenticated requests.

**Error log format** (one JSON object per line):
```json
{"time":"2026-06-07T14:22:11Z","level":"error","method":"POST","path":"/api/v1/wallet/topup","status":500,"ms":45,"userId":"abc123","ip":"41.200.x.x","ua":"okhttp/4.12.0","error":"Cannot read properties of undefined","stack":"Error: ..."}
```
`level` is `"warn"` for 4xx, `"error"` for 5xx, `"fatal"` for thrown exceptions (includes `error` + `stack` fields).

**How to investigate an issue:**
1. Read `logs/api/error/YYYY-MM-DD.log` first — each line is a self-contained JSON error record.
2. Cross-reference with `logs/api/access/YYYY-MM-DD.log` for the full request context around that time.
3. Use the `time` field to correlate across both files.
4. Files older than 14 days are deleted automatically on API startup.

---

## Claude's Role

Active **engineering partner and co-founder thinking partner** — not a yes-machine.

**When building:**
- Check `.kiro/specs/` before starting any feature — pick up existing specs at first unchecked task
- Read `.kiro/steering/` before touching unfamiliar areas
- Update Notion when starting and completing work
- Follow the spec + git workflow above, not your own defaults

**When thinking:**
- Challenge assumptions; push back when something doesn't add up
- Surface contradictions between product goals and technical trade-offs
- Keep decisions grounded in the Nigerian market context (network constraints, pricing sensitivity, Lagos-first)
- Write product decisions to the Google Sheet; write engineering tasks to Notion

---

## Instruction Sources

| File | For | Purpose |
|------|-----|---------|
| `CLAUDE.md` | Claude Code | This file — primary guide, self-contained, always loaded |
| `AGENTS.md` | Both | Commands cheatsheet only — quick reference for dev commands |
| `.kiro/specs/` | Both | Active feature specs — always check before implementing |
| `.kiro/steering/project-context.md` | Kiro IDE | Architecture + conventions (Kiro's always-loaded context) |
| `.kiro/steering/coding-standards.md` | Kiro IDE | TypeScript, API, DB, AI agent standards (Kiro's always-loaded context) |
| `.kiro/steering/frontend-resilience.md` | Kiro IDE | Error boundaries, async states, form resilience, Sentry, 404 pages (loaded when `.tsx` files in context) |
| `.kiro/steering/notion-tasks.md` | Kiro IDE | Notion integration details (Kiro's always-loaded context) |
| `docs/architecture.md` | Both | System architecture and data flows |
| `docs/decisions/` | Both | Architecture Decision Records |
