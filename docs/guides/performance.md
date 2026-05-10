# Performance Notes

## Current Architecture Latency

```
User in Lagos → API (Railway EU) → Supabase Postgres (EU Frankfurt)
     ~120ms network hop              ~5-15ms query
     
Total round trip: ~250-300ms (acceptable for API calls)
```

The Nigeria-to-EU network hop dominates total latency. The database provider choice (Supabase vs Neon vs RDS) makes negligible difference (~5ms).

## Why This Is Acceptable for Launch

- 250ms API responses are fine for booking flows, listing carriers, checking status
- SSR (Remix) means pages render server-side — users see content fast even on 3G
- Supabase Realtime uses persistent WebSocket — no repeated connection overhead for tracking

## What Matters More Than DB Choice

| Concern | Impact | Current Solution |
|---------|--------|-----------------|
| Page load on 3G | High | SSR via Remix (HTML streams immediately) |
| Delivery tracking | Medium | Supabase Realtime (WebSocket, no polling) |
| Driver location updates | Medium | Supabase Broadcast (no DB write per ping) |
| Image/doc uploads | Medium | Client-side compression before upload |
| API response times | Low-Medium | Connection pooling via PgBouncer |

## Supabase-Specific Performance Config

```typescript
// packages/db/src/client.ts
const client = postgres(connectionString, {
  prepare: false, // Required for PgBouncer (Supabase pooling)
});
```

- Always use `DATABASE_POOL_URL` (port 6543) for server queries
- Use `DATABASE_URL` (port 5432) only for migrations (direct connection)
- Supabase's PgBouncer handles connection pooling — don't pool on your side

## When to Optimize (Not Now)

These optimizations are for when you hit scale (10k+ daily active users):

1. **Redis cache layer** (Upstash) — cache delivery status, driver availability, carrier quotes
2. **Edge caching** — static assets and API responses via Cloudflare
3. **Move API closer to users** — AWS Cape Town or when providers add West Africa regions
4. **Read replicas** — Supabase supports read replicas on Pro plan for read-heavy queries
5. **Batch driver location writes** — aggregate location pings, write to DB every 10s instead of per-ping

## Don't Prematurely Optimize

At launch with <1000 users in Lagos:
- 250ms API calls are fine
- Supabase free/Pro tier handles the load easily
- Focus on product-market fit, not shaving milliseconds
- Monitor with Supabase Dashboard metrics — optimize when you see actual bottlenecks
