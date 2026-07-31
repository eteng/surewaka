# Production Database Compute Optimization

## Problem

Workers with persistent DB connections (alert-engine, cron, routing, matching) keep Neon compute alive 24/7 = ~720 hours/month. Free tier = 191.9 hrs. Scale plan = 750 hrs ($69/mo).

## Workers that prevent auto-suspend

| Worker | Pattern | Interval | Fix |
|--------|---------|----------|-----|
| Alert engine | `setInterval` every 60s | Permanent | Convert to cron-based (every 5 min) or use connection-per-tick |
| Cron worker | BullMQ persistent Pool | Permanent | Disconnect Pool between jobs |
| Routing worker | BullMQ persistent Pool | Permanent | Disconnect Pool between jobs |
| Matching worker | BullMQ persistent Pool | Permanent | Disconnect Pool between jobs |

## Solutions to evaluate

### Option A: Connection-per-query (most savings)
- Workers use `neon-http` (stateless) instead of `Pool` for their queries
- No persistent connection → Neon suspends between requests
- Downside: no transaction support (fine for read-only alert checks, not for escrow operations)

### Option B: Pool disconnect between jobs
- After each BullMQ job completes, call `pool.end()`
- Reconnect on next job
- Keeps transaction support, lets Neon suspend during idle periods
- Downside: cold start latency on each job (~500ms)

### Option C: Move alert-engine to cron
- Instead of `setInterval(60s)`, register as a BullMQ repeating job (`*/1 * * * *`)
- Runs within the cron worker (one less process)
- Connection only active during the tick (~2-5s every minute)
- Neon might still not suspend (59s gap < 5 min threshold)... need `*/5 * * * *` minimum

### Option D: Hybrid — local neon-http for reads, Pool for writes
- Alert engine (read-only checks) → `neon-http` (no connection held)
- Routing/matching (transactions) → `Pool` but only during job execution
- Best of both worlds

### Option E: Accept the cost
- Scale plan $69/mo covers 750 hrs (enough for 24/7)
- Simplest, no code changes
- Re-evaluate when cost becomes a concern

## Recommended path

1. **Now**: Use local Postgres for dev (done ✅)
2. **Pre-launch**: Convert alert-engine from setInterval to BullMQ cron job (Option C, every 5 min)
3. **At launch**: Start on Launch plan ($19/mo) — production traffic is intermittent, workers not always-on yet
4. **Post-launch**: If compute exceeds plan, implement Option D (http for reads, Pool for writes)

## Related

- `workers/alert-engine/src/index.ts` — the 60s setInterval
- `packages/db/src/client.ts` — auto-detects Neon vs local
- Neon pricing: https://neon.tech/pricing
