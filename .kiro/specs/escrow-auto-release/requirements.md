# Requirements Document

## Introduction

Nothing in the codebase ever triggers escrow release. `workers/payment-worker/src/jobs/escrow-release.ts` correctly implements the payout — splits `escrow_holds.total_amount` into commission and driver amounts, credits the driver's wallet, records the ledger entry, sends a push notification — but it's only reachable via a BullMQ `'escrow-release'` job on the `payment` queue, and nothing anywhere enqueues that job. The only call site of `enqueuePaymentJob` in the whole codebase is `'process-payout'` (manual driver withdrawal requests, `apps/api/src/routes/payouts.ts`).

The domain glossary (`CONTEXT.md`, `Delivery_Completion`) documents the intended behavior: *"After the driver marks `delivered`, a 30-minute dispute window begins. Escrow for the leg is released to the driver's wallet automatically after the window closes with no dispute."* No code implements that window or schedules the release at the end of it. Net effect: **every delivery ever marked delivered leaves its driver unpaid, permanently**, with the money sitting in `escrow_holds.status = 'held'` until someone manually intervenes (if anyone even knows to look).

Found while testing the actor-simulator (`.kiro/specs/actor-simulator/`) — asked "what happens to the money in escrow" after a bot driver completed a delivery, and traced the answer to "nothing."

## Glossary

(See `CONTEXT.md`'s `Delivery_Completion` entry for the authoritative definition this spec must satisfy.)

- **Dispute_Window**: The 30-minute period after a leg/delivery is marked `delivered` during which a dispute can be filed to block release.
- **Escrow_Release_Trigger**: Whatever schedules the delayed release job and, if a dispute is filed within the Dispute_Window, cancels it — the missing piece this spec adds.

## Open Design Question (do not resolve in requirements — confirm during design)

`escrow_holds` is one row per **delivery**, with a single `driver_wallet_id` and a single `total_amount` released in one payout. That models a single-driver, single-leg on-demand delivery correctly. It does **not** obviously extend to a multi-leg `surewaka_way` delivery with different actors per leg (a first-mile driver, a carrier, possibly a different last-mile driver) — today's schema has nowhere to record "this driver gets paid for their leg, that carrier gets paid for theirs, independently, as each one completes." Design must confirm: does release happen once per *delivery* (all legs done) or per *leg* (each actor paid as their own leg completes)? The glossary text ("escrow for the leg") suggests per-leg was the intent, which the current schema doesn't support — this may require a schema change (e.g. per-leg escrow rows) rather than just adding a trigger to the existing one.

## Requirements

### Requirement 1: Start the Dispute Window on Delivery Completion

**User Story:** As a driver, I want to be paid automatically after I complete a delivery and no one disputes it, so that I don't have to chase payment manually.

#### Acceptance Criteria

1. WHEN a delivery (or leg — see Open Design Question) is marked `delivered`, THE system SHALL schedule an escrow-release job delayed by the configured Dispute_Window (default 30 minutes)
2. THE Dispute_Window duration SHALL be admin-configurable (matching the existing pattern for other timing knobs, e.g. `matching.first_mile_dispatch_buffer_min` in `system_config`), not hardcoded
3. THE scheduled job SHALL use a deterministic, idempotent job ID so a duplicate `delivered` event (e.g. a retried request) does not schedule a second release

### Requirement 2: Cancel Release on Dispute

**User Story:** As a customer, I want my payment held if I dispute a delivery within the window, so a driver isn't paid before my issue is resolved.

#### Acceptance Criteria

1. IF a dispute is filed (`escrow_holds.status` → `'disputed'`) before the Dispute_Window elapses, THEN THE system SHALL cancel the scheduled release job before it fires
2. IF the scheduled release job fires anyway (race with a dispute filed in the same moment), THEN THE release handler SHALL check the hold's current status and refuse to release a non-`'held'` hold, rather than blindly paying out
3. WHEN a dispute is later resolved without fault to the driver, THE system SHALL provide a way to release the (still-held) escrow — either by re-scheduling or an explicit admin action (confirm which during design)

### Requirement 3: Visibility Into Stuck/Pending Escrow

**User Story:** As an ops admin, I want to see escrow holds that are overdue for release, so today's silent-forever-stuck state can never happen again even if this trigger has its own bug.

#### Acceptance Criteria

1. THE system SHALL provide a way (admin view, alert rule, or cron sweep — confirm during design) to detect an `escrow_holds` row still `'held'` well past `heldAt + Dispute_Window` with no scheduled release job, mirroring the existing `rescue-missed-matching.ts` safety-net pattern for the matching subsystem
2. This requirement exists specifically because Requirement 1's predecessor (no trigger at all) went undetected until manual testing — a monitoring gap, not just a logic gap, contributed to that

## Out of Scope (for design phase to confirm, not decide here)

- Retroactively releasing escrow for deliveries already stuck in `held` from before this fix ships (may need a one-off backfill script, separate from the ongoing trigger mechanism)
- Any change to the payout math in `escrow-release.ts` itself — that logic is correct, only the trigger is missing
- Partial/weight-correction-driven escrow adjustments (`weight-correction-service.ts`, `weight-correction-expiry.ts`) — those are a separate, already-implemented mechanism; this spec is only about the base release trigger
