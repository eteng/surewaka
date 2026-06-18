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
- Use enums for fixed value sets (defined in `packages/db/src/schema/enums.ts`)
- Schema is source of truth — lives in `packages/db/src/schema/`, one file per table

### Migration workflow (Drizzle Kit):

```bash
# 1. Edit the relevant file in packages/db/src/schema/
# 2. Generate migration
pnpm --filter @surewaka/db db:generate
# 3. Review the generated SQL in packages/db/drizzle/
# 4. Apply to Neon
pnpm --filter @surewaka/db db:migrate
```

- `db:push` is acceptable for initial setup or prototyping (applies schema without generating a migration file)
- Always review generated SQL before applying to production
- Never modify migration files after they've been applied

### Adding a new table:

1. Create `packages/db/src/schema/<table-name>.ts`
2. Define the table with appropriate columns, indexes, FKs, and constraints
3. Export from `packages/db/src/schema/index.ts`
4. Run `db:generate` → `db:migrate`

## Auth
- Authorization is handled in the API layer (Hono middleware), not via database RLS
- `requireAuth` middleware verifies Clerk session tokens
- `requireRole(...roles)` middleware checks user roles from Clerk `publicMetadata`
- Role data lives in both the `user_roles` DB table and Clerk `publicMetadata` (synced on mutation)
- `AuthUser` type from `@surewaka/auth` is the canonical user type across the API

## AI Agents
- System prompts in markdown files (version controlled)
- All tools defined with Zod parameter schemas
- Input/output guardrails on every customer-facing agent
- Eval test cases for every agent behavior

## File Naming
- kebab-case for files: `lookup-delivery.ts`
- PascalCase for React components: `DeliveryCard.tsx`
- camelCase for functions and variables
