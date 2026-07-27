# ADR-010: Timed Dispatch for Driver Matching on Multi-Leg Deliveries

## Status

Accepted

## Context

SureWaka's `surewaka_way` deliveries chain multiple legs: first-mile (customer → park), intercity (carrier park-to-park), transfer (park-to-park in same city), and last-mile (park → recipient). Each driver-operated leg (first-mile, transfer, last-mile) requires real-time driver matching — finding and dispatching a nearby driver to perform the leg.

The question is *when* to trigger matching for each leg. Two approaches were considered:

1. **Immediate dispatch** — trigger matching the moment the preceding condition is met (customer confirms for first-mile, carrier marks delivered for transfer/last-mile). Simple, but wasteful: a first-mile driver dispatched 6 hours before carrier departure waits at the park for hours, consuming driver capacity that could serve other deliveries.

2. **Timed dispatch** — compute the optimal trigger time relative to a downstream deadline (carrier departure for first-mile/transfer, business hours for last-mile), accounting for road distance ETA and a configurable buffer. More complex, but keeps drivers productive until they're actually needed.

Lagos traffic is highly variable. A first-mile leg with a 20-minute ETA can take 60+ minutes during peak hours. Any dispatch timing must include a safety margin.

## Decision

**Timed dispatch with a configurable buffer, implemented as BullMQ delayed jobs with a cron safety net.**

### Trigger timing per leg type:

| Leg type | Anchor event | Trigger formula |
|----------|-------------|-----------------|
| `first_mile` | Customer confirms + pays | `max(carrierDeparture - legETA - buffer, now)` |
| `transfer` | Preceding intercity leg marked `delivered` | `max(nextCarrierDeparture - legETA - buffer, now)` |
| `last_mile` | Preceding intercity/transfer leg marked `delivered` | `max(nextBusinessHourStart, customerWindow - legETA - buffer, now)` |

### Mechanism:

- **Primary:** BullMQ delayed job enqueued at confirmation (first-mile) or at intercity completion (transfer/last-mile), with `delay: triggerAt - now` in milliseconds.
- **Safety net:** A cron job (every 5 min) queries for legs that should have started matching but haven't — same pattern as the existing `rescue-stale-routing.ts` for the routing worker.
- **Clamp:** If `triggerAt <= now` (deadline already past, late confirmation, system catching up), dispatch immediately.

### Buffer:

- Default: 45 minutes (5 min matching + 10 min driver-to-pickup + 30 min traffic headroom)
- Stored in `fee_settings` as `firstMileDispatchBufferMin`
- Admin-configurable without code deploy

### Last-mile business hours:

- Default operating window: 7am–9pm (or park opening hours)
- If intercity leg completes overnight, last-mile matching delays until next business hour start
- Customer can optionally specify a preferred delivery window at booking; matching triggers at `windowStart - lastMileETA - buffer`

## Consequences

**Positive:**
- Drivers stay productive — not dispatched hours before they're needed
- Reduces idle time at parks, improving driver satisfaction and platform utilization
- Consistent pattern across all driver legs (same formula, same mechanism)
- Buffer is tunable — ops can widen it during known high-traffic periods (e.g., Fridays) without code changes
- Safety net cron ensures no leg is permanently stuck if the delayed job is lost (Redis restart, Upstash eviction)

**Negative / trade-offs:**
- Added scheduling complexity vs. simple "dispatch immediately"
- Delayed jobs in Redis consume memory (negligible: one key per pending leg)
- If the buffer is too conservative, packages arrive early and wait; if too aggressive, they risk missing the departure
- Requires accurate road-distance ETA (Mapbox Directions already integrated per pricing grilling Q1)

**Follow-up work:**
- Time-of-day aware buffer (wider during peak Lagos traffic hours) — future optimization
- Driver incentive/surge pricing if matching repeatedly fails close to deadline — not in scope for MVP

## Alternatives Considered

1. **Immediate dispatch on confirmation** — Rejected: wastes driver capacity. A first-mile dispatched 6 hours early occupies a driver's active slot (one active leg per driver) for the duration, reducing supply for other customers.

2. **Cron-only (no delayed jobs)** — Rejected: polling every 5 min introduces up to 5 min of unnecessary latency. Delayed jobs fire at the precise computed time. Cron is kept as a safety net only.

3. **Customer chooses dispatch time** — Rejected as the primary mechanism: most customers don't know or care when the driver should be dispatched. They care about the package arriving on time. The system should optimize internally. Customer preference is limited to an optional delivery window for last-mile.

## When to Revisit

- When real-world data shows the 45-min default buffer is consistently too conservative or too tight — tune the setting, potentially make it time-of-day-aware.
- When driver supply grows large enough that immediate dispatch wouldn't meaningfully constrain capacity — the optimization benefit of timed dispatch diminishes at high supply.
