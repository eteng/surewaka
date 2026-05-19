# Design Document: Waitlist Admin

## Overview

The waitlist admin feature adds a management interface to the SureWaka admin dashboard for viewing, searching, filtering, sorting, and exporting waitlist signups. It consists of two main parts:

1. **API layer** — Two new Hono route handlers under `/api/v1/admin/waitlist` providing paginated list and aggregate stats endpoints with server-side search, filtering, and sorting.
2. **Frontend layer** — A new `/waitlist` route in the admin SPA using shadcn/ui Data Table (TanStack Table) with server-side pagination, URL-synced state, summary stat cards, and CSV export.

The feature follows existing patterns: `requireAuth` + `requireRole('surewaka_admin')` for authorization, Drizzle ORM for queries, Zod for validation, and the `{ data, error, meta }` response shape.

## Architecture

```mermaid
graph TD
    subgraph "Admin SPA (apps/admin)"
        A[/waitlist route] --> B[WaitlistPage]
        B --> C[StatsCards]
        B --> D[DataTable]
        D --> E[SearchInput]
        D --> F[FilterControls]
        D --> G[ColumnVisibility]
        D --> H[PaginationControls]
        B --> I[ExportButton]
    end

    subgraph "API (apps/api)"
        J[GET /api/v1/admin/waitlist] --> K[requireAuth]
        K --> L[requireRole]
        L --> M[WaitlistService]
        N[GET /api/v1/admin/waitlist/stats] --> K
        M --> O[(Supabase Postgres)]
    end

    D -->|fetch with query params| J
    C -->|fetch| N
    I -->|fetch all filtered| J
```

### Data Flow

1. The `WaitlistPage` component mounts and reads URL search params for initial state (page, pageSize, search, userType, source, sortBy, sortDir).
2. A `useWaitlistData` hook fetches from the list endpoint with those params, returning data + meta.
3. A separate `useWaitlistStats` hook fetches from the stats endpoint (no filters applied).
4. TanStack Table is configured in `manualPagination`, `manualSorting`, and `manualFiltering` mode — all state changes trigger new API fetches.
5. State changes update URL search params (via `useSearchParams`) for shareable/bookmarkable URLs.
6. Export fetches all records matching current filters (no pagination) and generates a client-side CSV blob.

## Components and Interfaces

### API Routes

#### `GET /api/v1/admin/waitlist`

