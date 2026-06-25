# SureWaka

> Move goods across Nigeria — reliably, affordably, instantly.

A technology-driven logistics platform connecting people and businesses with verified logistics providers and independent drivers.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Docker (for local DB)
corepack enable && corepack prepare pnpm@9.15.0 --activate

# Setup
chmod +x infra/scripts/dev-setup.sh
./infra/scripts/dev-setup.sh

# Or manually:
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d
cp .env.example .env.local
pnpm dev
```

## Project Structure

```
apps/           → User-facing applications
  web/          → Customer app (Remix + Vite, :3000)
  admin/        → Backoffice panel (Remix SPA mode, :3001)
  landing/      → Marketing site (Remix + SSR, :3002)
  mobile/       → Mobile app (Expo/React Native)
  api/          → Backend API (Hono, :4000)

packages/       → Shared libraries
  shared/       → Types, constants, validators (Zod)
  ui/           → shadcn/ui components + Tailwind
  db/           → Database schema (Drizzle + PostgreSQL)
  ai/           → LLM client utilities (Vercel AI SDK)

agents/         → AI agents
  customer-support/  → Customer-facing support bot
  onboarding/        → User onboarding assistant
  internal-ops/      → Internal data/ops agent
  shared/            → Shared tools, prompts, memory

workers/        → Background processors
  email-worker/     → Email notifications
  payment-worker/   → Paystack webhooks & payouts
  push-worker/      → Push notifications (Expo + BullMQ)
  agent-worker/     → Async AI agent tasks
  cron/             → Scheduled jobs

infra/          → Infrastructure & DevOps
  docker/       → Docker configs
  terraform/    → IaC (when needed)
  scripts/      → Dev & deploy scripts
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run all tests |
| `pnpm --filter @surewaka/web dev` | Start just the customer app |
| `pnpm --filter @surewaka/api dev` | Start just the API |
| `pnpm --filter @surewaka/worker-push dev` | Start push notification worker |
| `pnpm --filter @surewaka/db db:push` | Push DB schema |
| `pnpm --filter @surewaka/db db:studio` | Open Drizzle Studio |

## Tech Stack

- **Runtime**: Node.js 20, TypeScript 5.7
- **Monorepo**: Turborepo + pnpm
- **Web Framework**: React Router v7 (Remix) + Vite
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Mobile**: Expo (React Native)
- **API**: Hono
- **Database**: PostgreSQL + Drizzle ORM
- **AI**: Vercel AI SDK, OpenAI, Anthropic
- **Workers**: BullMQ + Redis
- **Payments**: Paystack
- **Deploy**: Railway / Fly.io (apps + API + workers)

## License

Private — All rights reserved.
