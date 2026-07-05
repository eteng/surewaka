# Migration: Neon Postgres to London (aws-eu-west-2)

## Why

Moving from `aws-eu-central-1` (Frankfurt) to `aws-eu-west-2` (London) to co-locate
with Fly.io API (lhr region). London has better submarine cable connectivity to
Lagos (~80ms vs ~100ms from Frankfurt).

## Prerequisites

- Neon account access
- Current `DATABASE_URL` from `.env`
- Drizzle migrations in `packages/db/drizzle/`

## Steps

### 1. Create new Neon project in London

1. Go to [Neon Console](https://console.neon.tech)
2. Click **New Project**
3. Settings:
   - Name: `surewaka-production` (or `surewaka-london`)
   - Region: **AWS Europe (London) — aws-eu-west-2**
   - Postgres version: Same as current (16+)
4. Copy the new connection string

### 2. Apply schema to new project

```bash
# Set the new DATABASE_URL temporarily
export DATABASE_URL="<new-london-connection-string>"

# Push schema directly (since this is a fresh database)
pnpm --filter @surewaka/db db:push
```

### 3. Migrate data (if any)

If you have production data to move:

```bash
# Export from old project
pg_dump "<old-frankfurt-connection-string>" \
  --data-only \
  --no-owner \
  --no-privileges \
  -f surewaka-data.sql

# Import to new project
psql "<new-london-connection-string>" < surewaka-data.sql
```

For early-stage with minimal data, you can skip this and start fresh.

### 4. Update environment variables

Update `DATABASE_URL` in:
- `.env` (local development — keep pointing to dev branch)
- Fly.io secrets: `flyctl secrets set DATABASE_URL="<new-url>" --app surewaka-api`
- Vercel env vars (if any web app connects directly — shouldn't for this architecture)

### 5. Verify

```bash
# Test connection
pnpm --filter @surewaka/db db:studio

# Run API locally against new DB
pnpm --filter @surewaka/api dev
```

### 6. Clean up

- Delete the old Frankfurt Neon project (or keep as backup for 7 days)
- Update `.env.example` with a note about the expected region

## Rollback

If something goes wrong, revert `DATABASE_URL` to the old Frankfurt connection string.
The old project remains active until you explicitly delete it.

## Post-migration

- [ ] Verify Drizzle Studio connects
- [ ] Verify API health check passes
- [ ] Verify mobile app can authenticate and fetch data
- [ ] Delete old Neon project after 7 days of stability
