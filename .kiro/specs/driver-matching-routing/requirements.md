# Requirements Document

## Introduction

This document defines the functional and non-functional requirements for the Driver Matching & Routing system within SureWaka. The system finds the best available driver for a delivery leg, offers the job through a tiered broadcast strategy, and handles acceptance atomically to prevent double-assignment. It supports both on-demand single-leg deliveries and multi-leg surewaka_way deliveries with timed dispatch scheduling per ADR-010.

## Glossary

- **Driver_Matching_System**: The subsystem responsible for finding, scoring, offering, and assigning verified available drivers to delivery legs with `actor_type = 'driver'`.
- **Location_Store**: The Redis Geospatial component that stores real-time driver GPS positions for sub-millisecond spatial queries.
- **Scoring_Engine**: The pure function component that ranks candidate drivers by weighted factors (distance, acceptance rate, completion rate, rating, idle time, heading direction).
- **Matching_Orchestrator**: The BullMQ job handler that executes the tiered broadcast algorithm across three expanding radius tiers.
- **Acceptance_Handler**: The API route that processes a driver's accept action with atomic first-accept-wins resolution via Redis SET NX and Postgres safety constraints.
- **Reservation_Layer**: The atomicity component using Redis Lua scripts to prevent double-assignment of drivers during the offer window.
- **Delivery_Offer**: A time-limited job offer record sent to a specific driver for a specific delivery, stored in the `delivery_offers` table.
- **Cron_Sweeper**: The safety net cron job that detects and re-enqueues missed BullMQ delayed jobs for driver matching every 5 minutes.
- **Timed_Dispatch**: The scheduling strategy per ADR-010 computing trigger time as `max(deadline − legETA − buffer, now)`.
- **Self_Drop**: The fallback mechanism when first-mile driver matching fails, offering the customer the option to drop their package at the park themselves.
- **Tier**: One of three concentric search radiuses (5km, 8km, 12km) with increasing candidate counts and wait times.
- **NIL_UUID**: The sentinel value `00000000-0000-0000-0000-000000000000` representing an unassigned actor on a delivery leg.

## Requirements

### Requirement 1: Real-Time Driver Location Storage

**User Story:** As a driver, I want my GPS position to be stored in real-time, so that the matching system can find me when nearby deliveries are available.

#### Acceptance Criteria

1. WHEN a driver sends a location update, THE Location_Store SHALL store the driver position in the Redis Geo Sorted Set at the provided longitude and latitude coordinates
2. WHEN a driver sends a location update, THE Location_Store SHALL store driver metadata (lastSeen timestamp, status, vehicleType, lat, lng) in a Redis Hash keyed by driver ID
3. WHEN a driver logs out or disconnects, THE Location_Store SHALL remove the driver from both the Geo Sorted Set and the metadata Hash
4. WHEN a location update is received, THE Location_Store SHALL publish the position to the Ably `driver-location:{driverId}` channel for live tracking subscribers
5. WHILE a driver has an active delivery, THE Location_Store SHALL persist the location to a Postgres audit trail table in addition to Redis

### Requirement 2: Nearby Driver Discovery

**User Story:** As the matching system, I want to find available drivers near a pickup location, so that I can offer the delivery to the closest suitable candidates.

#### Acceptance Criteria

1. WHEN a spatial search is requested, THE Location_Store SHALL return drivers within the specified radius sorted by distance ascending
2. WHEN returning nearby drivers, THE Location_Store SHALL exclude drivers whose lastSeen timestamp exceeds 30 seconds (stale drivers)
3. WHEN returning nearby drivers, THE Location_Store SHALL exclude drivers whose status is not 'available'
4. WHERE a vehicleType filter is specified, THE Location_Store SHALL return only drivers matching the requested vehicle type
5. THE Location_Store SHALL perform spatial queries without mutating any Redis state

### Requirement 3: Tiered Broadcast Matching Algorithm

**User Story:** As a customer, I want the platform to find a driver for my delivery through progressively wider searches, so that I get matched quickly with a nearby driver or within a reasonable time with a slightly farther one.

#### Acceptance Criteria

