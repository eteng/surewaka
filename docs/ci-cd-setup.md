# CI/CD & Environment Setup Guide

This document covers the one-time setup needed to make the CI/CD pipelines work.

## Overview

| Environment | Trigger | API App | Workers App | DB Branch |
|-------------|---------|---------|-------------|-----------|
| Preview | PR with `packages/db/**` changes | — | — | `preview/pr-{N}` (ephemeral) |
| Staging | Auto on merge to `main` | `surewaka-api-staging` | `surewaka-workers-staging` | `staging` |
| Production | Manual `workflow_dispatch` | `surewaka-api` | `surewaka-workers` | `main` |

---

## 1. Fly.io Apps

Create the staging and worker apps using `flyctl launch`. Run from the repo root:

```bash
# Staging API
flyctl launch \
  --name surewaka-api-staging \
  --region lhr \
  --org surewaka \
  --no-deploy \
  --copy-config \
  --dockerfile infra/docker/Dockerfile.api \
  --internal-port 4000 \
  --yes

# Staging Workers
flyctl launch \
  --name surewaka-workers-staging \
  --region lhr \
  --org surewaka \
  --no-deploy \
  --dockerfile infra/docker/Dockerfile.workers \
  --yes

# Production Workers (if not already created)
flyctl launch \
  --name surewaka-workers \
  --region lhr \
  --org surewaka \
  --no-deploy \
  --dockerfile infra/docker/Dockerfile.workers \
  --yes
```

Key flags:
- `--no-deploy` — creates the app without building/deploying immediately
- `--region lhr` — London, co-located with Neon
- `--yes` — skip interactive prompts
- `--copy-config` — uses the existing fly.toml as starting point

### Set secrets on each app:

```bash
# --- Staging API ---
flyctl secrets set \
  DATABASE_URL="<neon-staging-branch-connection-string>" \
  CLERK_SECRET_KEY="sk_test_..." \
  ABLY_API_KEY="..." \
  REDIS_URL="..." \
  PAYSTACK_SECRET_KEY="sk_test_..." \
  RESEND_API_KEY="re_..." \
  R2_ENDPOINT="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="surewaka-private-staging" \
  --app surewaka-api-staging

# --- Staging Workers ---
flyctl secrets set \
  DATABASE_URL="<neon-staging-branch-connection-string>" \
  REDIS_URL="..." \
  PAYSTACK_SECRET_KEY="sk_test_..." \
  RESEND_API_KEY="re_..." \
  OPENAI_API_KEY="sk-..." \
  ANTHROPIC_API_KEY="sk-ant-..." \
  --app surewaka-workers-staging

# --- Production Workers ---
flyctl secrets set \
  DATABASE_URL="<neon-main-connection-string>" \
  REDIS_URL="..." \
  PAYSTACK_SECRET_KEY="sk_live_..." \
  RESEND_API_KEY="re_..." \
  OPENAI_API_KEY="sk-..." \
  ANTHROPIC_API_KEY="sk-ant-..." \
  --app surewaka-workers
```

---

## 2. Neon Database Branches

### Create the `staging` branch:

In Neon Console → your project → Branches → Create Branch:
- **Name**: `staging`
- **Parent**: `main`
- **Include data**: Yes (copy-on-write from production)

Or via CLI:
```bash
neonctl branches create --project-id <PROJECT_ID> --name staging --parent main
```

The `staging` branch connection string goes into the staging Fly app secrets and GitHub environment secrets.

### Preview branches

These are created/deleted automatically by the `preview-db.yml` workflow. No manual setup needed.

---

## 3. Secrets Management (Doppler + GitHub)

### Architecture

Runtime secrets (DATABASE_URL, CLERK, PAYSTACK, etc.) live in **Doppler** and auto-sync to Fly.io. GitHub only holds deploy tokens — never database or payment credentials.

```
Doppler (source of truth for runtime secrets)
  ├── surewaka-api
  │     ├── dev       → local dev (via `doppler run`)
  │     ├── stg       → auto-syncs to Fly (surewaka-api-staging)
  │     └── prd       → auto-syncs to Fly (surewaka-api)
  └── surewaka-workers
        ├── stg       → auto-syncs to Fly (surewaka-workers-staging)
        └── prd       → auto-syncs to Fly (surewaka-workers)

GitHub (deploy tokens only)
  ├── Repository secrets: NEON_API_KEY, TURBO_TOKEN
  ├── Repository variables: NEON_PROJECT_ID, TURBO_TEAM
  ├── staging environment: FLY_API_TOKEN
  └── production environment: FLY_API_TOKEN
```

