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
- Migrations via `drizzle-kit generate` and `drizzle-kit migrate`

## AI Agents
- System prompts in markdown files (version controlled)
- All tools defined with Zod parameter schemas
- Input/output guardrails on every customer-facing agent
- Eval test cases for every agent behavior

## File Naming
- kebab-case for files: `lookup-delivery.ts`
- PascalCase for React components: `DeliveryCard.tsx`
- camelCase for functions and variables
