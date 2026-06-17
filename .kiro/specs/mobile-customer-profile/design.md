# Design: Mobile Customer Profile

## Overview

The customer profile feature wires the existing profile UI shells (`(tabs)/profile.tsx`, `profile/edit.tsx`, `profile/settings.tsx`) to real data. All reads and writes go directly through the Supabase JS SDK — no API layer. The Supabase `authenticated` role already has `SELECT` and `UPDATE` grants on `public.users`, and RLS restricts operations to the user's own row.

Email changes are the exception: they flow through Supabase Auth's built-in verification, then a Postgres trigger syncs the confirmed result to `public.users.email`.

See ADR-007 (SDK direct, no API layer) and ADR-008 (auth trigger for email sync).

## Architecture

```
(tabs)/profile.tsx          profile/edit.tsx         profile/settings.tsx
        │                         │                         │
        └──────────────┬──────────┘                         │
                       │                                    │
              useCustomerProfile (hook)────────────────────┘
                       │
              Supabase JS SDK
              ┌────────┴────────┐
     supabase.from('users')   supabase.auth.updateUser()
              │                         │
       public.users              auth.users ──trigger──▶ public.users.email
```

## Data Model Changes

### Migration 1 — Gender column

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender text
  CHECK (gender IN ('woman', 'man', 'prefer_not_to_disclose'));
```

No RLS change needed — existing UPDATE policy (`auth.uid() = id`) already covers this column.

### Migration 2 — Email sync trigger

```sql
CREATE OR REPLACE FUNCTION public.sync_confirmed_email_to_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email_confirmed_at IS NOT NULL
     AND (
       OLD.email IS DISTINCT FROM NEW.email
       OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at
     )
  THEN
    UPDATE public.users
    SET email = NEW.email, updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_auth_email_to_users ON auth.users;
CREATE TRIGGER sync_auth_email_to_users
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_confirmed_email_to_users();
```

## File Structure

```
apps/mobile-customer/app/
├── hooks/
│   └── use-customer-profile.ts       NEW — all profile fetch + mutation logic
├── (tabs)/
│   └── profile.tsx                   MODIFY — use hook, real data, pending email badge
├── profile/
│   ├── edit.tsx                      MODIFY — save name/email/gender, email pending state
│   └── settings.tsx                  MODIFY — wire notification toggles to DB

packages/shared/src/
└── validators.ts                     MODIFY — add GENDER_VALUES + customerProfileUpdateSchema

supabase/migrations/
├── <ts>_add_gender_to_users.sql      NEW
└── <ts>_auth_email_sync_trigger.sql  NEW
```

## `useCustomerProfile` Hook Interface

```typescript
type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: 'woman' | 'man' | 'prefer_not_to_disclose' | null;
  notificationEmail: boolean;
  notificationSms: boolean;
  pendingEmail: string | null;   // from session user.new_email
};

type UseCustomerProfile = {
  profile: CustomerProfile | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateName: (name: string) => Promise<{ error: string | null }>;
  updateEmail: (email: string) => Promise<{ error: string | null }>;
  updateGender: (gender: CustomerProfile['gender']) => Promise<{ error: string | null }>;
  updateNotifications: (prefs: { notificationEmail?: boolean; notificationSms?: boolean }) => Promise<{ error: string | null }>;
};
```

`pendingEmail` is derived from `supabase.auth.getUser()` → `user.new_email` (not stored in DB).

## Gender Validator (packages/shared/src/validators.ts)

```typescript
export const GENDER_VALUES = ['woman', 'man', 'prefer_not_to_disclose'] as const;
export type Gender = typeof GENDER_VALUES[number];

export const customerProfileUpdateSchema = z.object({
  name: z.string().min(2).refine(v => v.trim().length > 0, 'Name cannot be whitespace').optional(),
  gender: z.enum(GENDER_VALUES).nullable().optional(),
});
```

## Email Pending State

After `supabase.auth.updateUser({ email })`, the SDK returns an updated user object. The `user.new_email` field holds the unconfirmed email. The profile tab reads this from `supabase.auth.getUser()` at load time — no DB query needed for this.

Display logic:
- `user.email` confirmed and no `new_email` → show email normally
- `new_email` present → show current email + pending badge "Verify new@email.com — check inbox"
- `user.email` null and no `new_email` → show "Add email" prompt

## Notification Toggle Behaviour

Toggle changes are written immediately (optimistic UI: toggle first, revert on error). No debounce — each toggle is an independent boolean write.

## Error Handling

| Scenario | Behaviour |
|---|---|
| DB fetch fails | Show error banner, retry button |
| Name update fails | Show inline error, field reverts |
| Email update fails | Show inline error, no pending state set |
| Gender update fails | Show inline error |
| Notification toggle fails | Revert toggle, show toast |
