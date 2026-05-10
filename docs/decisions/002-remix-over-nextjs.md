# ADR-002: React Router v7 (Remix) over Next.js

## Status

Accepted

## Context

Need a full-stack React framework for web apps. Evaluated Next.js, Remix/React Router v7, and TanStack Start.

## Decision

Use React Router v7 (Remix) with Vite for all web apps.

## Rationale

- **Progressive enhancement** — forms work without JS, critical for Nigerian 3G networks
- **Simpler mental model** — loaders/actions/components vs RSC complexity
- **No vendor lock-in** — deploys anywhere (not Vercel-optimized)
- **Battle-tested** — Shopify-backed, years in production
- **AI-friendly** — more training data than TanStack Start, better code generation
- **Vite** — fast HMR, no webpack/turbopack issues

## Consequences

- Less type-safe routing than TanStack Router (acceptable tradeoff)
- Smaller ecosystem than Next.js (but sufficient)
- Admin runs in SPA mode (no SSR needed for internal tools)
