---
inclusion: always
description: TypeScript, API, database, AI agent, and file naming conventions for the SureWaka codebase
---

# Coding Standards

## TypeScript
- Strict mode always enabled
- Prefer `type` over `interface` for data shapes
- Use Zod for runtime validation, TypeScript for compile-time
- No `any` — use `unknown` and narrow with type guards
- Prefer named exports over default exports

## API Design
- RESTful endpoints under `/api/v1/`
- Use Zod schemas for request validation
- Return consistent response shapes: `{ data, error, meta }`
- HTTP status codes: 200 (ok), 201 (created), 400 (bad request), 401 (unauthorized), 404 (not found), 500 (server error)

## Database
- Use Drizzle ORM — no raw SQL unless absolutely necessary
- All tables have `id` (uuid), `createdAt`, `updatedAt`
- Use enums for fixed value sets
- **NEVER use `drizzle-kit push`** — Supabase is the migration source of truth
- Migration workflow: `supabase migration new <name>` → `supabase migration fetch --yes` → regenerate types → sync Drizzle schema manually

**RLS is mandatory for every new table — include in the same migration file:**
1. `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
2. Service role bypass: `CREATE POLICY "service_role_manage_<table>" ON <table> FOR ALL USING (auth.role() = 'service_role');`
3. User-scoped policies (own rows, read-only catalog, etc.) — never expose other users' data
4. `GRANT` only minimum needed privileges to `authenticated` — omit INSERT/UPDATE/DELETE unless the client writes directly (most mutations go through the API as service role)

Missing grants are silent: RLS policies exist but `permission denied` is returned before they're evaluated. Always verify both the policy AND the grant exist.

## AI Agents
- System prompts in markdown files (version controlled)
- All tools defined with Zod parameter schemas
- Input/output guardrails on every customer-facing agent
- Eval test cases for every agent behavior

## File Naming
- kebab-case for files: `lookup-delivery.ts`
- PascalCase for React components: `DeliveryCard.tsx`
- camelCase for functions and variables
