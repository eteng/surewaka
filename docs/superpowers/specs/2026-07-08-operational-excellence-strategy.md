# SureWaka Operational Excellence & Reliability Strategy

> **Authored:** 2026-07-08
> **Audience:** Eteng (CEO/CTO), Yobo (COO), internal ops team
> **Input:** Review-mined competitor audit of Kwik, Gokada, GIGGO, Sendbox, Topship, Kobo360, Faramove (2026-07-08)
> **Relationship to existing work:** Extends `2026-07-03-surewaka-admin-ops-intelligence-design.md` — that design built the *detection* layer (alert engine, ops hub, analytics). This document adds the *response* layer (process, ownership, SLAs) and identifies the *product* gaps (pricing transparency, refund automation, rider accountability) the audit surfaced that detection alone doesn't close.

---

## Why this document exists

The competitor audit found five failure modes that recur across nearly every Nigerian logistics app on the market — including category leaders with far more funding and headcount than SureWaka:

1. No live, human-reachable support once a rider/driver has the package
2. Refunds and wallet withdrawals silently stall
3. Tracking freezes or lies about where a package actually is
4. Pricing changes after the fact or isn't disclosed up front
5. No accountability loop when a rider/driver misbehaves

None of the seven competitors audited have solved all five. **SureWaka already has more of the underlying infrastructure built than the audit would suggest was necessary** — the alert engine (Spec 3) already has rules that detect four of these five failure modes at the data layer. What's missing is not primarily new detection code; it's the *response process* wired to that detection, plus three specific product gaps that have no spec yet. This document lays out both.

---

## Part 1 — Gap-to-infrastructure mapping

For each competitor failure mode, what SureWaka has already built, what's partially built, and what doesn't exist yet.

### Gap 1 — No accountability after handoff (Kwik, Gokada, GIGGO, Sendbox)

| Layer | Status | Detail |
|---|---|---|
| Detection | **Built** | `workers/alert-engine/src/rules/driver-silent.ts` and `driver-ghost.ts` already fire on GPS silence and driver-triggered cancellation/disappearance |
| Data model | **Built** | `driver_locations` history table enables dispute replay; `delivery_events` gives a full audit trail with `failure_cause` |
| Customer-facing surfacing | **Missing** | Push notifications are unchecked in `CLAUDE.md` Current State — a customer has no way to *know* a rider has gone silent; only ops sees the alert |
| Response process | **Missing** | No documented runbook for what an ops agent does in the 60 seconds after a `driver_silent` critical alert fires |

**Read:** the hard part (detection) is done. The gap is entirely in the last two rows — surfacing and process, not schema or workers.

### Gap 2 — Refunds/wallets silently stall (GIGGO's "obvious fraud" wallet, Kwik, Sendbox)

| Layer | Status | Detail |
|---|---|---|
| Data model | **Built** | `escrow_holds` already has `refunded_at` and an `escrowStatus` enum; `payout_requests` tracks `status` + `failure_reason` with Paystack transfer/recipient codes |
| Detection | **Built** | `workers/alert-engine/src/rules/dispute-filed.ts` exists as one of the 7 alert rules |
| Automated resolution | **Missing** | No spec for what happens *after* a dispute is filed — is there an SLA clock, an auto-refund path for clear-cut cases, or does every dispute require manual ops action indefinitely? |
| Withdrawal path | **Verify** | `wallets` schema supports balance and DVA (dedicated virtual account) fields — confirm the withdrawal flow is actually wired end-to-end before this becomes SureWaka's version of GIGGO's wallet complaint |

**Read:** this is SureWaka's single highest-risk gap. GIGGO's worst review ("obvious fraud... no way to withdraw") is a data-model failure SureWaka has already avoided by having DVA fields and a proper escrow/payout split — but only if the withdrawal flow is confirmed live. This should be verified this week, not assumed.

### Gap 3 — Tracking freezes or lies (GIGGO, Sendbox, Gokada)

| Layer | Status | Detail |
|---|---|---|
| Detection | **Built** | `customer-update-gap.ts` alert rule exists specifically for this |
| Data source | **Built** | `delivery_events` + `driver_locations` give real-time truth, unlike GIGGO's checkpoint-only tracking |
| Customer delivery | **Missing** | Same push-notification gap as Gap 1 — the truth exists in the DB but isn't reaching the customer's phone |
| Zone context | **In progress** | `dynamic-zones` spec (untracked, in progress per current git status) will attach real zone data to every leg, which the analytics/alert context needs |

### Gap 4 — Pricing changes after the fact (Topship's carton-billing, GIGGO's re-quote-on-cancel)

| Layer | Status | Detail |
|---|---|---|
| Fee calculation | **No spec found** | `TODO.md` at repo root literally lists "how is delivery fee calculated" as an open, unspec'd question |
| Carrier SLA/pricing | **Partial** | `carrier_sla_overrides` schema exists for SLA-by-route, but this governs service level, not a customer-facing fee transparency commitment |
| Booking UX | **Not built** | TODO.md also lists "booking order summary," "total and tax" breakdown, and delivery-option tiers (saver/standard/priority) as unbuilt |

