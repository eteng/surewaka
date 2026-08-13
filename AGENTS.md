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

## Mobile Development (Expo + EAS)

All native builds go through **EAS Build** — never use `npx expo run:android/ios` locally.

```bash
# Development build (when native deps change — new native module added, SDK upgrade, etc.)
cd apps/mobile-customer
eas build --profile development --platform android

# Production build
eas build --profile production --platform android
```

**When a new dev client build is required:**
- Adding a native module (e.g., `@react-native-community/netinfo`, new Expo module)
- Upgrading Expo SDK
- Changing `app.json` plugins
- Modifying `expo-build-properties`

**When a new build is NOT required (JS-only changes):**
- Adding pure JS/TS packages
- Changing React components, hooks, stores
- Updating API client code
- Modifying shared packages (`packages/mobile-shared`, `packages/shared`)

**Day-to-day development:**
1. Run `pnpm --filter @surewaka/mobile-customer dev` (starts Metro bundler)
2. Open the dev client on device (already installed from last EAS build)
3. JS changes hot-reload instantly — no rebuild needed

**Native module location:** Native modules must be in the **app's** `package.json` (e.g., `apps/mobile-customer/package.json`), not in shared packages. Shared packages can import them at the JS level — Expo autolinking resolves native code from the app's dependency tree.

**OTA Updates (no build needed):**
```bash
eas update --branch preview --message "description of changes"
```

## Actor Simulator

Test the app as a real customer on your own phone while every other actor —
on-demand drivers, carrier intercity legs — is played by headless bots
calling the real, auth-guarded API (no mock auth, no direct-write shortcuts).
See `.kiro/specs/actor-simulator/` for the full design.

```bash
# 1. pnpm dev running (API + workers + Redis/Postgres)
# 2. Point mobile-customer at your laptop's LAN IP / Expo tunnel
pnpm sim:actors -- --drivers 5 --carriers 1 --speed 5 --accept-rate 0.9
```

Bot identities (`bot+driver-N@example.com` / `bot+carrier-N@example.com`) are
created/topped-up/reactivated automatically before the bots start — no
separate seed step needed. To manage them directly:

```bash
pnpm --filter @surewaka/api seed:bot-actors -- --drivers 5 --carriers 1
pnpm --filter @surewaka/api seed:bot-actors -- --reset   # deactivates all bots
```

`--reset` deactivates (revokes role, deactivates drivers/carrier_members row)
rather than deleting — bot `users` rows can never actually be deleted once
they've had a role assigned (`role_audit_log`'s FK), and revoking is fully
reversible: the next non-`--reset` run reactivates them automatically.

Dev-only: both scripts refuse to run if `NODE_ENV=production` or
`CLERK_SECRET_KEY` looks like a live key (`sk_live_...`).

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
