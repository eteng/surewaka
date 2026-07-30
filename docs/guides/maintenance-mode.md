# Maintenance Mode — Operations Guide

## Overview

Maintenance mode allows the API to be intentionally taken offline for scheduled work (database migrations, infrastructure changes, deployments) while giving mobile and web clients a clear, branded "maintenance in progress" experience instead of generic errors.

When active:
- All API routes return `503` with `{ error: { code: 'MAINTENANCE' } }`
- `/health` returns `503` with `{ status: 'maintenance', eta: '...' }`
- Mobile apps show a full-screen maintenance screen with ETA
- Health poller keeps checking — when maintenance ends, apps auto-recover

## Activating Maintenance Mode

### On Fly.io (production)

```bash
# Basic — no ETA
flyctl secrets set MAINTENANCE_MODE=true --app surewaka-api

# With ETA (ISO 8601 timestamp)
flyctl secrets set MAINTENANCE_MODE=true MAINTENANCE_ETA="2026-07-30T09:00:00Z" --app surewaka-api

# With custom message
flyctl secrets set MAINTENANCE_MODE=true \
  MAINTENANCE_MESSAGE="We're upgrading our systems. Back in 30 minutes." \
  MAINTENANCE_ETA="2026-07-30T09:00:00Z" \
  --app surewaka-api
```

Fly.io restarts machines automatically when secrets change — no redeployment needed.

### In development (local)

Add to `.env.local`:
```
MAINTENANCE_MODE=true
MAINTENANCE_MESSAGE=Testing maintenance mode
MAINTENANCE_ETA=2026-07-30T10:00:00Z
```

Then restart the API: `pnpm --filter @surewaka/api dev`

## Deactivating Maintenance Mode

```bash
# Remove all maintenance secrets
flyctl secrets unset MAINTENANCE_MODE MAINTENANCE_MESSAGE MAINTENANCE_ETA --app surewaka-api

# Or just flip the flag (cleans up later)
flyctl secrets set MAINTENANCE_MODE=false --app surewaka-api
```

Machines restart → `/health` returns `200` → mobile apps auto-recover within 3-30 seconds (health poller interval).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAINTENANCE_MODE` | Yes | `undefined` (off) | Set to `"true"` to activate |
| `MAINTENANCE_MESSAGE` | No | "Scheduled maintenance in progress. Back shortly." | Custom message shown to users |
| `MAINTENANCE_ETA` | No | `null` | ISO 8601 timestamp for expected return (shown as formatted time in app) |

## What happens to clients

### Mobile apps (customer + driver)
1. Any API call → receives `503 MAINTENANCE` → shows full-screen MaintenanceScreen
2. Health poller starts (3s → 6s → 12s → 30s backoff) hitting `GET /health`
3. When `/health` returns `200` → maintenance screen auto-dismisses → app resumes normally

### Web apps (customer + admin)
- TBD: Add maintenance page detection in web API client

### External monitoring (UptimeRobot, Fly healthcheck)
- `/health` returns `503` during maintenance — uptime monitors will flag it
- If you don't want alerts: pause monitoring before activating maintenance

## Pre-Maintenance Checklist

1. [ ] Notify team in Slack/Discord
2. [ ] Set `MAINTENANCE_ETA` to a realistic time (users see this)
3. [ ] Verify maintenance mode works: `curl https://surewaka-api.fly.dev/health`
4. [ ] Confirm mobile app shows maintenance screen (test on a device)
5. [ ] Do your work
6. [ ] Verify API is healthy: `curl https://surewaka-api.fly.dev/health` → `200`
7. [ ] Deactivate maintenance mode
8. [ ] Confirm mobile app recovers automatically
9. [ ] Resume external monitoring

## API Behavior During Maintenance

| Endpoint | Response |
|----------|----------|
| `GET /health` | `503 { status: 'maintenance', message: '...', eta: '...' }` |
| Any other route | `503 { data: null, error: { code: 'MAINTENANCE', message: '...' }, meta: { eta: '...' } }` |
| Webhooks (Paystack, etc.) | Also blocked — ensure idempotent retry on their side |

## Important Notes

- **Webhooks**: External services (Paystack, Clerk) will receive 503 and retry. Make sure their retry window exceeds your maintenance duration.
- **Cron workers**: If cron workers call the API, they'll also get 503. They should handle this gracefully (retry next cycle).
- **No data loss**: Maintenance mode is a request-level gate — no database changes, no state corruption.
- **Zero downtime alternative**: For simple deployments, Fly.io's rolling deploys are better. Use maintenance mode only for breaking changes that require the API to be fully stopped (schema migrations, infra swaps).
