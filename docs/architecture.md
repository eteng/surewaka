# Architecture

## Overview

SureWaka is a logistics marketplace built as a TypeScript monorepo. The system connects three user types: customers (senders), drivers (individual delivery partners), and carriers (logistics companies).

## System Diagram

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Landing   │  │   Web App   │  │  Mobile App │
│  (Remix)    │  │  (Remix)    │  │   (Expo)    │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    ┌────▼────┐
                    │   API   │
                    │ (Hono)  │
                    └────┬────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
    │ Supabase  │ │   Redis   │ │  Workers  │
    │ Postgres  │ │ (BullMQ)  │ │ (BullMQ)  │
    │ Auth      │ └───────────┘ └───────────┘
    │ Storage   │                     │
    │ Realtime  │              ┌──────┼──────┐
    └───────────┘              │      │      │
                            Email  Payment  Agent
```

## Data Flow

1. **Booking a delivery**: Customer → Web/Mobile → API → DB (create delivery) → Redis (queue matching job) → Worker (match driver) → Push notification
2. **Carrier aggregation**: Customer → API → Query carriers → Return quotes → Customer selects → Create delivery
3. **On-demand matching**: Customer → API → Create delivery → Worker finds nearest available driver → Notify driver → Driver accepts/rejects
4. **Tracking**: Customer → API → Query delivery status → Return location + status (polling or WebSocket later)

## Key Design Decisions

- **Modular monolith API** — single Hono server, split into route modules. No microservices until proven necessary.
- **Supabase as backend services** — Postgres + Auth + Storage + Realtime from one provider. Drizzle ORM for queries (not PostgREST).
- **Workers for async** — anything that doesn't need to block a request goes through BullMQ (emails, matching, payments).
- **SSR for customer-facing** — Nigerian networks are unreliable; server-rendered pages load faster on 3G.
- **SPA for admin** — internal tool, always on good network, no SEO needed.
- **Shared validation** — Zod schemas in `packages/shared` are the single source of truth for both frontend forms and API validation.
