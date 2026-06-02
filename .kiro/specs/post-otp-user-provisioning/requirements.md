# Requirements — Post-OTP User Provisioning

## Background

Phone OTP users authenticate via Supabase Auth (`auth.users`) but no corresponding row is ever
written to `public.users`. Every route that references `deliveries.customer_id → users.id`
fails immediately with a FK violation, blocking delivery creation for all mobile customers.

The fix is an app-side registration gate: after OTP verification, if `public.users` has no row
for this user, collect their name once and provision the row before entering the main app.

---

## User Stories

### 1. First-time OTP login

WHEN a user verifies their phone OTP for the first time  
THEN the app does not navigate to the main tab view  
AND the app shows a one-time name collection screen  
AND the user must enter their name before proceeding

### 2. Name submission creates the public.users row

WHEN the user submits their name on the registration screen  
THEN `POST /api/v1/auth/register` is called with `{ name }`  
AND a `public.users` row is upserted with `{ id: auth.users.id, name, phone, email: null, role: 'customer', verified: false }`  
AND the user is navigated to the main tab view

### 3. Subsequent logins skip the registration screen

WHEN a returning user verifies their OTP  
AND a `public.users` row already exists for their `auth.users.id`  
THEN the app navigates directly to the main tab view  
AND the name collection screen is never shown

### 4. Session restore skips the registration screen

WHEN the app is launched and a persisted session is found  
AND a `public.users` row exists for that user  
THEN the app navigates directly to the main tab view without any registration prompt

### 5. Session restore for unprovision user shows registration

WHEN the app is launched and a persisted session is found  
AND no `public.users` row exists for that user  
THEN the app shows the name collection screen before the main tab view

### 6. Registration endpoint is idempotent

WHEN `POST /api/v1/auth/register` is called for a user who already has a `public.users` row  
THEN the endpoint returns 200 with the existing row  
AND no duplicate row or error is produced

---

## Acceptance Criteria

- A fresh phone-OTP login always lands on the name screen before `/(tabs)`
- Submitting a valid name (≥2 chars) successfully navigates to `/(tabs)`
- A returning user (existing `public.users` row) never sees the name screen
- `GET /api/v1/profile` returns a 200 (not 404) after registration completes
- `POST /api/v1/deliveries` no longer fails with FK violation for newly registered users
- `public.users.email` accepts NULL (migration applied)
