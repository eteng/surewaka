# ADR-003: Supabase over Neon for Backend Services

## Status

Accepted

## Context

Need a managed PostgreSQL provider plus auth, file storage, and realtime capabilities for a logistics platform launching in Nigeria.

## Decision

Use Supabase as the backend services layer (Postgres + Auth + Storage + Realtime). Continue using Drizzle ORM for all database queries (bypass PostgREST).

## Rationale

- **Phone OTP auth** — Nigerian users expect SMS verification. Supabase Auth supports this natively.
- **File storage** — KYC document uploads (driver licenses, vehicle photos) without wiring S3.
- **Realtime** — delivery tracking via WebSocket subscriptions on DB changes, no extra infra.
- **Speed to ship** — one provider for auth + storage + realtime vs. wiring 3 separate services.
- **Still just Postgres** — Drizzle ORM connects directly. No vendor lock-in on the data layer.

## Performance Notes

- Query latency is identical to Neon (~5-15ms warm) — both are managed Postgres.
- Closest region to Nigeria: EU (Frankfurt). Expect ~120ms network hop from Lagos.
- The Nigeria-EU network hop dominates total latency, not the DB provider choice.
- Use `prepare: false` in postgres.js config for Supabase's PgBouncer pooling.
- Use `DATABASE_POOL_URL` (port 6543) for server queries, `DATABASE_URL` for migrations.

## Future Performance Optimizations (when needed)

1. Redis (Upstash) for hot data — driver locations, delivery status cache
2. Edge caching for static content
3. Move infra closer to West Africa when providers offer it (AWS Cape Town as interim)
4. Supabase Realtime Broadcast for high-frequency driver location pings (no DB write)

## Consequences

**Positive:**
- Auth, storage, realtime in days instead of weeks
- Single dashboard for DB + auth + storage management
- Generous free tier for early development

**Negative:**
- Coupled to Supabase for auth/storage (DB itself is portable)
- No African region yet (EU Frankfurt is closest)
- Service role key must be carefully guarded (bypasses RLS)

## Migration Path

If we outgrow Supabase:
- Database: connection string swap to any Postgres (Neon, RDS, self-hosted)
- Auth: migrate to custom auth (Better Auth) — requires user migration
- Storage: swap to Cloudflare R2 or S3
- Realtime: replace with Ably, Pusher, or custom WebSocket server
