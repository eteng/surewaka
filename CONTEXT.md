# SureWaka Domain Glossary

Terms resolved through explicit design decisions. Do not include implementation details — see specs and ADRs for those.

## Terms

### Customer_Profile
The `public.users` row for a user whose role is `'customer'`. The single source of truth for profile display in the mobile app — always fetched from the DB, not derived from Supabase Auth session metadata.

### Email_Verification_Flow
The process by which a customer's new email is confirmed. Initiated by calling `supabase.auth.updateUser({ email })` from the mobile client, which sends a verification link. On confirmation, a Postgres trigger on `auth.users` syncs the confirmed email to `public.users.email`. See ADR-008.

### Gender
An optional attribute on Customer_Profile. One of three values: `'woman'`, `'man'`, `'prefer_not_to_disclose'`. Stored in `public.users.gender`. Display labels: "Woman", "Man", "Prefer not to disclose".

### Internal_User
A user added/invited by an administrator — ops team, support agents, admins. Distinct from a Customer. Internal users go through a name-change approval workflow; customers do not.

### Name_Change_Approval_Workflow
The process by which an Internal_User requests a name correction that requires admin sign-off before taking effect. **Does not apply to customers** — customers update their name directly. See [[admin-user-profile spec]].
