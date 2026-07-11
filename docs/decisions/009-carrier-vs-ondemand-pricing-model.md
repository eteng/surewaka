# ADR-009: Separate Pricing Paths for Carrier vs. On-Demand Legs

## Status

Accepted

**Amendment (2026-07-10, same alignment session):** originally framed as a per-*booking* split ("on-demand booking" vs. "carrier-aggregation booking"). Further alignment surfaced that SureWaka bookings are multi-leg (`delivery_legs`: `first_mile` / `intercity` / `last_mile`, per Spec 0 of the ops-intelligence platform), and a single delivery can combine both an on-demand leg and a carrier leg (e.g., on-demand first-mile → carrier intercity → on-demand last-mile). The economic decision below is unchanged; the unit it applies to is corrected from "booking" to "leg" throughout.

## Context

The Pricing Transparency & Fee Engine spec (`.kiro/specs/pricing-transparency/`) initially assumed one unified fee formula (base + weight surcharge + distance surcharge + tax) applied to every delivery, with a carrier's `basePrice` treated as just another input. Working through the design surfaced two corrections, in sequence:

1. SureWaka's two actor types — carrier (GIG, DHL, etc.) and on-demand dispatch (SureWaka's own drivers) — are not the same pricing problem. For an **on-demand leg**, SureWaka is the sole price-setter — there's no external rate to anchor to, so the platform computes the full price itself. For a **carrier leg**, the carrier is the price-setter — SureWaka doesn't own or compute the base rate (today a static `carriers.basePrice`; eventually a real carrier rate-card/API), its only role is adding a markup on top.
2. This split applies **per leg, not per delivery** — a `delivery_leg`'s `actor_type` (`driver` or `carrier`) determines which pricing path applies to *that leg*, and `actor_type = 'carrier'` only ever occurs on an `intercity` leg (carriers do not perform first- or last-mile legs). A single delivery's customer-facing total is the sum of its legs' quotes — 1 to 3 legs, computed once at booking, paid as a single upfront charge.

`ADR-006` (Wallet-First Payment Model) predates this distinction and describes one commission mechanism — `driver_amount`/`commission_amount` on a single escrow hold, with "driver/carrier" used interchangeably as the payee. At the time it was written, carrier settlement wasn't a designed flow (it still isn't implemented in the schema — no `carrierWalletId` exists anywhere), so the wording was a placeholder, not a deliberate design choice to unify the two payout mechanics.

## Decision

Carrier legs and on-demand legs use **two separate pricing paths**, not one formula with a branch:

| | On_Demand_Leg (`actor_type = 'driver'`, `first_mile`/`last_mile`) | Carrier_Leg (`actor_type = 'carrier'`, always `intercity`) |
|---|---|---|
| Price source | SureWaka's Fee Engine (`base_rate + per_kg×weight + per_km×distance + tax`) | The carrier's own rate (`carriers.basePrice` today) |
| Platform's cut | **Subtractive** — `COMMISSION_RATE` taken out of a SureWaka-set total; driver receives `total − commission` | **Additive** — a separate, independently configurable `carrier_commission_rate` added on top of the carrier's rate; customer pays `carrierRate + serviceFee` |
| Calculation function | `computeOnDemandQuote(weight, distance, feeSettings)` | `computeCarrierQuote(carrierBasePrice, carrierCommissionRate)` — two distinct functions, not one branching function |
| Customer-facing breakdown | Itemized per leg: base / weight / distance / tax | Itemized per leg: carrier rate / SureWaka service fee |

A delivery's total quote is `sum(quote per leg)`, each leg priced independently by whichever function matches its `actor_type`, then combined into one itemized breakdown and one upfront charge.

This narrows ADR-006's commission language: ADR-006's subtractive `driver_amount`/`commission_amount` mechanism is confirmed as the **on-demand leg** flow only. It does not describe carrier payouts — carrier settlement remains unimplemented and is explicitly out of scope for the pricing-transparency spec. ADR-006's on-demand driver flow is otherwise unchanged by this decision.

## Consequences

**Positive:**
- Each pricing path stays simple and independently testable — no shared function trying to serve two different economic models.
- Naturally handles any combination of legs (self-drop intercity-only, full 3-leg home-to-home, etc.) without special-casing which legs exist.
- `carrier_commission_rate` can diverge per-carrier-partnership-terms later without touching on-demand commission logic at all.
- Matches reality: SureWaka has never priced a carrier's own service, and pretending otherwise would produce numbers with no real backing.

**Negative / follow-up work:**
- Carrier settlement (paying a carrier its rate, minus or plus SureWaka's fee, into an actual account) has no schema support today (`escrow_holds` only has `driverWalletId`, and it's anchored to `delivery_id` not `delivery_leg_id`). This ADR does not solve that — it only fixes what the *customer* is quoted and charged. Carrier settlement is a separate future spec.
- `fee_settings` (new table, per the pricing-transparency spec) needs two rate fields instead of one: the existing on-demand `COMMISSION_RATE` stays a shared constant for now, while `carrier_commission_rate_pct` is new and configurable per the spec.

## Alternatives Considered

1. **One Fee Engine function with an actor-type branch** — Rejected: the two calculations share no real logic (different inputs, different math direction, different line-item shapes), so branching would just be two unrelated calculations awkwardly cohabiting one signature.
2. **Reuse `COMMISSION_RATE` for carrier markup too** — Rejected: subtractive platform-set-price commission and additive partner-rate markup are different economic levers; carrier partnerships will likely negotiate different terms per carrier over time, and a shared constant can't represent that.
3. **Split at the booking level instead of the leg level** — Rejected (this is the amendment above): a delivery can combine both actor types across its legs, so a booking-level flag can't represent a delivery that is, e.g., on-demand first-mile + carrier intercity + on-demand last-mile.

## When to Revisit

- When real carrier rate-card integration replaces the static `carriers.basePrice` — the carrier leg's inputs change, but the additive-markup model established here should still hold.
- When carrier settlement/payout is actually designed — that spec should reference this ADR for the pricing side of the equation it needs to pay out against, and will need `escrow_holds` (or a replacement) anchored per-leg, not per-delivery.