1. WHEN matching starts, THE Matching_Orchestrator SHALL search for drivers in Tier 1 (5km radius), select the top 5 scored candidates, and wait 30 seconds for acceptance
2. WHEN Tier 1 expires without acceptance, THE Matching_Orchestrator SHALL escalate to Tier 2 (8km radius), select the next 10 scored candidates, and wait 30 seconds
3. WHEN Tier 2 expires without acceptance, THE Matching_Orchestrator SHALL escalate to Tier 3 (12km radius), broadcast to all eligible candidates (up to 50), and wait 3 minutes
4. THE Matching_Orchestrator SHALL expand the search radius monotonically across tiers (5km < 8km < 12km) and never contract it
5. THE Matching_Orchestrator SHALL not re-offer a delivery to a driver who was already offered in a previous tier
6. WHEN all three tiers expire without acceptance, THE Matching_Orchestrator SHALL cancel the delivery and trigger a refund flow
7. THE Matching_Orchestrator SHALL resolve every matching attempt (matched or cancelled) within a maximum of 5 minutes total elapsed time

### Requirement 4: Driver Scoring and Ranking

**User Story:** As the platform, I want to rank candidate drivers by a composite score, so that the most suitable driver is offered the delivery first.

#### Acceptance Criteria

1. THE Scoring_Engine SHALL compute a composite score using distance (−10 per km), acceptance rate (+20 × rate), completion rate (+15 × rate), rating bonus (+10 if ≥ 4.5, −15 if < 4.0), idle time bonus (+10 if > 30 min, +5 additional if > 60 min), and heading bonus (+8 if heading toward pickup)
2. THE Scoring_Engine SHALL return candidates sorted in descending order by score
3. THE Scoring_Engine SHALL produce a score greater than or equal to zero for all valid inputs
4. THE Scoring_Engine SHALL return an output array of the same length as the input candidate array
5. THE Scoring_Engine SHALL produce identical output ordering for identical inputs across multiple invocations (deterministic, pure function)

### Requirement 5: Atomic Driver Reservation

**User Story:** As the platform, I want to atomically reserve a driver before offering them a delivery, so that no driver receives concurrent offers from multiple deliveries.

#### Acceptance Criteria

1. WHEN reserving a driver, THE Reservation_Layer SHALL atomically check the driver's status and set the reservation in a single Redis Lua script execution (no TOCTOU race)
2. WHEN a driver is already reserved by another delivery, THE Reservation_Layer SHALL reject the reservation and return the reason
3. WHEN a driver's status is not 'available', THE Reservation_Layer SHALL reject the reservation
4. WHEN a reservation is granted, THE Reservation_Layer SHALL set a TTL of 60 seconds for automatic expiry of zombie reservations
5. WHEN a tier expires or delivery is cancelled, THE Reservation_Layer SHALL explicitly release all associated driver reservations

### Requirement 6: First-Accept-Wins Delivery Claim

**User Story:** As a driver, I want to accept a delivery offer with guaranteed atomicity, so that exactly one driver is assigned even when multiple drivers tap Accept simultaneously.

#### Acceptance Criteria

1. WHEN a driver accepts an offer, THE Acceptance_Handler SHALL attempt an atomic claim via Redis SET NX on the delivery claim key
2. WHEN the atomic claim succeeds, THE Acceptance_Handler SHALL update the delivery record in Postgres with the driver ID and status 'accepted', using a WHERE clause `driver_id IS NULL` as safety net
3. WHEN the atomic claim fails (another driver already claimed), THE Acceptance_Handler SHALL return `matched: false` with no state mutations
4. WHEN a delivery is successfully claimed, THE Acceptance_Handler SHALL cancel all other pending offers for that delivery
5. WHEN a delivery is successfully claimed, THE Acceptance_Handler SHALL release all driver reservations associated with that delivery
6. WHEN a delivery is successfully claimed, THE Acceptance_Handler SHALL publish a 'driver-assigned' event via Ably and send a push notification to the customer
7. IF a driver sends multiple accept requests for the same delivery, THEN THE Acceptance_Handler SHALL process only the first request and return `matched: false` for subsequent requests without side effects
8. WHEN a driver attempts to accept, THE Acceptance_Handler SHALL validate that the driver has a pending offer record for that delivery before proceeding

### Requirement 7: Double-Assignment Prevention

**User Story:** As the platform, I want to guarantee that no delivery is assigned to more than one driver and no driver holds more than one active delivery, so that consistency is maintained.

