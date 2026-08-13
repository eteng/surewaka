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

- [x] 5. CLI Entry Point
  - [x] 5.1 Implement `scripts/simulate-actors.ts`
    - Parse `--drivers`, `--carriers`, `--speed`, `--accept-rate` (defaults 5/1/1/0.9)
    - Load bot identities by `bot+` email convention (filtered to active roles); spawn the bootstrap script first (it lives in a different package, so it's a child process via `pnpm --filter @surewaka/api seed:bot-actors`, not an import)
    - Start all driver/carrier bot loops concurrently, isolated per bot so one failing to start doesn't stop the others
    - Structured logging (bot id, timestamp, action); location pings excluded from routine logging by construction (driver-bot.ts never logs them)
    - Graceful shutdown on SIGINT via a shared `AbortController`: bots finish their current step, then exit — verified with a real `kill -INT`
    - _Requirements: 4.1–4.6_
  - [x] 5.2 Add `pnpm sim:actors` script to root `package.json`
    - _Requirements: 4.1_
  - [x] 5.3 Document in `AGENTS.md` under a new "Actor Simulator" section
    - Command reference, what it needs running first (`pnpm dev`), what `--reset` does
    - _Requirements: (documentation, no specific acceptance criterion)_
  - [x] 5.4 (added) Harden against the API being briefly unreachable
    - Found via testing: a network-level fetch failure previously propagated uncaught out of `apiFetch`, and one bot's rejected promise took down the entire `Promise.all` — the whole simulator, not just that bot
    - `apiFetch` now never throws (network failures come back as a normal `{ok:false}` result); each bot's loop body is wrapped so a DB hiccup logs and retries; matches Requirement 4.5
    - _Requirements: 4.5_

- [x] 6. End-to-End Verification
  - [x] 6.1 Full manual pass, run by Claude against the real dev stack (API, workers, Redis, Postgres, real Clerk dev instance)
    - `pnpm sim:actors -- --drivers 2 --carriers 1 --speed 20 --accept-rate 1` against a running `pnpm dev` stack
    - Seeded a single-leg on-demand delivery (booking flow itself not wired up — no in-app booking UI change was in scope): bot matched, accepted, walked the full status sequence to `delivered`
    - Seeded a multi-leg surewaka_way delivery (first-mile driver leg → intercity carrier leg): driver bot completed its leg, carrier bot correctly waited (`precedingLegDelivered`) then claimed and completed its own leg — full chain reached `delivered`, including the top-level `deliveries.status` (task 5's bug fix)
    - Re-ran bootstrap with a higher `--drivers` count (top-up only, confirmed only the shortfall created), ran `--reset` (confirmed deactivation, not deletion), ran again without `--reset` (confirmed reactivation, not duplication)
    - Sent a real `SIGINT`: confirmed the "shutting down" message, bots finishing in-flight work, and a clean process exit
    - Not verified here (needs a physical device, outside what Claude can drive): booking from the actual `mobile-customer` Expo app on a phone over LAN IP. The API-level behavior a phone booking would trigger is the same path just exercised via direct seeding, so this is expected to work, but hasn't been watched end-to-end from the phone's UI.
    - _Requirements: all_
