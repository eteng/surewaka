# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker (for local PostgreSQL and Redis)

## Setup

```bash
# Clone and install
git clone <repo-url> surewaka
cd surewaka
pnpm install

# Start local databases
docker compose -f infra/docker/docker-compose.yml up -d

# Create environment file
cp .env.example .env.local
# Edit .env.local with your API keys

# Push database schema
pnpm --filter @surewaka/db db:push

# Start all services
pnpm dev
```

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Web | http://localhost:3000 | Customer-facing app |
| Admin | http://localhost:3001 | Backoffice panel |
| Landing | http://localhost:3002 | Marketing site |
| API | http://localhost:4000 | Backend API |
| Drizzle Studio | http://localhost:4983 | Database browser |

## Common Tasks

### Add a new API route

1. Create route file in `apps/api/src/routes/`
2. Define Zod schema in `packages/shared/src/validators.ts`
3. Import and mount in `apps/api/src/index.ts`

### Add a new page (web app)

1. Create route file in `apps/web/app/routes/`
2. Register in `apps/web/app/routes.ts`
3. Export `loader`, `action` (if needed), and default component

### Add a shared UI component

1. Create component in `packages/ui/src/`
2. Use CVA for variants, `cn()` for class merging
3. Export from `packages/ui/src/index.ts`

### Add a database table

1. Define table in `packages/db/src/schema.ts`
2. Add corresponding type in `packages/shared/src/types.ts`
3. Run `pnpm --filter @surewaka/db db:push`
