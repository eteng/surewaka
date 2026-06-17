# ADR-008: Postgres Trigger on auth.users for Email Sync

## Status

Accepted

## Context

Customers update their email via `supabase.auth.updateUser({ email })`, which sends a verification link and only commits the new email to `auth.users` once confirmed. The customer profile is stored in `public.users.email`. These two need to stay in sync — but only after verification.

Three options were considered:

1. **Trigger on `auth.users`** — a `SECURITY DEFINER` function fires on UPDATE, writes confirmed email to `public.users.email` automatically.
2. **Client syncs on next session** — after confirmation, the app detects the confirmed email at next launch and writes it to `public.users`.
3. **Independent fields** — `public.users.email` is written directly by the app without Supabase Auth verification (email used as optional contact detail, not verified).

## Decision

Use a Postgres AFTER UPDATE trigger on `auth.users` that syncs a newly confirmed email to `public.users.email`.

## Rationale

- **Auth is the right owner of verification.** Supabase Auth already manages the entire email confirmation flow. The trigger just observes its output — it doesn't re-implement verification.
- **No client involvement.** Option 2 requires the app to be opened after verification; if the user verifies on desktop but doesn't reopen the app, `public.users.email` would lag. The trigger fires regardless of client state.
- **`public.users.email` only ever holds confirmed data.** Option 3 would let unverified emails appear as profile data, which is misleading and could cause issues if email is later used for notifications.
- **The trigger is narrow and safe.** Condition: `email_confirmed_at IS NOT NULL AND (email or email_confirmed_at changed)`. If no matching `public.users` row exists, it no-ops — no error, no orphan.

## Consequences

**Positive:**
- Email sync is automatic and reliable — no client timing dependency
- `public.users.email` is always a verified email address
- Works even if verification happens outside the app (webmail, desktop)

**Negative:**
- Triggers on `auth.users` are in the `auth` schema — less visible than application code
- `SECURITY DEFINER` functions require care; the `search_path` must be pinned to prevent search path injection
- Supabase may update `auth.users` structure in future versions; the trigger needs to be reviewed on Supabase upgrades

## When to Revisit

If Supabase introduces a native webhook or database hook mechanism that's more observable than triggers on the `auth` schema.
