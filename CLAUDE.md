# SureWaka — Claude Code Guide

> Eteng & Yobo | Nigeria Logistics Marketplace

---

## Product

SureWaka connects senders with verified logistics providers and independent drivers across Nigeria. Two models: **carrier aggregation** (compare and book registered companies like GIG, DHL) and **on-demand matching** (real-time driver dispatch for last-mile). We don't own vehicles — we build the technology layer: booking, matching, payments, KYC, ratings.

**Primary market:** SME e-commerce sellers and everyday senders in Lagos.  
**Revenue:** Commission per delivery + service coordination + premium fees.  
**Goal:** Lagos launch → 3 more Nigerian cities Year 1 → 520K users + 22K driver partners by Year 3.

---

## Absolute Rules

1. **Never import directly between apps.** Share through `packages/*`. All cross-package types via `@surewaka/shared`.
2. **Database-first schema workflow.** Supabase is the migration source of truth. The flow for any schema change is:
   1. Create the migration file: `supabase migration new <name>`
   2. Write the SQL in `supabase/migrations/<timestamp>_<name>.sql`
   3. Stop — do not touch `packages/db/src/schema.ts`. That file is **generated**, not hand-edited.
   4. After the migration is applied to the database, the schema is regenerated with `pnpm --filter @surewaka/db db:pull`

   **Every migration that creates a new table must also include RLS setup in the same file:**
   - `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
   - A `service_role` bypass policy: `FOR ALL USING (auth.role() = 'service_role')`
   - Access policies for `authenticated` scoped to what users actually need (own rows, read-only catalog, etc.)
   - `GRANT` only the minimum privileges the `authenticated` role needs (`SELECT`, `INSERT`, etc.) — never grant INSERT/UPDATE/DELETE unless the client writes directly; API mutations go through service role

   Reference pattern: `supabase/migrations/20260603045850_fix_rls_and_grants_all_tables.sql`

   Never use `drizzle-kit push`, `drizzle-kit generate`, or `drizzle-kit migrate`. Never manually edit `packages/db/src/schema.ts`.
3. **Never read `.env`, `.env.local`, or `.env.*.local`.** Reference `.env.example` for structure only. (Kiro `block-env-reads` hook enforces this.)
4. **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.** Use `createServerClient` (user JWT) for user queries; `createServiceClient` only in workers/admin.
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
| `packages/db` | Drizzle ORM schema + client | — |
| `packages/supabase` | Supabase client (auth, realtime — storage is Cloudinary/R2 via `apps/api/src/lib/storage/`) | — |
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
- **Auth:** Supabase JWT via `requireAuth` middleware
- **Brand:** green `#16a34a`, icons via `lucide-react`

Full standards: `.kiro/steering/coding-standards.md`  
Frontend resilience: `.kiro/steering/frontend-resilience.md`  
Architecture patterns: `.kiro/steering/project-context.md`

---

## Deploy & CI

- **CI:** GitHub Actions on `main` — build → lint → test
- **Web/Admin/Landing:** Vercel auto-deploy on push to `main`
- **API + Workers:** Fly.io (Johannesburg region)
- **Supabase project ref:** `royfgnaiiexvpxapmcdh` (EU Frankfurt)

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
[x] Storage decoupled from Supabase (avatars → Cloudinary, private docs → Cloudflare R2)
[ ] Payment integration (Paystack flow)
[ ] Push notifications
[ ] Real-time tracking (Supabase Realtime, replacing 30s polling)
[ ] Production launch in Lagos
[ ] Seed funding closed
```

For active spec progress, check `.kiro/specs/*/tasks.md` directly — those are the authoritative task state.

## Known Issues / Tech Debt

- `packages/shared` test files have pre-existing type errors (missing RBAC validator exports) — source files are clean, only tests affected
- `packages/mobile-shared/src/maps/locationiq.ts` — `API_KEY` uses `?? ''` fallback; throws at runtime if env var is not set
- Real carrier data still mocked in `booking/carriers.tsx` — `GET /api/v1/carriers` endpoint exists but is not wired to the screen
- Mobile app requires an EAS development build — `@rnmapbox/maps` has native modules, Expo Go won't work

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
User field is the Supabase user UUID, or `-` for unauthenticated requests.

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