**Read:** this is SureWaka's second product gap with no existing spec. It's also the easiest reputational win — Topship and GIGGO are both getting "fraud" accusations over pricing opacity that a clear pre-commit quote screen entirely avoids.

### Gap 5 — No rider/driver accountability loop (Gokada cherry-picking, Kwik harassment calls, package drops at wrong address)

| Layer | Status | Detail |
|---|---|---|
| Vetting at onboarding | **Built** | `carrier-vetting.ts` — `carrier_applications` with review workflow, `carrier_member_role`/`carrier_member_action` |
| Post-delivery signal | **Built** | `delivery_ratings` table (customer → driver rating + comment, one per delivery) |
| Ongoing scorecard | **Missing** | No evidence of a recurring process that turns `delivery_ratings` + `ontime-rate-drop.ts` + `driver-ghost.ts` history into a rider standing/suspension decision |
| De-listing/suspension trigger | **Missing** | No spec ties repeated `driver_ghost` alerts or low ratings to an automatic review-for-suspension flow |

---

## Part 2 — Implementation strategy

### Phase 0 (done) — Detection foundation
Spec 0 (multi-leg delivery model) → Spec 1 (Ops Hub) → Spec 2 (Analytics Suite) → Spec 3 (Alert System, 7 rules). This is built. It's why Part 1 above shows so much green — don't rebuild it, verify it's fully wired end to end.

### Phase 1 (in progress) — Zone & location accuracy
`dynamic-zones` spec — replaces hardcoded `LAGOS_ZONES` with DB-driven multi-city zones. This is a dependency for accurate alert context (`dropoff_zone` in alert payloads) and for the analytics heatmaps that would show *where* SureWaka is failing, geographically — useful ops intelligence competitors don't appear to have at all.

### Phase 2 (this quarter) — Close the surfacing gap
**Push Notifications spec** (already listed unchecked in `CLAUDE.md` Current State — promote this to top priority). Without it, Gaps 1 and 3 stay half-solved: the system knows a rider has gone silent or a leg is overdue, but the customer doesn't. Scope: customer-facing push wired to `delivery_events` and the alert engine's existing `driver_silent` / `leg_overdue` / `customer_update_gap` firings — proactively tell the customer *before* they have to ask, which is the single biggest sentiment differentiator visible in the audit (every competitor complaint about "no tracking" is really a complaint about being left to wonder).

### Phase 3 (this quarter) — Two new specs the audit surfaced with no existing coverage

**A. Pricing Transparency & Fee Engine** — new spec needed. Scope pitch: a deterministic, pre-commit fee calculation shown to the customer before booking confirmation (base rate + weight/distance + zone surcharge + tax, itemized), with a hard rule that a quoted price cannot change after acceptance except for customer-initiated changes (extra stops, address change) — each of which re-triggers an explicit re-quote screen, never a silent charge. This directly inoculates SureWaka against the exact complaint pattern driving Topship's and GIGGO's worst reviews. Touches `packages/shared/validators.ts` (fee schema), a new pricing service, and the booking UI flow already flagged incomplete in `TODO.md`.

**B. Dispute Resolution & Refund SLA** — new spec needed. Scope pitch: a time-bound state machine on top of the existing `dispute-filed.ts` alert and `escrow_holds.refunded_at` field — e.g. clear-cut cases (driver-confirmed ghost, failed delivery with no dispute) auto-refund from escrow within a fixed window without waiting on a human; ambiguous cases get a visible "under review, resolution by X" countdown shown to the customer instead of silence. This is what turns GIGGO's and Sendbox's worst pattern (weeks of silence, no resolution) into SureWaka's differentiator.

### Phase 4 (ongoing) — Rider/carrier accountability program
**Extend `delivery-ratings` + alert history into a recurring scorecard**, not a new schema — mostly a process + a small aggregation job. See Part 3 below for the cadence.

---

## Part 3 — The operational process (this is the part that doesn't get built in code)

Detection and even automation don't solve anything if nobody owns responding to them. This is the process layer that has to exist alongside Phase 2–4.

### 3.1 Alert response runbook (one row per existing alert rule)

| Rule | Fires when | First responder action | Escalation if unresolved |
|---|---|---|---|
| `driver_silent` (warning ≥15min, critical ≥30min) | GPS goes quiet on an active leg | Call rider directly; call customer with a status update | Critical + 15min silent → treat as `driver_ghost`, dispatch replacement |
| `driver_ghost` | Driver-triggered cancel or confirmed disappearance | Immediately notify customer with alternative arrangement, not a generic apology | Flag rider for the accountability scorecard (Part 4) same day, not at next review cycle |
| `leg_overdue` (warning ≥30min, critical ≥60min) | Leg passes its ETA | Proactive customer push (once Phase 2 ships) *before* the customer contacts support | Critical → ops calls customer directly, doesn't wait for inbound complaint |
| `customer_update_gap` | No status update reaches the customer in the configured window | Manually push a status update now; audit why the automated path missed it | Repeated gaps on one delivery → escalate to on-call lead |
| `delivery_failed` | Delivery marked failed | Trigger the Dispute Resolution SLA clock (Phase 3B) immediately, don't wait for the customer to file | — |
| `dispute_filed` | Customer or driver files a dispute | Classify as clear-cut vs. ambiguous within 1 hour; clear-cut → auto-refund path; ambiguous → assign an owner and show the customer a resolution-by date | No owner assigned within 1 hour → auto-escalate to on-call lead |
| `ontime_rate_drop` | Rolling on-time % drops below threshold | This is a trend alert, not a single-incident one — route to the weekly ops review, not an individual responder | Sustained drop → carrier/zone-level root-cause review |

