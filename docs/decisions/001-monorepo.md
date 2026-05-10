# ADR-001: Monorepo with Turborepo

## Status

Accepted

## Context

SureWaka has multiple apps (web, admin, landing, mobile, API), shared packages, AI agents, and background workers. As a 1-2 person team, we need to minimize operational overhead.

## Decision

Use a single monorepo with Turborepo + pnpm workspaces.

## Consequences

**Positive:**
- Single git clone, one CI pipeline
- Shared types and code without publishing packages
- Atomic changes across frontend + backend
- AI editors work best with full context in one workspace
- Fast builds with Turborepo caching

**Negative:**
- Repo will grow large over time
- All team members need full repo access
- CI runs everything (mitigated by Turborepo's affected detection)

## When to Revisit

Split into multiple repos when team exceeds 5+ engineers or CI times exceed 10 minutes.
