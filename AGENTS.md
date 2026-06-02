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
| `pnpm --filter @surewaka/db db:studio` | Drizzle Studio (read-only) |

## Database (Schema Changes)

```bash
supabase migration new <name>           # 1. Create migration
supabase migration fetch --yes          # 2. Sync locally
supabase gen types --linked > packages/db/src/types.ts  # 3. Regen types
# 4. Update packages/db/src/schema.ts manually to match
```

Supabase project ref: `royfgnaiiexvpxapmcdh` (EU Frankfurt)

## Type Checking

```bash
pnpm --filter @surewaka/mobile-customer exec tsc --noEmit
pnpm --filter @surewaka/mobile-shared exec tsc --noEmit
pnpm --filter @surewaka/api exec tsc --noEmit
```

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
