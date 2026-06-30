# SureWaka — Commands Reference

## Quick Start

```bash
nvm use          # Node 24 (.nvmrc)
pnpm install
cp .env.example .env.local
docker compose -f infra/docker/docker-compose.yml up -d
pnpm dev
```

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start all services (turbo) |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint all |
| `pnpm test` | Test all |
| `pnpm format` | Prettier write |
| `pnpm --filter @surewaka/web dev` | Customer web app (:3000) |
| `pnpm --filter @surewaka/admin dev` | Admin dashboard (:3001) |
| `pnpm --filter @surewaka/landing dev` | Landing site (:3002) |
| `pnpm --filter @surewaka/api dev` | API server (:4000) |
| `pnpm --filter @surewaka/mobile-customer dev` | Mobile customer (Expo) |
| `pnpm --filter @surewaka/worker-push dev` | Push worker (push notifications, :4001 health) |
| `pnpm --filter @surewaka/db db:studio` | Drizzle Studio |

## Workers (Cron / Background)

| Command | What it does |
|---------|-------------|
| `npx tsx workers/cron/compute-customer-segments.ts` | Run customer segmentation (nightly cron) |
| `pnpm --filter @surewaka/cron dev` | Start cron worker (registered jobs) |

See `docs/guides/workers.md` for full documentation.

## Database (Schema Changes)

**Schema-first.** Drizzle schema files are the source of truth. Neon Postgres is the host.

```bash
# 1. Edit the schema
#    packages/db/src/schema/<table>.ts

# 2. Generate a migration
pnpm --filter @surewaka/db db:generate

# 3. Apply the migration
pnpm --filter @surewaka/db db:migrate

# For initial setup or prototyping (pushes schema directly, no migration file):
pnpm --filter @surewaka/db db:push
```

Schema lives in `packages/db/src/schema/` — one file per table/domain entity.

## Type Checking

```bash
pnpm --filter @surewaka/mobile-customer exec tsc --noEmit
pnpm --filter @surewaka/mobile-shared exec tsc --noEmit
pnpm --filter @surewaka/api exec tsc --noEmit
```

## Deployment

| Target | Platform | Region | Command |
|--------|----------|--------|---------|
| Web apps | Vercel | Auto (edge) | Auto-deploy on push to main |
| API | Fly.io | London (lhr) | `flyctl deploy --config apps/api/fly.toml` |
| Workers | Fly.io | London (lhr) | `flyctl deploy --config workers/fly.toml` |
| Database | Neon Postgres | London (aws-eu-west-2) | Managed |

```bash
# Deploy API manually
flyctl deploy --config apps/api/fly.toml

# Set a secret on Fly
flyctl secrets set DATABASE_URL="..." --app surewaka-api

# Check API logs
flyctl logs --app surewaka-api

# SSH into running machine
flyctl ssh console --app surewaka-api
```

Auto-deploy: Push to `main` triggers `.github/workflows/deploy-api.yml`

## Git — Two Remotes

```bash
git push origin <branch> && git push personal <branch>
```

`origin` → github.com/surewaka/surewaka | `personal` → github.com/eteng/surewaka

## Kiro Hooks (active)

- **block-env-reads** — blocks reading `.env*` files
- **sync-notion-progress** — prompts Notion update on session end
- **update-notion-task** — prompts Notion update after spec task completion

## Notion

Database ID: `collection://34fbbd69-ff4a-815e-957e-000b081ef0b7` ("Master Task Hub")
Engineering tasks → Workstream: **Tech**