**Query Parameters (validated with Zod):**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | number | 1 | >= 1 |
| `pageSize` | number | 20 | 1–100 |
| `search` | string | "" | max 200 chars |
| `userType` | enum | — | sender \| business \| driver |
| `source` | string | — | — |
| `sortBy` | enum | "createdAt" | fullName \| email \| userType \| createdAt |
| `sortDir` | enum | "desc" | asc \| desc |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "fullName": "string",
      "email": "string",
      "userType": "sender | business | driver",
      "source": "string",
      "createdAt": "ISO 8601"
    }
  ],
  "error": null,
  "meta": {
    "total": 156,
    "page": 2,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

#### `GET /api/v1/admin/waitlist/stats`

**Response:**
```json
{
  "data": {
    "total": 156,
    "bySender": 80,
    "byBusiness": 45,
    "byDriver": 31,
    "last7Days": 23
  },
  "error": null,
  "meta": null
}
```

### Frontend Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `WaitlistPage` | `apps/admin/app/routes/waitlist.tsx` | Route component, orchestrates layout |
| `WaitlistStatsCards` | `apps/admin/app/components/waitlist/stats-cards.tsx` | Displays summary stat cards |
| `WaitlistDataTable` | `apps/admin/app/components/waitlist/data-table.tsx` | TanStack Table wrapper with columns |
| `WaitlistToolbar` | `apps/admin/app/components/waitlist/toolbar.tsx` | Search input + filter dropdowns + export button |
| `WaitlistPagination` | `apps/admin/app/components/waitlist/pagination.tsx` | Pagination controls below table |
| `WaitlistColumns` | `apps/admin/app/components/waitlist/columns.tsx` | Column definitions for TanStack Table |

### Hooks

| Hook | Purpose |
|------|---------|
| `useWaitlistData(params)` | Fetches paginated list from API, returns `{ data, meta, isLoading, error, refetch }` |
| `useWaitlistStats()` | Fetches stats from API, returns `{ stats, isLoading, error }` |
| `useWaitlistParams()` | Reads/writes URL search params, provides typed getter/setter for table state |

### Shared Validators

New Zod schemas in `packages/shared/src/validators.ts`:

```typescript
export const waitlistQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).default(''),
  userType: z.enum(['sender', 'business', 'driver']).optional(),
  source: z.string().optional(),
  sortBy: z.enum(['fullName', 'email', 'userType', 'createdAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export type WaitlistQuery = z.infer<typeof waitlistQuerySchema>;
```

## Data Models

### Existing Table: `waitlist_signups`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, defaultRandom |
| `full_name` | text | NOT NULL |
| `email` | text | NOT NULL, UNIQUE |
| `user_type` | waitlist_user_type enum | NOT NULL |
| `source` | text | DEFAULT 'home' |
| `created_at` | timestamp | NOT NULL, defaultNow |
| `updated_at` | timestamp | NOT NULL, defaultNow |

### New Database Indexes (via Supabase migration)

```sql
-- Support sorting by created_at (default sort)
CREATE INDEX idx_waitlist_signups_created_at ON waitlist_signups (created_at DESC);

-- Support filtering by user_type + sorting by created_at
CREATE INDEX idx_waitlist_signups_user_type_created_at ON waitlist_signups (user_type, created_at DESC);

-- Support filtering by source
CREATE INDEX idx_waitlist_signups_source ON waitlist_signups (source);

-- Support search on email (for ILIKE queries)
CREATE INDEX idx_waitlist_signups_email ON waitlist_signups (email);

-- Support search on full_name (trigram index for ILIKE)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_waitlist_signups_full_name_trgm ON waitlist_signups USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_waitlist_signups_email_trgm ON waitlist_signups USING gin (email gin_trgm_ops);
```

### API Service Layer

The `WaitlistService` in `apps/api/src/services/waitlist-service.ts` encapsulates all database queries:

```typescript
type WaitlistListResult = {
  data: WaitlistSignup[];
  total: number;
};

type WaitlistStats = {
  total: number;
  bySender: number;
  byBusiness: number;
  byDriver: number;
  last7Days: number;
};

// Service functions
function listWaitlistSignups(params: WaitlistQuery): Promise<WaitlistListResult>;
function getWaitlistStats(): Promise<WaitlistStats>;
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Sort correctness

*For any* set of waitlist signup records and any valid sort column and direction, the records returned by the list endpoint SHALL be ordered according to the specified sort column and direction.

**Validates: Requirements 1.1, 8.1**

### Property 2: Pagination metadata consistency

*For any* total record count, page number, and page size, the pagination metadata SHALL satisfy: `totalPages = ceil(total / pageSize)`, `page <= totalPages` (or page=1 when total=0), and the number of returned records SHALL equal `min(pageSize, total - (page - 1) * pageSize)`.

**Validates: Requirements 1.2, 9.6, 9.10**

### Property 3: Page size bounds enforcement

*For any* pageSize value greater than 100, the API SHALL clamp it to 100. *For any* pageSize value less than 1 or missing, the API SHALL default to 20. The number of returned records SHALL never exceed the effective page size.

**Validates: Requirements 1.3**

### Property 4: Search filter correctness

*For any* non-empty search term and any dataset of waitlist signups, every record returned by the API SHALL contain the search term (case-insensitive) in either the `fullName` or `email` field. Conversely, no record that does NOT contain the search term in either field SHALL appear in the results.

**Validates: Requirements 2.1, 2.2**

### Property 5: Filter correctness

*For any* combination of `userType` and `source` filter parameters applied to any dataset, every record in the response SHALL match ALL applied filter criteria. When no filter is applied for a dimension, records of all values for that dimension SHALL be included.

**Validates: Requirements 3.1, 3.2, 4.1, 4.2**

### Property 6: Invalid filter rejection

*For any* string value that is not one of `sender`, `business`, or `driver`, when provided as the `userType` query parameter, the API SHALL return a 400 status code with a validation error.

**Validates: Requirements 3.3**

### Property 7: Stats aggregation correctness

*For any* dataset of waitlist signups, the stats endpoint SHALL return counts where: `total = bySender + byBusiness + byDriver`, each per-type count equals the number of records with that `userType`, and `last7Days` equals the number of records with `createdAt` within the last 7 days.

**Validates: Requirements 6.1, 6.3**

### Property 8: CSV export completeness

*For any* set of waitlist signup records, the generated CSV SHALL contain exactly one row per record (plus header), and each row SHALL include the `fullName`, `email`, `userType`, `source`, and `createdAt` values matching the source record.

**Validates: Requirements 7.2**

### Property 9: Column rendering completeness

*For any* waitlist signup record, when rendered in the data table, the row SHALL display the `fullName`, `email`, `userType`, `source`, and `createdAt` (formatted as date) values from that record.

**Validates: Requirements 5.2**

## Security Considerations (OWASP)

This section addresses relevant OWASP Top 10 (2021) risks and API Security Top 10 (2023) concerns for this feature.

### A01:2021 — Broken Access Control

| Threat | Mitigation |
|--------|-----------|
| Unauthenticated access to waitlist data | `requireAuth` middleware validates Supabase JWT on every request; missing/expired tokens return 401 |
| Horizontal privilege escalation (non-admin users) | `requireRole('surewaka_admin')` middleware checks the user's role claim; non-admin roles return 403 |
| Direct object reference (IDOR) | Endpoints are list-only (no per-record mutation); no user-supplied IDs used in queries |
| Forced browsing to admin routes | Frontend route guard (`AuthGuard`) redirects unauthenticated users; API enforces independently |

**Implementation:**
- Auth middleware runs before any route handler — no bypass path exists.
- Role check uses the `user_role` claim from the JWT, verified server-side against Supabase.
- RLS policies on `waitlist_signups` table restrict access to `surewaka_admin` role at the database level as a defense-in-depth measure.

### A02:2021 — Cryptographic Failures

| Threat | Mitigation |
|--------|-----------|
| PII exposure in transit | All API communication over HTTPS (enforced by Vercel/Fly.io); no HTTP fallback |
| Token leakage | JWT stored in httpOnly cookie or Authorization header; never in URL params or localStorage |
| Sensitive data in logs | Email addresses and names are NOT logged in API request logs; only request metadata (path, status, duration) |

### A03:2021 — Injection

| Threat | Mitigation |
|--------|-----------|
| SQL injection via search/filter params | All queries use Drizzle ORM's parameterized query builder — no raw SQL string concatenation |
| SQL injection via sort column | `sortBy` is validated against a strict Zod enum (`fullName | email | userType | createdAt`); arbitrary column names are rejected |
| NoSQL/LDAP injection | Not applicable — Postgres only, no NoSQL or directory services |
| XSS via stored data rendered in table | React's default JSX escaping prevents script injection; no `dangerouslySetInnerHTML` used |
| CSV injection | Exported CSV values are sanitized: cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with a single quote to prevent formula injection in spreadsheet applications |

**Implementation:**
```typescript
// Search parameter is passed as a parameterized ILIKE value
const searchPattern = `%${params.search}%`;
// Drizzle: .where(or(ilike(table.fullName, searchPattern), ilike(table.email, searchPattern)))
// This generates: WHERE full_name ILIKE $1 OR email ILIKE $2 (parameterized, not interpolated)
```

### A04:2021 — Insecure Design

| Threat | Mitigation |
|--------|-----------|
| Mass data exfiltration via export | Export is limited to authenticated admins only; rate limiting prevents abuse |
| Enumeration of all emails | Endpoint requires admin auth; search is server-side only (no client-side autocomplete leaking data) |
| Denial of service via large page sizes | `pageSize` is capped at 100 via Zod validation; values > 100 are rejected with 400 |

### A05:2021 — Security Misconfiguration

| Threat | Mitigation |
|--------|-----------|
| CORS misconfiguration | API CORS middleware restricts `Access-Control-Allow-Origin` to the admin app's domain only |
| Verbose error messages | 500 errors return generic `INTERNAL_ERROR` code; stack traces and DB error details are never sent to the client |
| Default credentials | No default credentials; auth is delegated to Supabase Auth |
| Missing security headers | API responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` headers |

### A06:2021 — Vulnerable and Outdated Components

| Threat | Mitigation |
|--------|-----------|
| Known vulnerabilities in dependencies | Dependencies use pinned versions; `pnpm audit` runs in CI pipeline |
| Supply chain attacks | Lock file (`pnpm-lock.yaml`) committed; integrity hashes verified on install |

### A07:2021 — Identification and Authentication Failures

| Threat | Mitigation |
|--------|-----------|
| Session fixation | Supabase Auth handles session management with rotating refresh tokens |
| Brute force on admin endpoints | Rate limiting middleware (existing) applies to all API routes |
| JWT tampering | JWTs are verified using Supabase's public key; signature validation rejects tampered tokens |

### A08:2021 — Software and Data Integrity Failures

| Threat | Mitigation |
|--------|-----------|
| Unsigned data in transit | JWT signature verification ensures data integrity |
| CI/CD pipeline compromise | Deployments require passing CI checks; no direct push to production |

### A09:2021 — Security Logging and Monitoring Failures

| Threat | Mitigation |
|--------|-----------|
| Undetected unauthorized access attempts | Failed auth attempts (401/403) are logged with timestamp, IP, and requested path |
| No audit trail for data access | Successful admin data access is logged (user ID, endpoint, timestamp) for audit purposes |
| Log injection | Log entries use structured JSON format; user-supplied values are never interpolated into log message templates |

### A10:2021 — Server-Side Request Forgery (SSRF)

Not applicable — this feature makes no outbound HTTP requests based on user input.

### OWASP API Security Top 10 (2023) — Additional Considerations

| Risk | Mitigation |
|------|-----------|
| API1 — Broken Object Level Authorization | List-only endpoints; no per-object access decisions needed |
| API2 — Broken Authentication | Supabase JWT validation on every request |
| API3 — Broken Object Property Level Authorization | Response shape is fixed; no user-controlled field selection |
| API4 — Unrestricted Resource Consumption | Page size capped at 100; search string capped at 200 chars; rate limiting on all endpoints |
| API5 — Broken Function Level Authorization | `requireRole('surewaka_admin')` enforces function-level access |
| API6 — Unrestricted Access to Sensitive Business Flows | Export endpoint is rate-limited; no batch operations exposed |
| API7 — Server Side Request Forgery | No outbound requests from user input |
| API8 — Security Misconfiguration | Strict CORS, security headers, no debug mode in production |
| API9 — Improper Inventory Management | Endpoints documented in this design doc; no shadow/deprecated endpoints |
| API10 — Unsafe Consumption of APIs | No third-party API consumption in this feature |

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/v1/admin/waitlist` | 60 requests | per minute per user |
| `GET /api/v1/admin/waitlist/stats` | 30 requests | per minute per user |
| Export (pageSize=max, no pagination) | 5 requests | per minute per user |

### Input Validation Summary

All user-supplied inputs are validated at the API boundary before any processing:

| Input | Validation | Rejection |
|-------|-----------|-----------|
| `page` | Integer >= 1 | 400 with validation error |
| `pageSize` | Integer 1–100 | 400 with validation error |
| `search` | String, max 200 chars, trimmed | 400 if exceeds length |
| `userType` | Strict enum (sender/business/driver) | 400 if invalid value |
| `source` | String, max 100 chars | 400 if exceeds length |
| `sortBy` | Strict enum (fullName/email/userType/createdAt) | 400 if invalid value |
| `sortDir` | Strict enum (asc/desc) | 400 if invalid value |

## Error Handling

| Scenario | API Response | Frontend Behavior |
|----------|-------------|-------------------|
| No auth token | 401 `{ error: { code: 'UNAUTHORIZED' } }` | Redirect to login |
| Non-admin role | 403 `{ error: { code: 'FORBIDDEN' } }` | Show "Access Denied" message |
| Invalid query params | 400 `{ error: { code: 'VALIDATION_ERROR', message } }` | Show toast with validation message |
| Database error | 500 `{ error: { code: 'INTERNAL_ERROR' } }` | Show error state with retry button |
| Network failure | — | Show error state with retry button |
| Empty results | 200 `{ data: [], meta: { total: 0, ... } }` | Show empty state illustration |

### Error Boundaries

- The `WaitlistPage` component wraps the data table in a React error boundary that catches render errors and displays a fallback UI with a retry action.
- API fetch errors are caught in the hooks and exposed via an `error` state, allowing the UI to show contextual error messages without crashing.

## Testing Strategy

### Property-Based Tests (Vitest + fast-check)

The feature's core logic (pagination math, filtering, sorting, CSV generation, stats aggregation) is well-suited for property-based testing. We'll use `fast-check` with Vitest.

**Configuration:**
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: waitlist-admin, Property {N}: {title}`
- Tests target the service layer functions (pure logic, no HTTP overhead)

**Properties to implement:**
1. Sort correctness — generate random signup arrays, sort with service logic, verify ordering
2. Pagination metadata consistency — generate random (total, page, pageSize) tuples, verify math
3. Page size bounds — generate arbitrary numbers, verify clamping/defaults
4. Search filter correctness — generate random signups + search terms, verify inclusion/exclusion
5. Filter correctness — generate random signups + filter combos, verify all results match
6. Invalid filter rejection — generate random non-enum strings, verify 400 response
7. Stats aggregation — generate random signup arrays, verify counts match manual aggregation
8. CSV export completeness — generate random signups, export to CSV, parse back and verify
9. Column rendering — generate random signups, verify render output contains all fields

### Unit Tests (Vitest)

- Auth/role middleware returns correct status codes (401, 403)
- Default query parameter values applied correctly
- Debounced search input fires after 300ms
- Page size selector options (10, 20, 50, 100)
- Page resets to 1 on filter/search change
- Export filename format matches `waitlist-export-YYYY-MM-DD.csv`
- Column visibility toggle hides/shows columns
- Loading skeleton displayed during fetch
- Error state with retry button on API failure
- Empty state message when no results

### Integration Tests

- Full API request/response cycle with test database
- Database indexes exist and are used by query planner
- URL search params sync with table state
- End-to-end filter → API → render cycle

### Performance Validation

- API response time < 500ms for 100k records (manual benchmark)
- Verify query plans use indexes via `EXPLAIN ANALYZE`