### GitHub Environments

Go to **Settings → Environments** in the GitHub repo and create:

#### `staging` environment
- No protection rules (deploys automatically on merge)
- **Secrets:**
  - `FLY_API_TOKEN` — Fly.io org token for deploy (`flyctl tokens create org --org surewaka --name "GitHub CI" --expiry 8760h`)

#### `production` environment
- **Protection rules:**
  - Required reviewers (add yourself / team leads)
  - Optional: wait timer (e.g., 5 minutes)
- **Secrets:**
  - `FLY_API_TOKEN` — same org token, or a separate one for production

#### Repository-level secrets & variables (shared across workflows):
- **Secrets:**
  - `NEON_API_KEY` — Neon API key (for branch create/delete/reset)
  - `TURBO_TOKEN` — Turborepo remote cache token
- **Variables:**
  - `NEON_PROJECT_ID` — `fancy-smoke-79910922`
  - `TURBO_TEAM` — Turborepo team slug

### Why this split?

- **Doppler** holds secrets with real blast radius (DB access, payment processing, auth keys). Even if GitHub is breached, attackers only get deploy tokens — not your data.
- **GitHub** holds only `FLY_API_TOKEN` (can deploy code but can't read secrets) and `NEON_API_KEY` (can create/delete branches but not query data).

### Local Development

Use Doppler to inject secrets locally instead of `.env` files:

```bash
# One-time setup (links this directory to the surewaka-api dev config)
doppler setup --project surewaka-api --config dev

# Run any command with secrets injected
doppler run -- pnpm --filter @surewaka/api dev

# Or run all services
doppler run -- pnpm dev
```

---

## 4. Vercel Configuration

### Environment variable scoping

In Vercel dashboard, for each project (web, admin, landing), set variables per environment:

| Variable | Preview | Production |
|----------|---------|------------|
| `VITE_API_URL` / `API_URL` | `https://surewaka-api-staging.fly.dev` | `https://api.surewaka.com` |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...` | `pk_live_...` |

### Manual promotion to production

Since we want manual Vercel production deploys:

1. In Vercel project settings → **Git** → disable "Auto-deploy" for the production branch
2. Use **Vercel CLI** or **Promote** in the dashboard to push a preview deployment to production:
   ```bash
   vercel promote <deployment-url> --scope surewaka
   ```
3. Alternatively, use Vercel's **"Promote to Production"** button on any successful preview deployment

> **Note:** Vercel preview deployments still happen automatically on every push. Only the production promotion is gated.

---

## 5. GitHub Branch Protection

Go to **Settings → Branches → Add rule** for `main`:

- [x] Require pull request before merging
- [x] Require status checks to pass (select the `quality` job from CI)
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings
- [ ] Require approvals (optional for solo dev, enable when team grows)

---

## 6. Cloudflare R2 Staging Bucket

Create a separate bucket for staging to avoid mixing test uploads with production:

```bash
# Via Cloudflare dashboard or Wrangler CLI
wrangler r2 bucket create surewaka-private-staging
```

---

## Workflow Reference

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | PR + push to main | Lint, test, build (quality gate) |
| `preview-db.yml` | PR touching `packages/db/**` | Create/delete Neon branch, run migrations, post schema diff |
| `deploy-staging.yml` | Push to main | Deploy API + workers to staging, run migrations |
| `deploy-production.yml` | Manual (type "deploy") | Deploy API + workers to production, run migrations |
| `reset-staging-db.yml` | Manual (type "reset") | Reset staging DB from production snapshot |

---

## Day-to-Day Flow

1. Create feature branch from `main`
2. Open PR → CI runs, Neon preview branch created (if DB changes), Vercel preview deployed
3. Review, iterate, approve
4. Merge → staging auto-deploys (API + workers + migrations + Vercel preview)
5. QA on staging
6. When ready: trigger "Deploy Production" workflow → type "deploy" → production updated
7. Promote Vercel deployment via dashboard or CLI
