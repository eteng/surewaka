---
inclusion: always
description: SureWaka monorepo architecture, conventions, and coding standards for the logistics platform
---

# SureWaka Project Context

## Product

SureWaka is a logistics platform for Nigeria connecting senders with verified carriers and independent drivers. Two models on one platform: carrier aggregation (compare and book registered logistics companies) and on-demand matching (real-time driver matching for last-mile delivery). Initial market is SME e-commerce sellers and everyday senders in Lagos.

## Monorepo Structure

- **Build system**: Turborepo + pnpm 9.x workspaces
- **Language**: TypeScript everywhere (target ES2022, strict mode, bundler module resolution)
- **Node**: >=22 (use `nvm use` — `.nvmrc` is in repo root)
- **Package prefix**: `@surewaka/` for all internal packages

| Directory | Purpose |
|-----------|---------|
| `apps/web` | Customer-facing app (React Router v7, SSR, port 3000) |
| `apps/admin` | Internal admin dashboard (React Router v7, SPA mode) |
| `apps/landing` | Marketing site (React Router v7, SSR) |
| `apps/mobile-customer` | Customer mobile app (Expo / React Native) |
| `apps/mobile-driver` | Driver mobile app (Expo / React Native) |
| `apps/api` | REST API (Hono, port 4000) |
| `packages/shared` | Domain types, Zod validators, constants |
| `packages/ui` | Shared UI components (shadcn/ui pattern) |
| `packages/db` | Database schema and client (Drizzle ORM + Supabase Postgres) |
| `packages/supabase` | Supabase client (auth, storage, realtime) |
| `packages/ai` | LLM client abstraction (Vercel AI SDK) |
| `packages/mobile-shared` | Shared RN components, hooks, stores |
| `agents/*` | AI agents (customer-support, onboarding, internal-ops) |
| `workers/*` | Background workers (email, payment, agent, cron) |
| `infra/` | Docker, Terraform, dev scripts |

## Code Style

- Prettier: single quotes, semicolons, trailing commas, 100 char print width, 2-space indent
- Format command: `pnpm format`
- Use `cn()` utility (clsx + tailwind-merge) for conditional class names
- Prefer named exports; use default exports only for route components

## Frontend Conventions

- React Router v7 in framework mode with file-based routing via `app/routes.ts`
- Route files export `loader`, `action`, and a default component
- Path alias: `~/*` maps to `./app/*`
- Styling: Tailwind CSS v4 with `@theme` directive in `app.css` for design tokens
- Primary brand color: green (`#16a34a`)
- UI components follow shadcn/ui patterns using CVA (class-variance-authority) for variants
- Icons: lucide-react
- Vite plugin: `@tailwindcss/vite` (not PostCSS)

## API Conventions

- Framework: Hono with `@hono/node-server`
- Middleware: CORS and logger enabled globally
- Auth: Supabase JWT via `requireAuth` middleware (`apps/api/src/middleware/auth.ts`)
- Route prefix: `/api/v1`
- Validation: Zod schemas from `@surewaka/shared`
- Response shape: `{ data, error, meta }`
- Health check at `GET /health`

## Database & Backend Services (Supabase)

- **Postgres**: Hosted on Supabase, queried via Drizzle ORM (not PostgREST)
- **Auth**: Supabase Auth (phone OTP, email, OAuth) — `@surewaka/supabase`
- **Storage**: Supabase Storage for KYC docs, profile images, delivery photos
- **Realtime**: Supabase Realtime for delivery tracking (postgres_changes + broadcast)
- Schema location: `packages/db/src/schema.ts`
- Client: `packages/db/src/client.ts` (uses `prepare: false` for PgBouncer)
- IDs: UUID with `defaultRandom()`
- Timestamps: `created_at` and `updated_at` columns on all tables
- Enums defined with `pgEnum` (e.g., `user_role`, `delivery_status`, `vehicle_type`)
- Use `DATABASE_POOL_URL` for server queries, `DATABASE_URL` for migrations
- **NEVER use `drizzle-kit push`** — Supabase is the migration source of truth

Schema change workflow:
1. `supabase migration new <name>` — creates the migration file
2. `supabase migration fetch --yes` — syncs locally
3. `supabase gen types --linked > packages/db/src/types.ts` — regenerate types
4. Keep `packages/db/src/schema.ts` (Drizzle) in sync manually

## AI Agents

- Built with Vercel AI SDK (`generateText` with tool-based architecture)
- Provider abstraction in `packages/ai` supports OpenAI and Anthropic
- System prompts stored as `.md` files in each agent's `prompts/` directory
- Shared tools live in `agents/shared/tools/`
- Conversation memory in `agents/shared/memory/`
- Agents use `maxSteps` for multi-turn tool use

## Validation & Types

- Domain types: `packages/shared/src/types.ts`
- Zod schemas: `packages/shared/src/validators.ts`
- Constants/enums: `packages/shared/src/constants.ts`
- Keep types and validators in sync with the DB schema

## Commands

```bash
pnpm dev                                    # Start all services
pnpm build                                  # Build all packages
pnpm --filter @surewaka/web dev             # Start customer web app
pnpm --filter @surewaka/api dev             # Start API server
pnpm --filter @surewaka/db db:studio        # Open Drizzle Studio (read-only inspection)
docker compose -f infra/docker/docker-compose.yml up -d  # Local DB/Redis
```

## Key Rules

- Never import directly between apps; share code through `packages/*`
- All cross-package types flow through `@surewaka/shared`
- New UI components go in `packages/ui/src/` using the shadcn/ui pattern (CVA + cn utility)
- App-specific components that won't be reused go in `apps/{app}/app/components/`
- Zod schemas are the single source of truth for request validation
- Environment variables are loaded from `.env.*local` files (see `turbo.json` globalDependencies)
- Use `createServerClient` (with user JWT) for user-scoped queries; `createServiceClient` only in workers/admin ops
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client
