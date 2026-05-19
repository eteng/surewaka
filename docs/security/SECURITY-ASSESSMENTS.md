# Security Assessments & Advisories

Tracking document for all security reviews, vulnerability assessments, and remediation status across the SureWaka platform.

---

## Assessment Log

### SA-001: Admin Dashboard MFA Authentication Flow

**Date:** 2026-05-14
**Scope:** `apps/admin` auth flow, `apps/api` middleware
**Trigger:** Implementation of email+password + TOTP MFA for admin panel

#### Findings

| ID | Severity | Finding | Status | Remediation |
|----|----------|---------|--------|-------------|
| SA-001-1 | **High** | API did not enforce AAL2 (MFA) — admin endpoints accessible with password-only token | ✅ Fixed | Added `requireMfa` middleware to `apps/api/src/middleware/auth.ts`. Apply to admin routes: `app.use('/api/v1/admin/*', requireAuth, requireMfa)` |
| SA-001-2 | **Medium** | Orphaned unverified MFA factors accumulate in `auth.mfa_factors` | ⚠️ Open | Implement pg_cron job to delete unverified factors older than 24h. SQL: `DELETE FROM auth.mfa_factors WHERE status = 'unverified' AND created_at < NOW() - INTERVAL '24 hours'` |
| SA-001-3 | **Medium** | No client-side rate limiting on TOTP code entry | ⚠️ Open | Add lockout after 5 consecutive failed verification attempts (disable input for 60s). Supabase server-side rate limiting provides baseline protection. |
| SA-001-4 | **Low** | Auth guard is client-side only (SPA) | ✅ Acceptable | By design — SPA routes are empty shells. All data access goes through API which enforces auth server-side. No sensitive data in the client bundle. |
| SA-001-5 | **Low** | TOTP secret stored in sessionStorage during enrollment | ✅ Acceptable | Tab-scoped, cleared on tab close, cleared after successful verification. If attacker has XSS, session token is already compromised (worse impact). |
| SA-001-6 | **Info** | No `friendlyName` on MFA factors | ✅ Acceptable | Avoids `mfa_factor_name_conflict` errors. No security impact — factor is still cryptographically bound to user account. |

#### Architecture Notes

- MFA enrollment uses "Resume-or-Create" pattern to handle abandoned enrollments
- `mfa.unenroll()` requires AAL2 — cannot clean up stale factors at AAL1 (Supabase design constraint)
- Supabase Auth has built-in rate limiting: ~30 sign-in attempts/hour per IP

---

## Open Action Items

| Priority | Action | Owner | Target Date |
|----------|--------|-------|-------------|
| P1 | Apply `requireMfa` middleware to all admin API routes | Engineering | — |
| P2 | Deploy pg_cron job for stale MFA factor cleanup | Engineering | — |
| P2 | Add client-side TOTP attempt lockout (5 failures → 60s cooldown) | Engineering | — |
| P3 | Add `beforeunload` warning during MFA enrollment to reduce abandonment | Engineering | — |
| P3 | Consider Edge Function for admin MFA reset (service_role factor deletion) | Engineering | — |

---

## Periodic Review Schedule

| Review Type | Frequency | Last Run | Next Due |
|-------------|-----------|----------|----------|
| Supabase Security Advisors (`get_advisors`) | After every DDL change | — | — |
| RLS Policy Audit | Monthly | — | — |
| Dependency Vulnerability Scan | Weekly (Dependabot) | — | — |
| Auth Flow Penetration Test | Quarterly | — | — |
| API Endpoint Authorization Review | Per feature release | 2026-05-14 | — |

---

## Security Principles

1. **Defense in depth** — Client-side guards are UX; server-side middleware is security
2. **Least privilege** — Use `createServerClient` (user JWT) for user-scoped queries; `createServiceClient` only in workers/admin ops
3. **Never trust the client** — All authorization decisions happen in `apps/api` middleware
4. **MFA for elevated access** — All admin users must achieve AAL2 before accessing protected resources
5. **Secrets management** — `SUPABASE_SERVICE_ROLE_KEY` never exposed to client; env vars in `.env.local` (gitignored)

---

## How to Add a New Assessment

```markdown
### SA-XXX: [Title]

**Date:** YYYY-MM-DD
**Scope:** [affected packages/apps]
**Trigger:** [what prompted the review]

#### Findings

| ID | Severity | Finding | Status | Remediation |
|----|----------|---------|--------|-------------|
| SA-XXX-1 | High/Medium/Low/Info | Description | ✅ Fixed / ⚠️ Open / 🔄 In Progress | Details |
```

Severity levels:
- **High** — Exploitable vulnerability that could lead to unauthorized access or data breach
- **Medium** — Security weakness that requires additional conditions to exploit
- **Low** — Minor issue with limited impact, or defense-in-depth improvement
- **Info** — Design decision documented for awareness, no action needed
