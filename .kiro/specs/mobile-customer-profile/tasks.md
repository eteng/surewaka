# Implementation Plan: Mobile Customer Profile

## Tasks

- [ ] 1. Database migrations
  - [x] 1.1 Create migration: `add_gender_to_users`
    - Add `gender text CHECK (gender IN ('woman', 'man', 'prefer_not_to_disclose'))` to `public.users`
    - Column is nullable — no DEFAULT, no backfill needed
    - _Requirements: 4.1, 4.2_

  - [x] 1.2 Create migration: `auth_email_sync_trigger`
    - Create `public.sync_confirmed_email_to_users()` function with `SECURITY DEFINER`
    - Create `sync_auth_email_to_users` AFTER UPDATE trigger on `auth.users`
    - Condition: email or email_confirmed_at changed AND email_confirmed_at IS NOT NULL
    - No-op if no matching row in `public.users`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 1.3 Regenerate Drizzle schema  ← apply migrations then run `pnpm --filter @surewaka/db db:pull`
    - Apply migrations to local/remote DB
    - Run `pnpm --filter @surewaka/db db:pull` to regenerate `packages/db/src/schema.ts`
    - _Requirements: 4.3_

- [x] 2. Shared validators
  - [x] 2.1 Add gender types and profile update schema to `packages/shared/src/validators.ts`
    - Add `GENDER_VALUES = ['woman', 'man', 'prefer_not_to_disclose'] as const`
    - Add `Gender` type
    - Add `customerProfileUpdateSchema` (name: min 2 + non-whitespace optional, gender: enum | null optional)
    - Export types
    - _Requirements: 2.3, 4.1_

- [x] 3. Profile hook
  - [x] 3.1 Create `apps/mobile-customer/app/hooks/use-customer-profile.ts`
    - Import `supabase` from `@surewaka/mobile-shared`
    - On mount: fetch `public.users` row by `userId` from auth session
    - On mount: call `supabase.auth.getUser()` to get `new_email` for pending state
    - Implement `updateName(name)`:
      - `supabase.from('users').update({ name, updated_at: new Date() }).eq('id', userId)`
      - On success: `supabase.auth.updateUser({ data: { name } })`
    - Implement `updateEmail(email)`:
      - `supabase.auth.updateUser({ email })`
      - Refresh pending state from `getUser()`
    - Implement `updateGender(gender)`:
      - `supabase.from('users').update({ gender, updated_at: new Date() }).eq('id', userId)`
    - Implement `updateNotifications({ notificationEmail?, notificationSms? })`:
      - `supabase.from('users').update({ ...prefs, updated_at: new Date() }).eq('id', userId)`
      - Optimistic update with revert on error
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 3.3, 4.3, 5.2_

- [x] 4. Profile tab
  - [x] 4.1 Update `apps/mobile-customer/app/(tabs)/profile.tsx`
    - Replace session metadata reads with `useCustomerProfile()` hook data
    - Show loading skeleton while fetching
    - Show error state with retry on fetch failure
    - Display name and phone from `profile`
    - Display email from `profile.email` OR pending badge if `profile.pendingEmail` is set
    - Display gender label if `profile.gender` is set (map DB value to display label)
    - _Requirements: 1.2, 1.3, 1.4, 3.2, 4.4_

- [x] 5. Edit screen
  - [x] 5.1 Update `apps/mobile-customer/app/profile/edit.tsx`
    - Replace `onSubmit` no-op with real save logic using `useCustomerProfile()`
    - Name field: call `updateName`, show inline error on failure
    - Email field: call `updateEmail`, show "Check your inbox — verification sent to X" on success
    - Gender field: replace the `<Pressable>` "Change Photo" placeholder — add a picker/select with three options (Woman, Man, Prefer not to disclose) + clear option; call `updateGender`
    - Disable save button while any update is in progress
    - Show success feedback on save (navigate back or toast)
    - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.5, 4.1, 4.2, 4.3_

- [x] 6. Settings screen
  - [x] 6.1 Update `apps/mobile-customer/app/profile/settings.tsx`
    - Load `notificationEmail` and `notificationSms` from `useCustomerProfile()`
    - Wire "SMS Notifications" toggle to `updateNotifications({ notificationSms })`
    - Wire "Email Notifications" toggle to `updateNotifications({ notificationEmail })`
      - Rename "Push Notifications" label to "Email Notifications" (push is a separate future feature)
    - Optimistic toggle: flip immediately, revert + show error on failure
    - _Requirements: 5.1, 5.2, 5.3_

## Notes

- No API layer — all reads/writes use Supabase JS SDK with the user's JWT. See ADR-007.
- Email sync to `public.users` is handled by the DB trigger, not client code. See ADR-008.
- Avatar upload is explicitly deferred — the "Change Photo" button in `edit.tsx` should be removed or shown as disabled/coming-soon.
- Gender picker implementation: use a bottom sheet modal or `Picker` from `@react-native-picker/picker` — match the existing UI style of the app.
- `updated_at` must be set manually on every `public.users` update (no DB-level auto-update trigger exists).
