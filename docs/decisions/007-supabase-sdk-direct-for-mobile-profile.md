# ADR-007: Supabase SDK Direct (No API Layer) for Customer Mobile Profile

## Status

Accepted

## Context

The admin portal's profile feature routes all mutations through `apps/api` (Hono routes → profile service → Drizzle ORM). The customer mobile app needs profile read/write too. The question: should the mobile app go through the same API, or hit Supabase directly?

The customer mobile app already uses the Supabase JS SDK for auth (`supabase.auth.*`) and for checking profile existence (`supabase.from('users').select(...)`). The `authenticated` role already has `SELECT` and `UPDATE` grants on `public.users`, and RLS restricts operations to the user's own row.

## Decision

The customer mobile app reads and writes profile data directly via the Supabase JS SDK — no API layer for profile operations.

## Rationale

- **RLS is the authorization layer.** The DB already enforces that a user can only read/write their own row. The API layer adds no additional security — it would just proxy the same JWT.
- **Fewer moving parts.** No API route, no service class, no HTTP round-trip. One less failure point.
- **Existing precedent in the app.** The auth store already calls `supabase.from('users')` for profile existence checks. Profile operations are a natural extension.
- **Admin complexity is justified; customer complexity isn't.** The admin profile has a name-change approval workflow that requires service-role writes, MFA checks, and admin endpoints — those genuinely need an API layer. Customer profile edits are simple user-scoped updates with no cross-user logic.

## Consequences

**Positive:**
- Faster to build and test — no API route scaffolding
- Lower latency — one fewer network hop (mobile → Supabase directly vs. mobile → API → Supabase)
- Keeps the API surface smaller

**Negative:**
- If profile logic ever needs server-side business rules (e.g., rate limiting name changes, audit logging), those can't be added without introducing an API route at that point
- Direct SDK pattern diverges from the admin portal's API-mediated pattern — future contributors must understand both approaches exist

## When to Revisit

If customer profile mutations require server-side logic that can't be expressed as RLS policies (e.g. sending a notification on name change, enforcing a cooldown, writing to a second table atomically).
