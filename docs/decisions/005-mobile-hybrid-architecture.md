# ADR-005: Hybrid Supabase + API Architecture for Mobile Apps

## Status

Accepted

## Context

The mobile apps (customer and driver) need to communicate with backend services. We have two options: route everything through our Hono API, or use Supabase client SDK directly from the mobile apps for some operations. The web apps already use a hybrid approach — Supabase Auth directly, API for business logic.

## Decision

Use a **hybrid architecture** where mobile apps talk to both Supabase directly and our API server, depending on the operation type.

### Supabase Direct (from mobile)

| Feature | Why direct |
|---------|-----------|
| **Auth** (phone OTP, session) | SDK handles token refresh, secure storage, persistence natively. Reimplementing through API adds complexity for zero benefit. |
| **Realtime** (delivery tracking) | WebSocket directly to Supabase is lower latency than proxying through API. Postgres changes + broadcast channels. |
| **Storage** (POD photos, profile images) | Direct upload avoids API becoming a file proxy. Saves bandwidth and Fly.io egress costs. Uses signed URLs for security. |

### API Server (`apps/api`)

| Feature | Why API |
|---------|---------|
| **Business logic** | Booking, job acceptance, pricing calculation, driver matching |
| **Multi-step operations** | Anything touching multiple tables with validation rules |
| **Third-party integrations** | Payments (Paystack), SMS (Termii), routing (Google Maps) |
| **Admin operations** | Anything requiring service role access |
| **Aggregation queries** | Complex joins, analytics, search with filtering |

## Rationale

### Why not pure API (everything proxied)?

- Auth token refresh/persistence is complex to implement correctly — Supabase SDK does it for free
- Realtime WebSocket proxying adds a hop and a point of failure
- File uploads through API doubles bandwidth cost (mobile → API → Supabase Storage)
- The web apps already use this hybrid pattern — consistency across platforms

### Why not pure Supabase (no API)?

- Complex business logic in RLS policies becomes unmaintainable at scale
- Lose observability — harder to log, trace, and debug multi-step operations
- Payment/matching/routing logic doesn't belong in Postgres functions
- No good way to integrate third-party services from client-side without exposing keys
- Rate limiting and abuse prevention is easier at the API layer

### Security model

- Mobile apps only have the Supabase **anon key** (public, safe to embed)
- RLS policies enforce row-level access for direct Supabase operations
- API uses user's JWT (passed as Bearer token) for authenticated requests
- Service role key is **never** on mobile — only in workers and admin API routes

## Implementation

```typescript
// packages/mobile-shared/src/api/client.ts — for API calls
apiClient.post('/api/v1/deliveries', bookingData, token)
apiClient.post('/api/v1/jobs/accept', { jobId }, token)
apiClient.get('/api/v1/earnings', token)

// packages/mobile-shared/src/supabase/client.ts — for direct Supabase
supabase.auth.signInWithOtp({ phone })
supabase.channel('delivery:123').on('postgres_changes', ...)
supabase.storage.from('pod-photos').upload(filePath, file)
```

## Consequences

**Positive:**
- Consistent with web app architecture
- Best performance for auth, realtime, and file uploads
- API stays focused on business logic (not proxying)
- Lower Fly.io bandwidth costs

**Negative:**
- Two client libraries to maintain in mobile-shared (API client + Supabase client)
- Need to keep RLS policies in sync with API authorization logic
- Developers need to know which path to use for new features

## Decision Rule for New Features

Ask: "Does this operation need business logic, touch multiple tables, or call a third-party service?"
- **Yes** → Route through API
- **No, it's a simple read/write with RLS** → Consider Supabase direct
- **Auth, realtime, or file upload** → Always Supabase direct

## When to Revisit

- If RLS policies become too complex to maintain (move more to API)
- If Supabase introduces breaking changes to client SDK frequently
- If we need to support offline-first with conflict resolution (may need custom sync layer)
