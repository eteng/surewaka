# Workers

Background workers handle async tasks and scheduled operations. All workers run on Fly.io in the London region, co-located with the API and database.

## Worker Types

| Worker | Directory | Purpose | Schedule |
|--------|-----------|---------|----------|
| Cron | `workers/cron/` | Scheduled recurring tasks | Various (see below) |
| Email | `workers/email-worker/` | Transactional email delivery | Event-driven (queue) |
| Payment | `workers/payment-worker/` | Payment processing, payouts | Event-driven (queue) |
| Agent | `workers/agent-worker/` | AI agent execution | Event-driven (queue) |

## Cron Workers

### Registered Jobs (`workers/cron/src/index.ts`)

| Job | Frequency | Status |
|-----|-----------|--------|
| `checkStaleDeliveries` | Every 5 minutes | Planned |
| `refreshDriverAvailability` | Every hour | Planned |
| `generateDailyReport` | Daily at midnight | Planned |
| `weeklyDriverSummary` | Weekly | Planned |

### Standalone Cron Scripts

These run as independent processes on a schedule (Fly.io machine or external scheduler):

#### `compute-customer-segments.ts`

**Path:** `workers/cron/compute-customer-segments.ts`
**Schedule:** Daily at 01:00 UTC (02:00 WAT)
**Purpose:** Computes customer activity tiers and health scores for the admin customer listing.

**What it does:**
1. Queries all users with `role = 'customer'`
2. Aggregates delivery stats per customer (total deliveries, total spend, last delivery date, primary city)
3. Assigns a tier based on activity rules:
   - **Power**: ≥20 deliveries AND last delivery within 30 days
   - **Regular**: 5–19 deliveries AND last delivery within 30 days
   - **New**: <5 deliveries AND account created within 30 days
   - **Dormant**: No delivery in 30+ days
4. Calculates a health score (0–100) using RFM weighting:
   - Recency (40%): days since last delivery
   - Frequency (30%): delivery count percentile
   - Monetary (30%): spend percentile
5. Upserts results into the `customer_segments` table (batch of 500)

**Schema:** `packages/db/src/schema/customer-segments.ts`

**Run manually:**

```bash
npx tsx workers/cron/compute-customer-segments.ts
```

**Environment required:** `DATABASE_URL`

**Output example:**

```
[compute-customer-segments] Starting nightly segment computation...
[compute-customer-segments] Processed 500/1234
[compute-customer-segments] Processed 1000/1234
[compute-customer-segments] Processed 1234/1234
[compute-customer-segments] Done. 1234 customers segmented in 2340ms
[compute-customer-segments] Tier distribution: { power: 45, regular: 312, new: 567, dormant: 310 }
```

**Deploy as scheduled Fly.io machine:**

```bash
# Create a one-off machine that runs on a cron schedule
flyctl machine run . \
  --app surewaka-workers \
  --schedule "0 1 * * *" \
  --config workers/fly.toml \
  --entrypoint "npx tsx workers/cron/compute-customer-segments.ts"
```

## Adding a New Worker

### Standalone cron script (no queue)

1. Create the script in `workers/cron/<name>.ts`
2. Import `db` from `@surewaka/db`
3. Write a `main()` function that does the work
4. Call `main().catch(...)` at the end
5. Add documentation to this file
6. Deploy via Fly.io scheduled machine or external cron trigger

### Queue-based worker (BullMQ)

1. Create a new directory `workers/<name>-worker/`
2. Add `package.json` with `@surewaka/db` and `bullmq` dependencies
3. Create the processor in `src/index.ts`
4. Register the queue name in the publisher (API or other worker)
5. Add Dockerfile if needed, deploy to Fly.io

## Running Workers Locally

```bash
# All workers (via docker compose)
docker compose -f infra/docker/docker-compose.yml up -d

# Individual cron script
npx tsx workers/cron/compute-customer-segments.ts

# Cron worker (registered jobs)
pnpm --filter @surewaka/cron dev
```

## Monitoring

- **Fly.io logs**: `flyctl logs --app surewaka-workers`
- **Machine status**: `flyctl machine list --app surewaka-workers`
- All workers log to stdout with `[worker-name]` prefix for easy filtering
