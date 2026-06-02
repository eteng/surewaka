# Design — Post-OTP User Provisioning

## Problem statement

`auth.users` is populated by Supabase on OTP verification. `public.users` is never written.
All FK references from `deliveries.customer_id → users.id` use the `public.users.id`, which
must equal `auth.users.id` — because `requireAuth` extracts `user.id` from the JWT and all
services query `public.users` via that same ID.

## Key decisions (resolved during design review)

**Email nullable** — phone-OTP users have no email at registration time. `public.users.email`
must become nullable. Email can be added later via profile settings. A migration is required.

**ID alignment** — `public.users.id` must be set to `auth.users.id`, not auto-generated.
The Drizzle schema has `defaultRandom()` as a DB-level fallback; the register endpoint
overrides it by explicitly passing `id: c.get('user').id`.

**App-side gate over DB trigger** — A trigger can only write a placeholder row with no name.
Driver-facing delivery assignments display the customer's name, so name must be collected
before the user enters the app.

**Gate location: auth store + root layout** — `initialize()` runs once at app boot. It checks
`public.users` existence for any active session. `onAuthStateChange` re-runs the same check
when a new session starts (covering the verify-OTP path). Root `_layout.tsx` reads
`profileExists` from the store and redirects to `/(auth)/register` when `user && profileExists === false`.
`verify.tsx` removes its own `router.replace('/(tabs)')` — routing is delegated to the store.

**Profile existence check: Supabase direct query** — The auth store already holds the
Supabase client. Checking `supabase.from('users').select('id').eq('id', userId).single()`
avoids a dependency on the API URL in `packages/mobile-shared` and saves a network hop.

**Upsert over strict insert** — `POST /api/v1/auth/register` uses `INSERT ... ON CONFLICT (id) DO NOTHING`
and returns the existing row on conflict. Retry-safe; no 409 surface for the client.

## Data flow

### New user (first login)

```
sign-in.tsx  →  verifyOtp()  →  onAuthStateChange fires
                                 ↓
                           Supabase query: public.users WHERE id = authUserId
                                 ↓ no row
                           set { profileExists: false }
                                 ↓
                      root _layout.tsx re-renders
                                 ↓
                      <Redirect href="/(auth)/register" />
                                 ↓
                      register.tsx: user enters name
                                 ↓
                      POST /api/v1/auth/register { name }
                                 ↓
                      upsert public.users { id, name, phone, email: null, role: 'customer', verified: false }
                                 ↓
                      set { profileExists: true } → router.replace('/(tabs)')
```

### Returning user (session restore)

```
app launch  →  initialize()
                ↓
          getSession() → session found
                ↓
          Supabase query: public.users WHERE id = authUserId
                ↓ row exists
          set { user, session, profileExists: true }
                ↓
          root _layout.tsx: user && profileExists → renders Stack normally
                ↓
          Expo Router → /(tabs)
```

## API endpoint

**`POST /api/v1/auth/register`**

- Auth: `requireAuth` (Bearer JWT)
- Body: `{ name: string }` — validated with `otpRegisterSchema` from `@surewaka/shared`
- Reads `id` and `phone` from `c.get('user')` (JWT)
- Guards: returns 400 if `phone` is missing from the JWT
- Upsert: `INSERT INTO users (id, name, phone, email, role, verified) VALUES (...) ON CONFLICT (id) DO NOTHING`
- Response: `{ data: { id, name, phone, role }, error: null, meta: null }` — 200 in all success cases

## Auth store changes (`packages/mobile-shared`)

New state field:
```typescript
profileExists: boolean | null   // null = not yet checked
```

New action:
```typescript
setProfileExists: (v: boolean | null) => void
```

`initialize()` extended:
- After `getSession()`, if session exists: query `public.users`, set `profileExists`
- If no session: `profileExists = null`

`onAuthStateChange` extended:
- On new session: query `public.users`, set `profileExists`
- On session cleared (sign-out): `set({ profileExists: null })`

## Mobile routing changes

**`apps/mobile-customer/app/_layout.tsx`**
- `InnerLayout` reads `profileExists` from store
- After initialized: if `user && profileExists === false` → `<Redirect href="/(auth)/register" />`

**`apps/mobile-customer/app/(auth)/verify.tsx`**
- Remove `router.replace('/(tabs)')` on success
- On success: do nothing — `onAuthStateChange` fires, store updates, root layout redirects

**`apps/mobile-customer/app/(onboarding)/index.tsx`**
- Change `if (user)` → `if (user && profileExists)` to avoid sending provisioned-less users to tabs

**`apps/mobile-customer/app/(tabs)/_layout.tsx`**
- Change `if (!user)` → `if (!user || !profileExists)` as defense-in-depth

**`apps/mobile-customer/app/(auth)/register.tsx`** (new)
- Single `name` text input, validated min 2 chars
- Calls `POST /api/v1/auth/register`
- On success: `set({ profileExists: true })` then `router.replace('/(tabs)')`
- No back navigation (not dismissible)

## Zod schema (`packages/shared`)

New export `otpRegisterSchema`:
```typescript
export const otpRegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
});
export type OtpRegister = z.infer<typeof otpRegisterSchema>;
```

## Migration

```sql
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
```

Drizzle schema: change `email: text('email').notNull().unique()` → `email: text('email').unique()`
