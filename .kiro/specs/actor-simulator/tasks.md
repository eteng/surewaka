# Implementation Plan: Actor Simulator

## Overview

Build bottom-up: identity bootstrap first (nothing else works without real, authenticatable bot accounts), then the shared session-token provider, then the two bot state machines, then the CLI that wires them together, then a manual end-to-end pass. No schema changes — everything rides on existing tables.

## Tasks

- [x] 1. Bot Identity Bootstrap
  - [x] 1.1 Create `apps/api/scripts/seed-bot-actors.ts` skeleton
    - Parse `--drivers`, `--carriers`, `--reset` flags
    - Env loaded via `tsx --env-file` (matches the existing `create-superuser` script's convention, not `dotenv`)
    - Guard: refuse to run if `NODE_ENV === 'production'` or `CLERK_SECRET_KEY` looks like a live key (`sk_live_`)
    - _Requirements: 1.8, 5.1_
  - [x] 1.2 Implement driver bot creation
    - For each missing driver bot up to `--drivers`: create Clerk user (`bot+driver-{n}@example.com` — see design.md's "Implementation corrections" for why not `.test`), insert `users` row, insert `drivers` row (`verified: true`, starting lat/lng from a fixed Lagos coordinate list, vehicle type cycled)
    - Call `assignRole`/`syncRolesToAuth` from `apps/api/src/services/role-service.ts` to grant the `driver` role
    - Skip accounts whose email already has an active role (idempotent top-up); reactivate deactivated ones instead of erroring
    - _Requirements: 1.1, 1.4, 1.5, 6a_
  - [x] 1.3 Implement carrier bot creation
    - Look up an active seeded carrier; fail fast with a clear message if none exists and `--carriers > 0`
    - For each missing carrier bot up to `--carriers`: create Clerk user (`bot+carrier-{n}@example.com`), insert `users` row, insert `carrier_members` row against that carrier
    - Call `assignRole`/`syncRolesToAuth` to grant `carrier_driver`
    - _Requirements: 1.2, 1.3, 1.4_
  - [x] 1.4 Implement `--reset`
    - Find all `users` rows with email matching `bot+*@example.com`
    - Revoke role + deactivate `drivers`/`carrier_members` row (does NOT delete — see design.md's "Implementation corrections": `role_audit_log`'s FK makes hard-delete impossible once a bot has ever had a role assigned)
    - _Requirements: 1.6_
  - [x] 1.5 Manual verification
    - Ran with `--drivers 3 --carriers 1` against the real dev Clerk instance + DB, confirmed rows + Clerk users + `publicMetadata` created correctly
    - Re-ran with `--drivers 4`, confirmed only the shortfall was created
    - Ran `--reset`, confirmed all bots deactivated (Clerk `publicMetadata` reverted to `['customer']`) but not deleted
    - Re-ran without `--reset`, confirmed deactivated bots were reactivated (not duplicated)
    - Along the way, fixed two pre-existing bugs this task's real-API testing exposed in `role-service.ts` (`syncRolesToAuth`'s clerkId resolution; `assignRole`'s handling of reassigning a previously-revoked role) — see design.md
    - _Requirements: 1.1, 1.6, 6a_

- [x] 2. Session Token Provider
  - [x] 2.1 Implement `scripts/lib/bot-session.ts`
    - Given a bot's Clerk user id, create a Clerk session directly (`sessions.createSession`) and mint tokens from it (`sessions.getToken`) — simpler than a sign-in-token exchange and equally a real, non-bypass auth path
    - Expose `getToken()` that returns a cached, auto-refreshed token (lazy refresh on each call rather than a background timer — every bot HTTP call already goes through it)
    - Also ships `apiFetch()`, a thin client mirroring the API's `{ data, error, meta }` envelope
    - _Requirements: (supports all of Requirement 2 & 3 — every bot HTTP call needs a real token)_
  - [x] 2.2 Manual verification
    - Minted a token for a bootstrap driver bot, called `POST /driver/location` directly with it: 200, then confirmed the API's own rate limiter returns 429 on an immediate second call
    - _Requirements: 5.2 (confirm no secret ends up in a log line)_

- [x] 3. Driver Bot State Machine
  - [x] 3.1 Implement `scripts/lib/driver-bot.ts`
    - `idle` loop: POST `/driver/location` at bot's current position every 2s
    - Poll `delivery_offers` for a `pending` row addressed to this bot every 2s
    - _Requirements: 2.1_
  - [x] 3.2 Implement accept/ignore decision
    - Randomized delay scaled by `--speed`, then accept via `POST /deliveries/:id/accept` with probability `--accept-rate`, else no-op
    - Handle `matched: false` response by logging and returning to idle
    - _Requirements: 2.2, 2.3_
  - [x] 3.3 Implement leg progression + GPS interpolation
    - On successful accept, look up the assigned leg (`delivery_legs` where `actorType='driver'`, `actorId`=this driver, `isActive=true` — offers don't carry a `legId`) and walk the real status sequence via `PATCH /deliveries/:deliveryId/legs/:legId/status`
    - Interpolate lat/lng between leg pickup/dropoff coordinates (`haversineKm` from `@surewaka/shared`), pinging location (with `deliveryId`) every 2s en route
    - Scale total per-leg time by `--speed` based on leg distance at ~25km/h baseline
    - Return to idle after `delivered`
    - _Requirements: 2.4, 2.5, 2.6, 2.7_
  - [x] 3.4 Manual verification
    - Manually seeded a delivery + leg + pending offer for a bootstrap bot (full booking flow not wired up yet — that's task 6), ran the bot against the real API: accepted, walked the complete status sequence, final DB state confirmed `delivered` with the correct `actorId`
    - En route, found and fixed a real production bug this exposed: `delivery_legs.actor_id` was never assigned to the matched driver anywhere in the codebase (see the dedicated fix commit) — without it, no real driver could ever progress a leg past acceptance
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