#### Acceptance Criteria

1. THE Driver_Matching_System SHALL enforce that at most one driver is assigned to any single delivery at any point in time
2. THE Driver_Matching_System SHALL enforce that a driver cannot hold two active deliveries simultaneously via a Postgres unique partial index on `deliveries(driver_id)` for active statuses
3. WHEN an offer is sent to a driver, THE Matching_Orchestrator SHALL record a corresponding `delivery_offers` row in Postgres before sending the push notification

### Requirement 8: Delivery Offer Audit Trail

**User Story:** As an operations manager, I want a complete record of all offers made for every delivery, so that I can audit matching decisions and debug issues.

#### Acceptance Criteria

1. WHEN an offer is sent, THE Matching_Orchestrator SHALL insert a `delivery_offers` record with deliveryId, driverId, tier number, computed score, distance at time of offer, and status 'pending'
2. WHEN a driver accepts an offer, THE Acceptance_Handler SHALL update the offer status to 'accepted' with a respondedAt timestamp
3. WHEN a tier expires without acceptance, THE Matching_Orchestrator SHALL update all pending offers in that tier to status 'expired'
4. WHEN a delivery is claimed by a driver, THE Acceptance_Handler SHALL update all other pending offers for that delivery to status 'cancelled'

### Requirement 9: Multi-Leg Timed Dispatch (First-Mile)

**User Story:** As the platform, I want to schedule first-mile driver matching at the optimal time before carrier departure, so that drivers are not dispatched hours early and capacity is not wasted.

#### Acceptance Criteria

1. WHEN a surewaka_way route is computed, THE Driver_Matching_System SHALL schedule the first-mile matching job as a BullMQ delayed job with delay computed as `max(carrierDeparture − legETA − buffer, now)` per ADR-010
2. THE Driver_Matching_System SHALL read the buffer value from `system_config` via `getConfig('matching.first_mile_dispatch_buffer_min')` with a default of 45 minutes
3. IF the computed trigger time is in the past (late booking or system catching up), THEN THE Driver_Matching_System SHALL dispatch matching immediately with delay of 0
4. THE Driver_Matching_System SHALL use a deterministic jobId format `match-leg:{legId}` to prevent duplicate job enqueue

### Requirement 10: Multi-Leg Event-Driven Dispatch (Transfer and Last-Mile)

**User Story:** As the platform, I want to trigger transfer and last-mile driver matching when the preceding intercity leg completes, so that each leg is matched in sequence without a central orchestrator.

#### Acceptance Criteria

1. WHEN an intercity leg is marked 'delivered', THE Driver_Matching_System SHALL identify the next active driver-type leg and enqueue a matching job for it
2. WHEN the next leg is a transfer, THE Driver_Matching_System SHALL compute the delay as `max(nextCarrierDeparture − legETA − buffer, now)`
3. WHEN the next leg is a last-mile, THE Driver_Matching_System SHALL compute the delay as `max(nextBusinessHourStart, customerWindow − legETA − buffer, now)` respecting the 7am–9pm operating window
4. WHILE the current time is outside business hours (before 7am or after 9pm), THE Driver_Matching_System SHALL delay last-mile matching until the next business hour start (7am)
5. WHERE a customer has specified a preferred delivery window, THE Driver_Matching_System SHALL use the window start time instead of `systemEtaAt` when computing the last-mile trigger time
6. THE Driver_Matching_System SHALL trigger a leg's matching only after all preceding legs are complete (sequential execution without central orchestrator)

### Requirement 11: Matching Trigger Safety Net (Cron Sweeper)

**User Story:** As an operations manager, I want a safety net that catches missed matching triggers, so that no delivery leg is permanently stuck if a BullMQ delayed job is lost.

#### Acceptance Criteria

1. THE Cron_Sweeper SHALL run every 5 minutes and scan for driver-type legs in 'pending' status with `actorId = NIL_UUID` where `systemEtaAt − buffer ≤ now`
2. WHEN a missed leg is detected, THE Cron_Sweeper SHALL check if a BullMQ job already exists for that leg before enqueuing
3. WHEN no existing job is found for a missed leg, THE Cron_Sweeper SHALL enqueue a matching job immediately with `delayMs = 0`
4. THE Cron_Sweeper SHALL use the deterministic jobId format `match-leg:{legId}` for deduplication to prevent double-enqueue
5. THE Cron_Sweeper SHALL process at most 20 missed legs per run (batch limit)
6. THE Cron_Sweeper SHALL read the buffer from `system_config` via `getConfig('matching.first_mile_dispatch_buffer_min')` (default: 45 minutes)