**The rule that matters more than any individual row:** every Critical alert gets a named owner within a fixed window (recommend 5 minutes during business hours), or it auto-escalates. An alert with no owner is functionally the same as GIGGO's "ticket bounces between two offices" complaint — the tooling existing doesn't help if the process lets it go unowned.

### 3.2 On-call rotation
Once Push Notifications and the two new specs ship, Critical alerts become customer-visible commitments, not just internal signals. That requires an actual on-call owner (even if it's just Yobo + one ops hire on rotation at launch), reachable during whatever hours SureWaka commits to for Lagos delivery windows.

### 3.3 Weekly ops review (uses the Analytics Suite already built in Spec 2)
A standing 30-minute weekly review — not ad hoc — covering:
- On-time rate trend (Analytics Tab 2/KPIs) — is it moving toward or away from target
- `ontime_rate_drop` and repeated `driver_ghost` firings — carrier or zone patterns forming
- Dispute resolution SLA adherence (Phase 3B, once built) — % resolved within window
- Rider/carrier scorecard review (below) — anyone crossing a suspension threshold

### 3.4 Rider/carrier accountability scorecard
A lightweight recurring job (not a new product feature) that aggregates, per driver/carrier:
- `delivery_ratings` average and trend
- Count of `driver_ghost` / `driver_silent` critical firings in the trailing 30 days
- On-time rate contribution from `leg_overdue` history

Cross a defined threshold (e.g. 2+ ghost events in 30 days, or rating average below a floor) → automatic flag for the carrier-vetting review workflow that already exists in `carrier-vetting.ts`, rather than a manual, easy-to-forget check. This is what closes Gap 5 without new schema — it's wiring existing tables into a recurring decision, which is a process change, not a build.

### 3.5 Postmortem discipline
Any Critical alert that reaches a customer as a real failure (not just a near-miss the system caught) gets a one-page postmortem: what happened, why detection/response didn't prevent customer impact, one concrete process or code fix. Feed the fix back into the runbook in 3.1 so the table above stays current instead of decaying into fiction.

---

## Part 4 — Success metrics

Track these on the Analytics Suite (Spec 2) already built, with explicit targets — vague monitoring without a target is how GIGGO ends up with a 4.4★ average that still contains "obvious fraud" reviews.

| Metric | Source | Target |
|---|---|---|
| % of Critical alerts with an owner assigned within 5 min | `alerts` table, `ack_by` | ≥95% |
| Dispute resolution time (median) | `escrow_holds` + new dispute SLA state | <24h for clear-cut, <72h ambiguous |
| On-time rate | `delivery_events` / analytics KPI tab | Track weekly trend; set a floor once 4–6 weeks of baseline data exists |
| Driver ghost rate | `driver-ghost.ts` firings / total active legs | Trending down month over month |
| Customer-initiated support contacts about "where is my package" | New — needs a support-ticket tag, doesn't exist yet | Should fall once Push Notifications (Phase 2) ships — this is the single clearest signal that the surfacing gap is closed |

---

## Immediate next actions (this week, no new spec required)

1. **Verify the wallet withdrawal path end-to-end** — confirm SureWaka isn't one dev-cycle away from a GIGGO-style "can't withdraw" complaint. This is a verification task, not new code, and it's the highest-severity risk identified in this document.
2. **Promote Push Notifications from "unchecked" to active work** — it's the single dependency blocking both Gap 1 and Gap 3 from being real differentiators instead of just internal detection.
3. **Draft `requirements.md` for the Pricing Transparency & Fee Engine spec** — per the CLAUDE.md feature workflow, this needs alignment before implementation since it touches booking UX, `packages/shared` validators, and a new pricing service. Recommend doing this next.
4. **Draft `requirements.md` for the Dispute Resolution & Refund SLA spec** — same reasoning; it extends `dispute-filed.ts` and `escrow_holds` but needs explicit alignment on what counts as "clear-cut" vs. "ambiguous" before it's implementable.
5. **Stand up the weekly ops review as a recurring calendar item**, even before every metric in Part 4 has a dashboard — the cadence matters more than having every number ready on day one.

Say the word if you want me to draft `requirements.md` for either of the two new specs (Pricing Transparency, Dispute Resolution SLA) next — those are the two gaps with no existing spec coverage at all.
