# Requirements Document

## Introduction

Et needs to test SureWaka end-to-end as a real customer on a physical mobile device, while every other actor a delivery depends on — on-demand drivers and carrier intercity legs — behaves realistically without requiring a room full of test phones. This document defines requirements for an **Actor Simulator**: a local dev-only tool that runs a pool of headless bot drivers and bot carrier-agents as real, Clerk-authenticated accounts against the local API, so the full matching → acceptance → in-transit → delivered pipeline can be watched live from the customer app.

## Glossary

- **Bot**: A seeded test account (driver or carrier_driver role) controlled by the Actor Simulator instead of a human.
- **Bot_Identity_Bootstrap**: The one-time (idempotent) setup step that creates real Clerk users and matching DB rows for the bot pool.
- **Actor_Simulator**: The CLI process that runs all bots as concurrent state machines against a live local backend.
- **Driver_Bot**: A bot with the `driver` role that participates in on-demand matching (accepts offers, progresses first/last-mile legs).
- **Carrier_Bot**: A bot with the `carrier_driver` role, attached to a seeded carrier, that progresses that carrier's intercity legs.
- **Speed_Multiplier**: A CLI flag scaling how fast bots move/transition relative to real time.
- **Accept_Rate**: A CLI flag controlling the probability a bot accepts a given offer instead of ignoring it.

## Requirements

### Requirement 1: Bot Identity Bootstrap

**User Story:** As Et, I want a pool of real, authenticatable driver and carrier bot accounts, so that the simulator can act on the real API instead of hitting auth walls.

#### Acceptance Criteria

1. WHEN the bootstrap script runs with `--drivers N`, THE Bot_Identity_Bootstrap SHALL ensure at least N driver bot accounts exist, each with a real Clerk user, a `users` row, and a `drivers` row (`verified: true`), creating only the shortfall if some already exist
2. WHEN the bootstrap script runs with `--carriers M` and at least one active carrier is already seeded, THE Bot_Identity_Bootstrap SHALL ensure at least M carrier bot accounts exist, each with a real Clerk user, a `users` row, and an active `carrier_members` row against a seeded carrier
3. IF `--carriers M` (M > 0) is passed and no active carrier exists, THEN THE Bot_Identity_Bootstrap SHALL fail with a message directing the user to run `seed-carriers.ts` first, and SHALL NOT create carrier bots
4. WHEN a bot account is created, THE Bot_Identity_Bootstrap SHALL assign its role (`driver` or `carrier_driver`) through the same role-assignment path (`assignRole`/`syncRolesToAuth`) used for real users, so Clerk `publicMetadata.roles` reflects the role
5. WHEN a driver bot is created, THE Bot_Identity_Bootstrap SHALL assign it a starting coordinate from a fixed spread of Lagos locations, so bots are discoverable by nearby-driver matching without manual setup
6. WHEN run with `--reset`, THE Bot_Identity_Bootstrap SHALL delete all bot Clerk users and their associated `users`/`drivers`/`carrier_members` rows, identified solely by the `bot+*@surewaka.test` email convention
7. THE Bot_Identity_Bootstrap SHALL identify bot accounts by email convention only — it SHALL NOT require a schema change or new DB column
8. WHEN the environment does not resolve to a local/dev database and Clerk instance, THE Bot_Identity_Bootstrap SHALL refuse to run

### Requirement 2: Driver Bot Behavior

**User Story:** As Et, watching my phone as a customer, I want bot drivers to behave like real drivers — appearing nearby, accepting or ignoring my delivery, and moving toward pickup and dropoff — so I can see the real matching and tracking pipeline work.

#### Acceptance Criteria

1. WHILE idle, THE Driver_Bot SHALL send location updates via the real `POST /driver-locations` endpoint at the same cadence the API's rate limit allows (every 2s), with no `deliveryId`, so it is visible to nearby-driver matching
2. WHEN a `pending` delivery offer exists for a Driver_Bot, THE Driver_Bot SHALL, after a short randomized delay scaled by Speed_Multiplier, accept it via the real `POST /deliveries/:id/accept` endpoint with probability equal to Accept_Rate, and otherwise take no action on it
3. IF a Driver_Bot's accept attempt returns `matched: false` (lost the race), THEN THE Driver_Bot SHALL log the loss and return to idle without further action on that delivery
4. WHEN a Driver_Bot's accept succeeds, THE Driver_Bot SHALL progress the assigned leg through each status in sequence (`accepted → en_route_pickup → arrived_pickup → picked_up → en_route_dropoff → arrived_dropoff → delivered`) via the real `PATCH /deliveries/:deliveryId/legs/:legId/status` endpoint
5. WHILE en route between pickup and dropoff, THE Driver_Bot SHALL send location updates that linearly interpolate between the leg's pickup and dropoff coordinates, with the `deliveryId` set, at the same 2s cadence
6. THE Driver_Bot SHALL scale the total time spent per leg by Speed_Multiplier, based on the leg's real distance at a plausible urban driving speed
7. AFTER a leg reaches `delivered`, THE Driver_Bot SHALL return to idle and become eligible for new offers again

### Requirement 3: Carrier Bot Behavior

**User Story:** As Et, I want carrier intercity legs to progress automatically too, so I can watch a full interstate "SureWaka way" delivery complete without manually flipping statuses in the admin panel.

#### Acceptance Criteria

1. WHILE running, THE Carrier_Bot SHALL poll for `delivery_legs` rows where `actor_type = 'carrier'` and `actor_id` matches its carrier, with a status other than `delivered`
2. WHEN a Carrier_Bot finds an eligible leg not already claimed by another bot in the same simulator run, THE Carrier_Bot SHALL claim it in-process and progress it through the same status sequence as a Driver_Bot, via the real `PATCH /deliveries/:deliveryId/legs/:legId/status` endpoint
3. THE Actor_Simulator SHALL ensure two Carrier_Bots on the same carrier never progress the same leg concurrently
4. THE Carrier_Bot SHALL scale status-transition pacing by Speed_Multiplier
5. THE Carrier_Bot SHALL NOT be required to send location updates

### Requirement 4: Simulator Control

**User Story:** As Et, I want a single command to start the whole bot pool with adjustable behavior, so I can tune realism vs. speed for a given test session.

#### Acceptance Criteria

1. THE Actor_Simulator SHALL accept `--drivers`, `--carriers`, `--speed`, and `--accept-rate` flags, defaulting to 5, 1, 1, and 0.9 respectively
2. WHEN started, THE Actor_Simulator SHALL run all configured bots concurrently in a single process
3. IF bot identities do not yet exist for the requested counts, THEN THE Actor_Simulator SHALL run the Bot_Identity_Bootstrap automatically before starting bot loops
4. THE Actor_Simulator SHALL log each bot action (location updates excluded from routine logging to avoid spam; offer decisions, accepts, and status transitions included) with a bot identifier and timestamp
5. WHEN the API or a dependent worker is unreachable, THE Actor_Simulator SHALL log the failure per affected bot and keep retrying rather than exiting the whole process
6. WHEN interrupted (Ctrl+C), THE Actor_Simulator SHALL allow in-flight HTTP calls to complete before exiting

### Requirement 5: Safety

**User Story:** As Et, I don't want a testing tool to ever be able to touch production data.

#### Acceptance Criteria

1. THE Bot_Identity_Bootstrap and Actor_Simulator SHALL refuse to run when `NODE_ENV === 'production'`
2. Bot session credentials (passwords, tokens) SHALL NOT be written to logs
