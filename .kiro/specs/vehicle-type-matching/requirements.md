# Requirements Document

## Introduction

The customer picks (or the app derives) a `vehicleType` for an on-demand leg at quote time — it's sent to `POST /booking/quote` and used there to compute the price (`computeOnDemandQuote` applies the vehicle type's rate multiplier). But that choice is never persisted anywhere past the quote step: neither `deliveries` nor `delivery_legs` has a `vehicle_type` column. Every place that later constructs a driver-matching job — `trigger-next-leg.ts`, `compute-route.ts`, and `booking-payment.ts`'s initial-match trigger (see `.kiro/specs/actor-simulator/`) — has nowhere to read the real value from, so all three hardcode `vehicleType: 'motorcycle'`.

Net effect: **every on-demand delivery is matched as if it were a motorcycle job, regardless of what the customer actually selected or what the package needs.** A customer who picked "van" for a heavy/bulky item gets searched against motorcycle drivers only — nearby van drivers are invisible to that search, and in the worst case a motorcycle driver could end up offered a job their vehicle can't actually carry.

Found while testing the actor-simulator (`.kiro/specs/actor-simulator/`): a bot driver 5km away with the correct vehicle type would have matched instantly; instead the search silently ignored it because it wasn't a motorcycle.

## Glossary

- **Requested_Vehicle_Type**: The vehicle type the customer selected (or the app derived) for an on-demand leg at quote/booking time — currently computed and used once, then lost.
- **Match_Job_Vehicle_Type**: The `vehicleType` field on a `MatchDriverJobData` payload, used by `findNearbyDrivers` to filter geospatial candidates. Currently always `'motorcycle'`, regardless of Requested_Vehicle_Type.

## Requirements

### Requirement 1: Persist the Requested Vehicle Type

**User Story:** As a customer, I want the vehicle type I selected for my delivery to actually be used when finding me a driver, so that I'm matched with someone who can carry my package and I'm not invisible to nearby eligible drivers of other types.

#### Acceptance Criteria

1. WHEN a delivery leg with `actor_type = 'driver'` is created (on-demand, direct carrier-route selection, or surewaka_way auto-routing), THE system SHALL persist the Requested_Vehicle_Type for that leg
2. THE persisted value SHALL be readable by any code path that later constructs a driver-matching job for that leg, without needing to re-derive or guess it
3. IF no Requested_Vehicle_Type is available for a leg (e.g. a pre-existing row from before this change), THEN THE system SHALL fall back to `'motorcycle'`, matching current behavior — no silent breakage of in-flight deliveries

### Requirement 2: Use the Real Vehicle Type When Matching

**User Story:** As a driver, I want to only be offered jobs suited to my vehicle, and as a customer I want the platform to actually search among drivers who can take my package, not just motorcycles.

#### Acceptance Criteria

1. WHEN `booking-payment.ts` enqueues the initial match job for a delivery's first leg, THE job's `vehicleType` SHALL be that leg's persisted Requested_Vehicle_Type (Requirement 1), not a hardcoded default
2. WHEN `trigger-next-leg.ts` enqueues matching for a subsequent driver-type leg (transfer/last-mile), THE job's `vehicleType` SHALL be that leg's persisted Requested_Vehicle_Type
3. WHEN `compute-route.ts` (surewaka_way) schedules first-mile matching, THE job's `vehicleType` SHALL be that leg's persisted Requested_Vehicle_Type
4. WHEN the cron rescue-sweeper (`rescue-missed-matching.ts`) re-enqueues a missed match, THE job's `vehicleType` SHALL be that leg's persisted Requested_Vehicle_Type

## Out of Scope (for the eventual design phase to confirm, not decide here)

- Whether last-mile/transfer legs can have a *different* vehicle type than first-mile for the same delivery (today's quote flow may already assume one vehicle type per delivery — needs confirming, not assuming, during design)
- Any change to how the customer selects/derives vehicle type in the mobile app UI — this is purely about persisting and threading through what's already selected
