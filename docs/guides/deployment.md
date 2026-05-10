# Deployment

## Strategy

| Service | Platform | Why |
|---------|----------|-----|
| Landing page | **Vercel** | CDN, preview URLs, SSR, free tier |
| Web app | **Vercel** | Same — SSR for Nigerian networks |
| Admin | **Vercel** | SPA mode, static hosting |
| API | **Fly.io** | Johannesburg region, Docker, always-on |
| Workers | **Fly.io** | Background processes, same infra as API |
| Database | **Supabase** | Managed Postgres + Auth + Storage + Realtime |
| Redis | **Upstash** | Serverless Redis, pay-per-request |

## Vercel Setup (Web Apps)

Each web app is a separate Vercel project pointing to the same GitHub repo.

### First-time setup

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. Set **Root Directory** to the app folder (e.g., `apps/landing`)
4. Vercel auto-detects Remix — no other config needed
5. Add environment variables if the app needs them
6. Deploy

### Per-app configuration

Each app has a `vercel.json` with build settings:

```json
{
  "framework": "remix",
  "installCommand": "pnpm install",
  "buildCommand": "pnpm --filter @surewaka/landing build",
  "outputDirectory": "build"
}
```

### Vercel projects to create

| Vercel Project | Root Directory | Domain |
|----------------|---------------|--------|
| surewaka-landing | `apps/landing` | surewaka.com |
| surewaka-web | `apps/web` | app.surewaka.com |
| surewaka-admin | `apps/admin` | admin.surewaka.com |

### CI/CD (automatic)

- **Push to main** → deploys to production
- **Open a PR** → creates a unique preview URL
- **No GitHub Actions needed** for web app deploys — Vercel handles it

### Custom domains

1. In Vercel project settings → Domains
2. Add your domain (e.g., `surewaka.com`)
3. Update DNS: add CNAME record pointing to `cname.vercel-dns.com`
4. SSL is automatic

## Fly.io Setup (API + Workers)

### First-time setup

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch API app
cd apps/api
fly launch --name surewaka-api --region jnb  # Johannesburg
```

### Deploy

```bash
fly deploy --config fly.toml
```

### Environment variables

```bash
fly secrets set DATABASE_URL="postgresql://..." REDIS_URL="redis://..." OPENAI_API_KEY="sk-..."
```

## Environment Variables

See `.env.example` for all required variables. Each environment needs:

| Variable | Used By | Required |
|----------|---------|----------|
| `SUPABASE_URL` | API, Workers | Yes |
| `SUPABASE_ANON_KEY` | Web apps, API | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | API, Workers | Yes (server only) |
| `DATABASE_URL` | API, Workers | Yes |
| `DATABASE_POOL_URL` | API, Workers | Yes |
| `REDIS_URL` | Workers | Yes |
| `OPENAI_API_KEY` | Agents | Yes |
| `PAYSTACK_SECRET_KEY` | Payment worker | Yes |
| `RESEND_API_KEY` | Email worker | Yes |

## Build Commands

```bash
# API
pnpm --filter @surewaka/api build

# Web apps (Vercel handles this, but for local testing)
pnpm --filter @surewaka/landing build
pnpm --filter @surewaka/web build
pnpm --filter @surewaka/admin build
```

## Docker (API — for Fly.io)

```bash
docker build -f infra/docker/Dockerfile.api -t surewaka-api .
docker run -p 4000:4000 --env-file .env.local surewaka-api
```

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR:
1. Install dependencies
2. Build all packages
3. Lint
4. Run tests

Web app deploys are handled by Vercel (not GitHub Actions).
API/worker deploys can be triggered via Fly.io GitHub Action or manual `fly deploy`.
