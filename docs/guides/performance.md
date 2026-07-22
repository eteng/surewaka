# Performance Notes

## Current Architecture Latency

```
User in Lagos → API (Fly.io London) → NeonDB (London, aws-eu-west-2)
     ~120ms network hop                ~5-15ms query
     
Total round trip: ~250-300ms (acceptable for API calls)
```

The Nigeria-to-EU network hop dominates total latency. The database provider choice makes negligible difference (~5ms).

## Why This Is Acceptable for Launch

- 250ms API responses are fine for booking flows, listing carriers, checking status
- SSR (React Router) means pages render server-side — users see content fast even on 3G
- Ably Realtime uses persistent WebSocket — no repeated connection overhead for tracking

## What Matters More Than DB Choice

| Concern | Impact | Current Solution |
|---------|--------|-----------------|
| Page load on 3G | High | SSR via React Router (HTML streams immediately) |
| Delivery tracking | Medium | Ably Realtime (WebSocket, no polling) |
| Driver location updates | Medium | Ably Publish (no DB write per ping) |
| Image/doc uploads | Medium | Client-side compression before upload |
| API response times | Low-Medium | Connection pooling via NeonDB pooler |

## NeonDB Performance Config

```typescript
// packages/db/src/client.ts — uses neon-http driver for serverless contexts
// and neon-serverless WebSocket driver for long-lived connections
```

- NeonDB's built-in connection pooler handles pooling — use the pooled connection string for server queries
- Use the direct (non-pooled) connection string only for migrations

## When to Optimize (Not Now)

These optimizations are for when you hit scale (10k+ daily active users):

1. **Redis cache layer** (Upstash) — cache delivery status, driver availability, carrier quotes
2. **Edge caching** — static assets and API responses via Cloudflare
3. **Move API closer to users** — AWS Cape Town or when providers add West Africa regions
4. **Read replicas** — NeonDB supports read replicas for read-heavy queries
5. **Batch driver location writes** — aggregate location pings, write to DB every 10s instead of per-ping

## Don't Prematurely Optimize

At launch with <1000 users in Lagos:
- 250ms API calls are fine
- NeonDB free/Pro tier handles the load easily
- Focus on product-market fit, not shaving milliseconds
- Monitor with NeonDB metrics dashboard — optimize when you see actual bottlenecks