### Requirement 12: Self-Drop Fallback

**User Story:** As a customer, I want the option to drop off my package at the park myself when no first-mile driver is available, so that my surewaka_way delivery can still proceed.

#### Acceptance Criteria

1. WHEN first-mile matching fails (all tiers exhausted with no acceptance), THE Driver_Matching_System SHALL offer the customer a self-drop-off option via push notification including the park name and a cancellation deadline
2. WHEN the customer accepts self-drop-off, THE Driver_Matching_System SHALL cancel the first-mile leg (status = 'cancelled', isActive = false) and refund the first-mile quote portion
3. WHEN the customer accepts self-drop-off, THE Driver_Matching_System SHALL keep remaining legs (intercity, transfer, last-mile) active and proceeding normally
4. IF the customer does not respond to the self-drop-off offer within 15 minutes, THEN THE Driver_Matching_System SHALL cancel the entire delivery with a full refund and notify operations
5. IF the customer declines the self-drop-off offer, THEN THE Driver_Matching_System SHALL cancel the entire delivery with a full refund

### Requirement 13: Cancellation Handling

**User Story:** As a customer, I want to cancel my delivery during matching without leaving orphaned jobs or inconsistent state, so that the system cleans up gracefully.

#### Acceptance Criteria

1. WHEN a customer cancels a delivery while matching is in progress, THE Matching_Orchestrator SHALL check delivery status at each tier boundary and exit immediately if cancelled
2. WHEN a customer cancels before a scheduled first-mile match triggers, THE Driver_Matching_System SHALL remove the delayed BullMQ job before it fires
3. WHEN matching exits due to cancellation, THE Matching_Orchestrator SHALL release all driver reservations and expire all pending offers

### Requirement 14: Admin-Configurable Parameters

**User Story:** As an operations administrator, I want to adjust matching parameters without code deployment, so that I can tune the system for varying traffic conditions.

#### Acceptance Criteria

1. THE Driver_Matching_System SHALL read the dispatch buffer from `system_config` key `matching.first_mile_dispatch_buffer_min` (default: 45 minutes) via `getConfig()`
2. WHEN an admin updates the buffer value in `system_config`, THE Driver_Matching_System SHALL reflect the change within 5 minutes (in-memory cache TTL) without requiring code deployment
3. THE Scoring_Engine SHALL support configurable scoring weights that can be overridden from default values

### Requirement 15: Error Recovery and Resilience

**User Story:** As the platform, I want the matching system to recover gracefully from infrastructure failures, so that deliveries are not permanently stuck.

#### Acceptance Criteria

1. IF Redis becomes unavailable during matching, THEN THE Matching_Orchestrator SHALL rely on BullMQ's retry mechanism (3 attempts, exponential backoff from 5 seconds)
2. IF all retry attempts fail, THEN THE Matching_Orchestrator SHALL mark the delivery as 'routing_failed' and notify the customer
3. IF a worker crashes mid-matching, THEN THE Matching_Orchestrator SHALL rely on BullMQ stalled job detection (60s interval) to re-run the job from the beginning
4. WHEN a stalled job is re-run, THE Matching_Orchestrator SHALL start fresh from GEOSEARCH since previous reservations auto-expire via TTL

### Requirement 16: Security and Access Control

**User Story:** As the platform, I want all matching endpoints to be secured and validated, so that only authorized users can interact with the system.

#### Acceptance Criteria

1. THE Acceptance_Handler SHALL require a valid Clerk JWT via `requireAuth` middleware for all requests
2. THE Acceptance_Handler SHALL validate that the authenticated user has the driver role and owns the offer before processing acceptance
3. THE Location_Store SHALL rate-limit location updates to a maximum of 1 request per 2 seconds per driver
4. THE Driver_Matching_System SHALL validate all input coordinates, UUIDs, and enum values via Zod schemas before processing
