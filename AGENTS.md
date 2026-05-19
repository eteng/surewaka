# SureWaka — Agent Instructions

## Quick Start

```bash
nvm use          # Node 24 (.nvmrc), NOT 20
pnpm install
cp .env.example .env.local   # fill real keys
docker compose -f infra/docker/docker-compose.yml up -d   # local Postgres + Redis
pnpm dev         # starts all apps via turbo
```

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start all services (turbo) |
| `pnpm build` | Build all packages (turbo, dependsOn ^build) |
| `pnpm lint` | Lint all (turbo, dependsOn ^build) |
| `pnpm test` | Test all (turbo, dependsOn ^build) |
| `pnpm format` | Prettier write |
| `pnpm --filter @surewaka/web dev` | Customer web app only (:3000) |
| `pnpm --filter @surewaka/api dev` | API only (:4000) |
| `pnpm --filter @surewaka/db db:studio` | Open Drizzle Studio |

## Architecture

**Monorepo**: Turborepo + pnpm workspaces. Four workspace roots: `apps/*`, `packages/*`, `agents/*`, `workers/*`.

| Directory | Purpose |
|-----------|---------|
| `apps/web` | Customer web app (React Router v7 SSR, :3000) |
| `apps/admin` | Ops dashboard (React Router v7 SPA, :3001) |
| `apps/landing` | Marketing site (React Router v7 SSR, :3002) |
| `apps/api` | REST API (Hono, :4000) |
| `apps/mobile-customer` | Customer mobile (Expo/RN) |
| `apps/mobile-driver` | Driver mobile (Expo/RN) |
| `packages/shared` | Domain types, Zod validators, constants |
| `packages/ui` | shadcn/ui components + Tailwind |
| `packages/db` | Drizzle ORM schema + client |
| `packages/supabase` | Supabase client (auth, storage, realtime) |
| `packages/ai` | LLM client (Vercel AI SDK) |
| `packages/mobile-shared` | Shared RN components/hooks |
| `agents/*` | AI agents (prompts, tools, memory) |
| `workers/*` | Background workers (email, payment, agent, cron) |

**Key rule**: Never import directly between apps. Share code through `packages/*`. All cross-package types flow through `@surewaka/shared`.

## Database — Critical Workflow

**Supabase is the source of truth.** Do NOT use `drizzle-kit push` or `db:push` for schema changes.

```bash
# Correct workflow for schema changes:
# 1. Create + apply migration via Supabase MCP or CLI
supabase migration new <name>
# 2. Sync locally
supabase migration fetch --yes
# 3. Regenerate types
supabase gen types --linked > packages/db/src/types.ts
# 4. Keep packages/db/src/schema.ts (Drizzle) in sync manually
# 5. Check for missing RLS policies via Supabase advisors
```

- Use `DATABASE_URL` for migrations, `DATABASE_POOL_URL` for server queries
- Supabase project ref: `royfgnaiiexvpxapmcdh` (EU Frankfurt)
- All tables: UUID `id` (via `defaultRandom()`), `created_at`, `updated_at`
- Drizzle client uses `prepare: false` for PgBouncer compatibility

## Code Conventions (differ from defaults)

- **TypeScript**: strict mode, prefer `type` over `interface`, no `any` (use `unknown` + narrow)
- **Exports**: named exports preferred; default exports only for route components
- **Files**: kebab-case (`lookup-delivery.ts`), PascalCase for React components
- **Prettier**: single quotes, semicolons, trailing commas, 100 char print width
- **Frontend**: `cn()` utility (clsx + tailwind-merge) for conditional classes; Tailwind v4 with `@theme` directive; path alias `~/*` → `./app/*`
- **API**: Hono, routes under `/api/v1/`, Zod validation, response shape `{ data, error, meta }`
- **Auth**: Supabase JWT via `requireAuth` middleware; `createServerClient` (user JWT) for user-scoped queries, `createServiceClient` only in workers/admin

## Environment

- Env vars loaded from `.env.*local` files (see `turbo.json` globalDependencies)
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client
- Never read `.env`, `.env.local`, or `.env.*.local` files — reference `.env.example` for structure
- Kiro hook `block-env-reads` enforces this at tool level

## CI / Deploy

- **CI**: GitHub Actions on `main` — `pnpm build` → `pnpm lint` → `pnpm test`
- **Web apps** (landing, web, admin): Vercel auto-deploy on push to `main`
- **API + Workers**: Fly.io (Johannesburg region)
- **Two remotes**: `origin` → github.com/surewaka/surewaka (canonical), `personal` → github.com/eteng/surewaka (Vercel deploys)
- Push to both: `git push origin main && git push personal main`

## Instruction Sources

| File | Purpose |
|------|---------|
| `.kiro/steering/project-context.md` | Architecture, conventions, commands (primary) |
| `.kiro/steering/coding-standards.md` | TypeScript, API, DB, AI agent standards |
| `.kiro/steering/notion-tasks.md` | Notion Master Task Hub integration |
| `CLAUDE.md` | Startup ideation doc (Google Sheet workflow) — may be stale |
| `product.md` | Product overview |

## Kiro Hooks (active)

- **block-env-reads**: Blocks reading `.env*` or secret files
- **sync-notion-progress**: Prompts Notion task update on session end
- **update-notion-task**: Prompts Notion update after spec task completion

## Notion Task Tracking

- Database: "Master Task Hub" (`collection://34fbbd69-ff4a-815e-957e-000b081ef0b7`)
- Engineering tasks → Workstream: "Tech"
- Starting: Status → "In Progress"; Completing: Status → "Done", Complete → "__YES__"
