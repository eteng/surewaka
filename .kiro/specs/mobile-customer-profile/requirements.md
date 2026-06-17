# Requirements: Mobile Customer Profile

## Introduction

The customer mobile app's profile tab shows identity and preference data sourced entirely from `public.users` (a single DB fetch via the Supabase SDK — no API layer). Customers can edit their name, email, and gender directly. Email changes go through Supabase Auth verification; a Postgres trigger on `auth.users` syncs the confirmed email back to `public.users`. Notification preferences are persisted to the same row.

## Glossary

See `/CONTEXT.md` for: Customer_Profile, Email_Verification_Flow, Gender, Internal_User, Name_Change_Approval_Workflow.

- **Profile_Hook**: `useCustomerProfile` — the React hook in the mobile-customer app that owns all profile fetching and mutation logic.
- **Pending_Email**: An email submitted via `supabase.auth.updateUser({ email })` that has not yet been confirmed. Visible in the Supabase session as `user.new_email`.

## Requirements

### Requirement 1: Profile Data Source

**User Story:** As a customer, I want my profile information to always reflect what's stored in the database, so I see accurate data regardless of session state.

#### Acceptance Criteria

1. WHEN the profile tab mounts, THEN the Profile_Hook SHALL fetch the Customer_Profile row from `public.users` using the Supabase SDK with the authenticated user's JWT.
2. THE profile tab SHALL display name, phone, email, and gender sourced from `public.users` — not from Supabase Auth session metadata.
3. WHEN the DB fetch fails, THEN the profile tab SHALL show an error state with a retry action.
4. WHEN the DB fetch is in progress, THEN the profile tab SHALL show a loading state.

### Requirement 2: Edit Profile — Name

**User Story:** As a customer, I want to update my display name directly, without waiting for admin approval.

#### Acceptance Criteria

1. WHEN a customer submits a new name, THEN the Profile_Hook SHALL update `public.users.name` via `supabase.from('users').update(...)` scoped to their own `id`.
2. WHEN the name update succeeds, THEN the Profile_Hook SHALL also call `supabase.auth.updateUser({ data: { name } })` to keep auth metadata consistent.
3. THE name field SHALL validate that the value is at least 2 characters and not whitespace-only.
4. WHEN the update fails, THEN the edit screen SHALL display an error message.

### Requirement 3: Edit Profile — Email

**User Story:** As a customer, I want to add or update my contact email, with confirmation required before it takes effect.

#### Acceptance Criteria

1. WHEN a customer submits a new email, THEN the Profile_Hook SHALL call `supabase.auth.updateUser({ email })` to initiate the Email_Verification_Flow.
2. WHEN a verification email has been sent, THEN the profile tab SHALL show a pending badge indicating the email is awaiting confirmation.
3. THE pending state SHALL be derived from `user.new_email` in the Supabase session — no extra DB query.
4. WHEN the customer's email is confirmed (trigger syncs to `public.users.email`), THEN the profile tab SHALL show the confirmed email on next fetch.
5. THE email field SHALL validate format (valid email address) before submission.
6. IF no email has been set, THEN the profile tab SHALL show an "Add email" prompt in place of the email field.

### Requirement 4: Edit Profile — Gender

**User Story:** As a customer, I want to optionally specify my gender on my profile.

#### Acceptance Criteria

1. THE edit screen SHALL provide a picker with three options: "Woman", "Man", "Prefer not to disclose".
2. THE gender field SHALL be optional — a customer may leave it unset (null).
3. WHEN a customer selects a gender and saves, THEN the Profile_Hook SHALL update `public.users.gender` via the Supabase SDK.
4. WHEN gender is null, THEN the profile tab SHALL show nothing for that field (no placeholder text).

### Requirement 5: Notification Preferences

**User Story:** As a customer, I want to control whether I receive email and SMS notifications, with my preference saved to my account.

#### Acceptance Criteria

1. WHEN the settings screen mounts, THEN the Profile_Hook SHALL read `notification_email` and `notification_sms` from the Customer_Profile row.
2. WHEN a customer toggles a notification switch, THEN the Profile_Hook SHALL immediately update the corresponding column in `public.users` via the Supabase SDK.
3. WHEN the update fails, THEN the toggle SHALL revert to its previous value and show an error.

### Requirement 6: Email Sync Trigger

**User Story:** As a platform developer, I want a customer's confirmed email to automatically appear in `public.users`, so the profile tab always shows verified data.

#### Acceptance Criteria

1. A Postgres trigger on `auth.users` SHALL call a function that writes the confirmed email to `public.users.email` whenever `auth.users.email` or `auth.users.email_confirmed_at` changes and `email_confirmed_at IS NOT NULL`.
2. THE trigger function SHALL use `SECURITY DEFINER` so it can write across the `auth` and `public` schema boundary.
3. THE trigger SHALL be an AFTER UPDATE trigger to avoid interfering with Supabase Auth's own write.
4. IF no matching row exists in `public.users` (user not yet provisioned), THE trigger SHALL do nothing (no error).
