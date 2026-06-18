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
| `packages/db` | Database schema and client (Drizzle ORM + Neon Postgres) |
| `packages/auth` | Auth verification and user management (Clerk) |
| `packages/realtime` | Realtime pub/sub abstraction (Ably provider, swappable to CF DO) |
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
- Middleware: CORS and request logger enabled globally (`apps/api/src/middleware/logging.ts`)
- Auth: Clerk JWT via `requireAuth` middleware (`apps/api/src/middleware/auth.ts`)
- Route prefix: `/api/v1`
- Validation: Zod schemas from `@surewaka/shared`
- Response shape: `{ data, error, meta }`
- Health check at `GET /health`

### API Log Files (dev only)

When `NODE_ENV !== 'production'`, the API writes daily-rotating logs to `logs/api/` at the repo root. Files are kept for 14 days then pruned automatically.

| Path | Format | Contains |
|------|--------|----------|
| `logs/api/access/YYYY-MM-DD.log` | Apache Combined + `ms` | Every request |
| `logs/api/error/YYYY-MM-DD.log` | JSON (one object per line) | ≥400 responses and thrown exceptions |

Error log fields: `time`, `level` (`warn`/`error`/`fatal`), `method`, `path`, `status`, `ms`, `userId`, `ip`, `ua`, and for fatals: `error` + `stack`.

To investigate a problem: read the error log first (small, targeted), then cross-reference the access log by `time` for surrounding context.

## Database (Neon Postgres)

- **Host**: Neon (serverless Postgres, AWS eu-central-1)
- **Driver**: `@neondatabase/serverless` via Drizzle ORM `neon-http` adapter
- **Schema location**: `packages/db/src/schema/` — one file per table
- **Client**: `packages/db/src/client.ts`
- **IDs**: UUID with `defaultRandom()`
- **Timestamps**: `created_at` and `updated_at` columns on all tables
- **Enums**: defined with `pgEnum` in `packages/db/src/schema/enums.ts`
- **Connection**: Single `DATABASE_URL` env var (Neon handles pooling)

### Schema change workflow (Drizzle-first):

```bash
# 1. Edit schema file(s) in packages/db/src/schema/
# 2. Generate migration SQL
pnpm --filter @surewaka/db db:generate
# 3. Apply migration to Neon
pnpm --filter @surewaka/db db:migrate
```

For initial setup or rapid prototyping, `db:push` applies schema directly without generating a migration file.

### Schema structure:

```
packages/db/src/schema/
├── index.ts              (barrel re-export)
├── enums.ts              (all pgEnums)
├── users.ts
├── user-roles.ts
├── role-audit-log.ts
├── carriers.ts           (carriers + carrier_members)
├── drivers.ts
├── deliveries.ts
├── escrow-holds.ts
├── wallets.ts            (wallets + wallet_transactions)
├── payout-requests.ts
├── addresses.ts          (saved + recent locations)
├── name-change-requests.ts
├── notifications.ts
└── waitlist.ts
```

## Auth (Clerk)

- **Provider**: Clerk (phone OTP, email/password, Google OAuth)
- **Package**: `packages/auth` — `verifyToken()`, `getClerkClient()`, `AuthUser` type
- **API middleware**: `requireAuth` verifies Clerk session tokens from `Authorization: Bearer <token>`
- **Role storage**: Clerk `publicMetadata.roles` array (synced from `user_roles` table)
- **Mobile**: `@clerk/expo` SDK
- **Web**: `@clerk/react-router` SDK
- **Env vars**: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`

## Realtime (Ably)

- **Provider**: Ably (free tier: 6M messages/mo, 200 concurrent connections)
- **Package**: `packages/realtime` — provider abstraction for future migration to CF Durable Objects
- **Patterns**:
  - `delivery:${deliveryId}` — status updates (API publishes after DB mutation)
  - `driver-location:${driverId}` — driver location broadcasts (high frequency, no DB write)
- **Server-side**: `getRealtime().publish(channel, event, data)` from API route handlers
- **Client-side**: `subscribe(channel, event, callback)` in mobile/web apps
- **Env var**: `ABLY_API_KEY`

## Storage

- **Cloudinary**: Public images (avatars)
- **Cloudflare R2**: Private documents (KYC docs, delivery photos)
- **Integration**: `apps/api/src/lib/storage/`

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
pnpm --filter @surewaka/db db:studio        # Open Drizzle Studio
pnpm --filter @surewaka/db db:generate      # Generate migration from schema changes
pnpm --filter @surewaka/db db:migrate       # Apply pending migrations to Neon
docker compose -f infra/docker/docker-compose.yml up -d  # Local Redis
```

## Key Rules

- Never import directly between apps; share code through `packages/*`
- All cross-package types flow through `@surewaka/shared`
- New UI components go in `packages/ui/src/` using the shadcn/ui pattern (CVA + cn utility)
- App-specific components that won't be reused go in `apps/{app}/app/components/`
- Zod schemas are the single source of truth for request validation
- Environment variables are loaded from `.env` files (see `turbo.json` globalDependencies)
- Auth is handled entirely in the API layer (Clerk JWT verification in Hono middleware)
- No RLS on the database — authorization logic lives in application code
- Never expose `CLERK_SECRET_KEY` to the client
