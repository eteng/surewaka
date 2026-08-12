# Implementation Plan: Actor Simulator

## Overview

Build bottom-up: identity bootstrap first (nothing else works without real, authenticatable bot accounts), then the shared session-token provider, then the two bot state machines, then the CLI that wires them together, then a manual end-to-end pass. No schema changes — everything rides on existing tables.

## Tasks

- [ ] 1. Bot Identity Bootstrap
  - [ ] 1.1 Create `apps/api/scripts/seed-bot-actors.ts` skeleton
    - Parse `--drivers`, `--carriers`, `--reset` flags
    - Load env the same way `seed-drivers.ts` does (`dotenv` from repo root `.env`)
    - Guard: refuse to run if `NODE_ENV === 'production'` or `DATABASE_URL`/Clerk keys don't look local/dev
    - _Requirements: 1.8, 5.1_
  - [ ] 1.2 Implement driver bot creation
    - For each missing driver bot up to `--drivers`: create Clerk user (`bot+driver-{n}@surewaka.test`), insert `users` row, insert `drivers` row (`verified: true`, starting lat/lng from a fixed Lagos coordinate list, vehicle type cycled)
    - Call `assignRole`/`syncRolesToAuth` from `apps/api/src/services/role-service.ts` to grant the `driver` role
    - Skip accounts whose email already exists (idempotent top-up)
    - _Requirements: 1.1, 1.4, 1.5_
  - [ ] 1.3 Implement carrier bot creation
    - Look up an active seeded carrier; fail fast with a clear message if none exists and `--carriers > 0`
    - For each missing carrier bot up to `--carriers`: create Clerk user (`bot+carrier-{n}@surewaka.test`), insert `users` row, insert `carrier_members` row against that carrier
    - Call `assignRole`/`syncRolesToAuth` to grant `carrier_driver`
    - _Requirements: 1.2, 1.3, 1.4_
  - [ ] 1.4 Implement `--reset`
    - Find all `users` rows with email matching `bot+*@surewaka.test`
    - Delete them (cascades to `drivers`/`carrier_members`) and their Clerk accounts
    - _Requirements: 1.6_
  - [ ] 1.5 Manual verification
    - Run with `--drivers 3 --carriers 1`, confirm rows + Clerk users created
    - Re-run with `--drivers 5`, confirm only 2 new ones created
    - Run `--reset`, confirm all bot rows and Clerk accounts gone
    - _Requirements: 1.1, 1.6_

- [ ] 2. Session Token Provider
  - [ ] 2.1 Implement `scripts/lib/bot-session.ts`
    - Given a bot's Clerk user id, mint a sign-in token via the Clerk Backend API and exchange it for a session JWT
    - Expose `getToken(clerkUserId)` that returns a cached, auto-refreshed token (refresh before the JWT's expiry)
    - _Requirements: (supports all of Requirement 2 & 3 — every bot HTTP call needs a real token)_
  - [ ] 2.2 Manual verification
    - Mint a token for one bootstrap driver bot, call `GET` on an authenticated endpoint (or the location endpoint) directly with it, confirm 200 rather than 401
    - _Requirements: 5.2 (confirm no secret ends up in a log line)_

- [ ] 3. Driver Bot State Machine
  - [ ] 3.1 Implement `scripts/lib/driver-bot.ts`
    - `idle` loop: POST `/driver-locations` at bot's current position every 2s
    - Poll `delivery_offers` for a `pending` row addressed to this bot every 2s
    - _Requirements: 2.1_
  - [ ] 3.2 Implement accept/ignore decision
    - Randomized delay scaled by `--speed`, then accept via `POST /deliveries/:id/accept` with probability `--accept-rate`, else no-op
    - Handle `matched: false` response by logging and returning to idle
    - _Requirements: 2.2, 2.3_
  - [ ] 3.3 Implement leg progression + GPS interpolation
    - On successful accept, walk `ALLOWED_LEG_STATUSES` via `PATCH /deliveries/:deliveryId/legs/:legId/status`
    - Interpolate lat/lng between leg pickup/dropoff coordinates, pinging location (with `deliveryId`) every 2s en route
    - Scale total per-leg time by `--speed` based on leg distance at ~25km/h baseline
    - Return to idle after `delivered`
    - _Requirements: 2.4, 2.5, 2.6, 2.7_
  - [ ] 3.4 Manual verification
    - With one driver bot running and API/workers up, book an in-city delivery from Postman/curl as a real customer test account, confirm the bot logs offer → accept → status walk → delivered, and Redis/Postgres reflect it
    - _Requirements: 2.1–2.7_

- [ ] 4. Carrier Bot State Machine
  - [ ] 4.1 Implement `scripts/lib/carrier-bot.ts`
    - Poll `delivery_legs` for `actor_type = 'carrier'`, `actor_id` = this bot's carrier, status != `delivered`
    - Progress claimed legs through `ALLOWED_LEG_STATUSES` via the same PATCH endpoint, no location pings
    - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - [ ] 4.2 Implement cross-bot claim coordination
    - Shared in-process `Set` of leg ids currently being worked by any carrier bot in this run, checked before claiming
    - _Requirements: 3.3_
  - [ ] 4.3 Manual verification
    - Seed/create a delivery with an intercity leg assigned to the bootstrap carrier, run the carrier bot, confirm it progresses the leg to `delivered`
    - _Requirements: 3.1–3.4_

- [ ] 5. CLI Entry Point
  - [ ] 5.1 Implement `scripts/simulate-actors.ts`
    - Parse `--drivers`, `--carriers`, `--speed`, `--accept-rate` (defaults 5/1/1/0.9)
    - Load bot identities by `bot+` email convention; auto-run bootstrap if the requested counts aren't met
    - Start all driver/carrier bot loops concurrently
    - Structured logging (bot id, timestamp, action); suppress routine location-ping logs
    - Graceful shutdown on SIGINT: let in-flight calls finish, then exit
    - _Requirements: 4.1–4.6_
  - [ ] 5.2 Add `pnpm sim:actors` script to root `package.json`
    - _Requirements: 4.1_
  - [ ] 5.3 Document in `AGENTS.md` under a new "Actor Simulator" section
    - Command reference, what it needs running first (`pnpm dev`), what `--reset` does
    - _Requirements: (documentation, no specific acceptance criterion)_

- [ ] 6. End-to-End Verification
  - [ ] 6.1 Full manual pass per the design doc's Testing Strategy
    - `pnpm dev` + bootstrap + `pnpm sim:actors -- --drivers 3 --carriers 1`
    - Book an in-city delivery from the mobile-customer app on a physical phone (LAN IP), confirm live match + tracking
    - Book/seed an interstate delivery with an intercity leg, confirm the carrier bot completes it
    - Re-run bootstrap with a higher `--drivers` count (top-up only) and `--reset` (full teardown)
    - _Requirements: all_
