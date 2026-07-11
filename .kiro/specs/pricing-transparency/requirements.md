# Requirements Document

## Introduction

SureWaka's booking flow currently has no server-side fee calculation. The mobile customer app's review screen hardcodes a placeholder amount (`const deliveryAmount = 350000; // kobo placeholder`, `apps/mobile-customer/app/booking/review.tsx:120`, tagged `// TODO: replace with real price from carrier selection`), and the API accepts that client-supplied amount directly on `POST /api/v1/booking/confirm` with an explicit unresolved TODO acknowledging the risk: `// TODO(security): amount should be fetched from server-side carrier quote, not trusted from the client. Blocked on carrier pricing sprint.` (`apps/api/src/routes/booking-payment.ts:28-29`). This is that "carrier pricing sprint."

This gap is both a security defect (a client can submit any `amount` for escrow debit) and a product defect: a 2026-07-08 competitor audit of seven Nigerian logistics apps found that pricing opacity — carriers billing by dimensions instead of actual weight, fees changing after a cancel/re-book, no itemized breakdown before commit — is one of the most consistently cited "feels like fraud" complaints across the market. SureWaka's own `TODO.md` independently lists "how is delivery fee calculated," "total and tax," and "booking order summary" as open, unspec'd questions.

**Two corrections were made during alignment, recorded in [ADR-009](../../docs/decisions/009-carrier-vs-ondemand-pricing-model.md):**

1. SureWaka's two pricing paths — on-demand and carrier — split at the **leg** level, not the booking level. A delivery is composed of one or more `delivery_legs` (`first_mile`, `intercity`, `last_mile`, per the existing multi-leg model from Spec 0 of the ops-intelligence platform). A leg's `actor_type` (`driver` or `carrier`) determines which pricing formula applies; `actor_type = 'carrier'` only ever occurs on an `intercity` leg. A single delivery can combine multiple leg types and multiple intercity legs — e.g. on-demand first-mile pickup → carrier intercity transport (possibly chained across more than one intercity hop when no direct carrier route exists — see Out of Scope) → on-demand last-mile dropoff — and its customer-facing total is the sum of all its legs' quotes, computed once and paid as a single upfront charge. This spec makes no assumption about how many legs a delivery has, or how the leg sequence was decided (customer's explicit choice vs. a future routing engine) — it only prices whatever leg list it's given.
2. A further scenario surfaced the need for a **Weight_Discrepancy_Correction** mechanism: if a driver on an on-demand leg discovers at physical pickup that the actual package weight differs from what the customer declared, the system needs a defined way to correct the price — without silently changing what was already confirmed and paid.

**Scope:** Fee calculation, quoting, and price-lock for both leg types' initial confirmation charge, multi-leg composite assembly, vehicle-type-based price differentiation for on-demand legs, and pickup-time weight-discrepancy correction. Explicitly out of scope (see "Out of Scope" below): delivery-option tiers, promo/gift codes, SureWakaCoins, carrier settlement/payout, surge/time-of-day pricing, and dynamic demand-based pricing.

## Glossary

- **Delivery_Leg**: One segment of a delivery (`delivery_legs` table): `first_mile`, `intercity`, or `last_mile`. A delivery has one or more legs — more than one `intercity` leg is possible for a multi-hop route (see Out of Scope: Intercity Routing).
- **On_Demand_Leg**: A `Delivery_Leg` with `actor_type = 'driver'` — always `first_mile` or `last_mile`. SureWaka is the sole price-setter.
- **Carrier_Leg**: A `Delivery_Leg` with `actor_type = 'carrier'` — always `intercity`. The carrier is the price-setter; SureWaka adds a markup.
- **Fee_Engine**: Two separate, independently-testable calculation functions — `computeOnDemandQuote` (for an On_Demand_Leg) and `computeCarrierQuote` (for a Carrier_Leg) — not one function with a branch. Neither performs DB writes; both are pure functions of their inputs and the current `fee_settings` row.
- **Leg_Quote**: A computed, itemized fee breakdown for a single `Delivery_Leg`, expressed as a `line_items` array (`{ label, amountKobo }`) plus a `totalKobo`.
- **Composite_Quote**: The customer-facing total for an entire delivery — the sum of every one of its legs' Leg_Quotes, assembled into a single itemized breakdown grouped by leg.
- **Speculative_Quote**: A Leg_Quote (or set of them) computed on-demand for display during booking/carrier comparison, before a delivery record exists. Stateless — never persisted, never expires, never gates a confirmation.
- **Authoritative_Quote**: The persisted Leg_Quote(s) once a real `delivery_id` (and its `delivery_legs` rows) exist, created at `POST /api/v1/deliveries`. This is the only quote type with an expiry, and the only one `booking/confirm` ever validates against. One row per leg; the delivery's Composite_Quote is their sum.
- **Price_Lock**: The rule that once a delivery's Composite_Quote is confirmed into an escrow hold, the total cannot change except through an explicit Re-Quote (customer-initiated, pre-pickup) or a Weight_Discrepancy_Correction (driver-reported, at pickup) — never silently.
- **Re-Quote**: A new Authoritative_Quote generated because the customer changed a chargeable input before any leg begins; supersedes the prior quote(s) and requires explicit customer acknowledgment before it takes effect.
- **Weight_Discrepancy_Correction**: Triggered when a driver on an On_Demand_Leg reports, at physical pickup, that actual package weight differs from the customer's declaration. Recomputes **every** On_Demand_Leg of that delivery (not just the leg where discovered — weight is a package-level property shared across legs; Carrier_Legs are unaffected since their pricing isn't weight-based). Produces one combined delta (charge or refund) on top of the original, untouched, already-paid Composite_Quote — never a silent replacement. Requires explicit customer approval within an Approval_Window; see Requirement 12.
- **Approval_Window**: The fixed time (default 10 minutes, admin-configurable via `fee_settings`) a customer has to approve a Weight_Discrepancy_Correction delta before it's treated as declined.
- **Vehicle_Type_Multiplier**: A per-vehicle-type scalar (e.g., motorcycle = 1.0×, car = 1.3×, van = 1.6×, truck = 2.0×) applied to the On_Demand_Leg subtotal (base + weight + distance, before tax) to account for the operational cost difference between vehicle classes. Values are admin-configurable in a `vehicle_type_rates` table, keyed by the existing `vehicle_type` pgEnum (`motorcycle`, `car`, `van`, `truck`). The customer selects a vehicle type during booking; this selection determines both which driver pool is matched AND the price multiplier applied.
- **Base_Rate**: The flat platform/pickup fee for an On_Demand_Leg, unrelated to weight — no free-weight allowance is bundled into it (per_kg_rate applies from kg 0).
- **On_Demand_Commission_Rate**: The existing `COMMISSION_RATE` constant (0.15) — subtractive, taken out of an On_Demand_Leg's SureWaka-computed total before the driver is paid. Unchanged by this spec (see ADR-006, narrowed by ADR-009).
- **Carrier_Commission_Rate**: A new, separately configurable rate — additive, applied on top of a carrier's own rate to produce the customer-facing total for a Carrier_Leg. Distinct from On_Demand_Commission_Rate.

## Requirements

### Requirement 1: On-Demand Leg Fee Calculation

**User Story:** As a platform operator, I want each on-demand leg of a delivery priced by a single deterministic formula, so that no two on-demand legs with the same weight and distance are priced differently and no client input can influence the amount charged.

#### Acceptance Criteria

1. `computeOnDemandQuote` SHALL compute a Leg_Quote from only server-known inputs: package weight (`packageWeight`, shared across all legs of the delivery), that leg's pickup/dropoff coordinates (haversine distance, consistent with the existing system-ETA calculation), the selected vehicle type (`vehicleType`, one of `motorcycle`, `car`, `van`, `truck` — matching the existing `vehicle_type` pgEnum), and the current `fee_settings` row (`base_rate_kobo`, `per_kg_rate_kobo`, `per_km_rate_kobo`, `tax_rate_pct`) plus the matching `vehicle_type_rates` multiplier for the selected vehicle type.
2. THE per-kg surcharge SHALL apply to the full package weight from kg 0 — `Base_Rate` is a flat fee with no bundled free-weight allowance.
3. THE Vehicle_Type_Multiplier SHALL be applied to the on-demand subtotal (base_rate + weight_surcharge + distance_surcharge) before tax — i.e., `subtotal = (base_rate_kobo + per_kg_rate_kobo × weight + per_km_rate_kobo × distance) × vehicle_type_multiplier`, then tax is applied to the result.
4. `vehicleType` SHALL be a required input to `computeOnDemandQuote` — the function SHALL reject calls where vehicle type is absent or not one of the four defined enum values (`motorcycle`, `car`, `van`, `truck`).
5. `computeOnDemandQuote` SHALL NOT accept a client-supplied price, amount, or discount value as an input at any point in the booking flow.
6. All computed monetary values SHALL be expressed in kobo (integer), matching `wallets`, `escrow_holds`, and `payout_requests`. Since the product has not yet launched and all existing `deliveries.price` rows are test data, the column is a direct type change (drop/recreate as integer kobo) — no backfill migration is required.
7. WHEN a delivery's Composite_Quote total is below `MIN_DELIVERY_PRICE_NGN` (converted to kobo), THE Fee_Engine SHALL floor the total at that minimum.
8. `On_Demand_Commission_Rate` (existing `COMMISSION_RATE`) governs the platform's cut of an On_Demand_Leg's total for internal accounting only, subtractively, exactly as described in ADR-006 — it does not alter the customer-facing total.

### Requirement 2: Carrier Leg Fee Calculation

**User Story:** As a customer, I want the intercity leg of my delivery priced from the carrier's own rate plus SureWaka's fee, so that carrier prices aren't artificially recomputed by a formula that has nothing to do with what the carrier actually charges.

#### Acceptance Criteria

1. `computeCarrierQuote` SHALL compute a Leg_Quote as `carrier.basePrice + (carrier.basePrice × Carrier_Commission_Rate)` — additive, not a recomputation of the carrier's rate.
2. `Carrier_Commission_Rate` SHALL be stored and configured independently of `On_Demand_Commission_Rate` (per ADR-009) — a shared constant is explicitly rejected.
3. `computeCarrierQuote` SHALL NOT apply `per_kg_rate_kobo` or `per_km_rate_kobo` — a carrier's flat `basePrice` is the MVP model; real per-shipment carrier rate cards are future work (see Out of Scope).
4. Tax (`tax_rate_pct`) applied to a Carrier_Leg's quote SHALL apply only to SureWaka's own service-fee line, never to the carrier's rate.
5. `computeCarrierQuote` SHALL only ever be invoked for a Delivery_Leg where `leg_type = 'intercity'` — carriers do not perform `first_mile` or `last_mile` legs.

### Requirement 3: Multi-Leg Composite Quote Assembly

**User Story:** As a customer booking an interstate delivery, I want to see one clear total made up of however many legs my delivery actually needs, so that a self-drop-off booking isn't priced the same as a full home-to-home booking.

#### Acceptance Criteria

1. WHEN a delivery is created with a given leg composition — any combination of `first_mile`, `intercity`, and `last_mile` legs, including more than one `intercity` leg for a multi-hop route — THE API SHALL compute one Leg_Quote per `Delivery_Leg` using the Fee_Engine function matching that leg's `actor_type`, and assemble them into a single Composite_Quote. THE API SHALL NOT impose a maximum leg count.
2. THE Composite_Quote's `line_items` SHALL be grouped by leg with a clear label per leg (e.g., "First-mile pickup," "Intercity — GIG Logistics," "Last-mile delivery") so the customer can see what each leg costs, not just an undifferentiated total.
3. A delivery that omits `first_mile` (self-drop at a hub) or `last_mile` (self-collect at destination) SHALL simply have no `Delivery_Leg` row for that segment — there is no "waived leg" placeholder or zero-amount line item for a leg that was never booked.
4. THE Composite_Quote total SHALL be paid as a single upfront charge at `booking/confirm`, before any leg begins — consistent with the existing wallet-first escrow model (ADR-006), which is not modified by this spec to support per-leg payment.

### Requirement 4: Speculative Quotes During Comparison

**User Story:** As a customer comparing carriers or delivery options before committing to a booking, I want to see a real, itemized estimated total per leg, so I can compare on actual price rather than a static "from ₦X" teaser.

#### Acceptance Criteria

1. WHEN a customer is on the carrier comparison screen (`apps/mobile-customer/app/booking/carriers.tsx`) or any other pre-booking comparison step, THE API SHALL expose an endpoint (`POST /api/v1/booking/quote`) that returns a Speculative_Quote — a Leg_Quote or set of them — using the appropriate Fee_Engine function(s) per leg being compared.
2. THE quote endpoint SHALL require authentication and SHALL NOT require a `delivery_id` or existing delivery/leg rows.
3. A Speculative_Quote SHALL NOT be persisted to any table — it is a stateless calculation, has no expiry, and never gates a later confirmation. (Persistence and price-lock begin only with the Authoritative_Quote, per Requirement 5.)
4. IF pickup, dropoff, package weight, vehicle type, or carrier selection is missing or invalid for a requested leg, THEN THE quote endpoint SHALL return HTTP 400 indicating which field is missing.
5. For on-demand legs in the quote request, `vehicleType` SHALL be required — the quote endpoint SHALL NOT return a speculative on-demand quote without a vehicle type selection, since it determines both the price multiplier and the matched driver pool.
6. THE quote response SHALL include a human-readable line-item label per component so the mobile app never hardcodes fee-component names client-side.

### Requirement 5: Authoritative Quote Persistence and Expiry

**User Story:** As a platform operator, I want each leg's quote to be locked once real money is on the line, so stale prices can't be replayed and a customer's confirmed total matches what they saw.

#### Acceptance Criteria

1. WHEN a delivery is created via `POST /api/v1/deliveries` (which now accepts the delivery's leg composition, including optional `carrierId` for any `intercity` leg), THE API SHALL compute and persist one Authoritative_Quote (`quotes` row) per `delivery_leg_id`, using whichever Fee_Engine function matches that leg's `actor_type`.
2. Each `quotes` row SHALL store `line_items` as a `jsonb` array (`{ label, amountKobo }[]`) plus `total_kobo`, rather than fixed named columns per fee component — differently-shaped leg breakdowns share one row shape, and future carrier rate-card changes don't require a schema migration.
3. Each Authoritative_Quote SHALL include an expiry timestamp (15 minutes from creation).
4. IF a customer attempts `POST /api/v1/booking/confirm` after any linked Authoritative_Quote has expired, THEN THE API SHALL return HTTP 409 instructing the client to request fresh quotes, rather than silently re-pricing.
5. THE API SHALL NOT allow more than one active (non-superseded, non-confirmed) Authoritative_Quote per `delivery_leg_id` — requesting a new one supersedes the prior row rather than mutating it, preserving quote history for dispute-replay (matching the `driver_locations` history pattern).

### Requirement 6: Server-Side Confirmation Validation (fixes the existing security TODO)

**User Story:** As a platform operator, I want `POST /api/v1/booking/confirm` to charge exactly the sum of the server's own Authoritative_Quotes across all of a delivery's legs, so that a client can never manipulate the escrow amount.

#### Acceptance Criteria

1. WHEN `POST /api/v1/booking/confirm` is called, THE API SHALL look up the active Authoritative_Quote for every `Delivery_Leg` belonging to the given `delivery_id`, sum their `total_kobo` values into the Composite_Quote total, and use that sum as the escrow `totalAmount` — ignoring any `amount` field the client may still send during a transition period.
2. THE `bookingConfirmSchema` validator in `packages/shared/src/validators.ts` SHALL be updated to no longer require (and eventually to reject) a client-supplied `amount` field.
3. IF any of the delivery's legs lacks an active Authoritative_Quote at confirmation time, THEN THE API SHALL return HTTP 422 indicating a quote must be requested first for that leg.
4. THIS requirement directly resolves the TODO at `apps/api/src/routes/booking-payment.ts:28-29`; that comment SHALL be removed as part of implementing this requirement.

### Requirement 7: Price Immutability After Confirmation

**User Story:** As a customer, I want my confirmed delivery price to never change without my explicit agreement, so that I'm never surprised by a different charge than what I approved.

#### Acceptance Criteria

1. WHEN a delivery has moved past `draft` status (i.e., `paymentStatus` is `escrowed` or later), THE API SHALL NOT recompute or alter the escrow `totalAmount` automatically for any reason.
2. IF a customer changes a chargeable input (package weight, an On_Demand_Leg's dropoff address) before any leg begins, THEN THE API SHALL require an explicit Re-Quote step showing the new itemized Composite_Quote and requiring customer confirmation before the escrow amount changes.
3. THE API SHALL NOT silently increase a previously quoted or confirmed amount when a delivery is cancelled and re-created, distinguishing this from the audited GIGGO complaint pattern of re-quoting higher prices after a cancellation.
4. WHEN a delivery is cancelled, THE existing tiered `REFUND_RATES` logic (`apps/api/src/routes/booking-payment.ts:107-115`) continues to govern the refund percentage, unaffected by this spec — this spec governs the initial charge and the Weight_Discrepancy_Correction (Requirement 12) only, not general cancellation refunds (see the separate Dispute Resolution & Refund SLA spec).

### Requirement 8: Itemized Fee Display in Booking UI

**User Story:** As a customer, I want to see a clear, honest, per-leg breakdown of what I'm paying for before I confirm, so that the price feels earned rather than opaque.

#### Acceptance Criteria

1. THE booking review screen (`apps/mobile-customer/app/booking/review.tsx`) SHALL render the Composite_Quote's `line_items`, grouped by leg, instead of a single lump-sum number — for however many legs the delivery has.
2. THE carrier comparison screen (`apps/mobile-customer/app/booking/carriers.tsx`) SHALL show each carrier's real Speculative_Quote for the intercity leg (carrier rate + SureWaka service fee, itemized) rather than only the static `carrier.basePrice` "From ₦X" display.
3. Every leg's platform fee SHALL be shown as a visible, separate line item ("SureWaka service fee" for a Carrier_Leg) — consistency of transparency across leg types is a deliberate product principle, not just an on-demand-only behavior.
4. WHEN any of a delivery's Authoritative_Quotes is close to expiring (under 2 minutes remaining) while the customer is still on the review screen, THE UI SHALL prompt the customer to refresh rather than letting confirmation fail with an opaque error.
5. THE hardcoded placeholder at `apps/mobile-customer/app/booking/review.tsx:120` (`const deliveryAmount = 350000`) SHALL be removed as part of implementing this requirement.

### Requirement 9: Admin-Configurable Fee Parameters

**User Story:** As a platform operator, I want to adjust on-demand rates, carrier commission, tax percentage, and the Weight_Discrepancy_Correction approval window without a code deploy, so that pricing and policy can respond to fuel costs and operational experience.

#### Acceptance Criteria

1. `fee_settings` (a singleton table, following the `alert_settings` pattern) SHALL hold `base_rate_kobo`, `per_kg_rate_kobo`, `per_km_rate_kobo`, `carrier_commission_rate_pct`, `tax_rate_pct`, `min_price_kobo`, and `weight_correction_approval_window_min` (default 10), editable only by users with the `surewaka_admin` role.
2. A separate `vehicle_type_rates` table SHALL hold one row per vehicle type (`motorcycle`, `car`, `van`, `truck`) with a `multiplier` column (numeric, e.g. 1.0, 1.3, 1.6, 2.0), editable only by users with the `surewaka_admin` role. THE system SHALL seed default multipliers on first migration: motorcycle = 1.0, car = 1.3, van = 1.6, truck = 2.0.
3. WHEN a fee parameter or vehicle type multiplier is changed, THE change SHALL apply only to quotes generated after the change — in-flight Authoritative_Quotes already issued to customers are unaffected, consistent with Requirement 7's immutability guarantee.

### Requirement 10: Carrier Rate Maintenance

**User Story:** As a platform operator, I want to correct a carrier's rate when it drifts from reality, with a record of why and when it changed, so pricing stays accurate over time without losing an audit trail.

#### Acceptance Criteria

1. `carriers.basePrice` SHALL become editable by users with the `surewaka_admin` role (today it is write-once, set only at carrier onboarding).
2. WHEN `carriers.basePrice` is changed, THE API SHALL insert a row into `carrier_rate_history` (`carrier_id`, `old_base_price_kobo`, `new_base_price_kobo`, `changed_by`, `reason`, `created_at`) — the same append-only audit shape as the existing `role_audit_log`.
3. A `carriers.basePrice` change SHALL affect only quotes computed after the change. Already-issued Speculative_Quotes or Authoritative_Quotes are never recalculated retroactively, consistent with Requirement 7 — this holds even when the prior rate is later found to have been wrong.

### Requirement 11: Carrier Margin Reconciliation

**User Story:** As a platform operator, I want to compare what carriers actually invoice SureWaka against what SureWaka quoted customers for their intercity legs, so I know whether SureWaka is making or losing money on each carrier's pass-through rate.

#### Acceptance Criteria

1. THE API SHALL support admin entry of a Carrier_Invoice_Reconciliation record: `carrier_id`, `period_start`, `period_end`, `invoiced_amount_kobo`, `entered_by`, `notes` — one row per carrier per reconciled period, matching how carrier invoices actually arrive (a lump-sum period statement, not itemized per delivery).
2. WHEN a Carrier_Invoice_Reconciliation is entered, THE API SHALL compute Variance as `sum(the "Carrier rate" line item across all confirmed Carrier_Legs for that carrier_id within [period_start, period_end)) − invoiced_amount_kobo`, excluding SureWaka's own service-fee line items from the summed side.
3. Carrier Margin Reconciliation SHALL NOT trigger any wallet movement, payout, or payment to the carrier — it is a bookkeeping/visibility record only. Actual carrier settlement remains out of scope (see below).
4. THE existing Carrier Performance analytics tab (`apps/admin/app/components/analytics/carrier-performance-tab.tsx`) SHALL surface, per carrier per reconciled period: total quoted service-fee revenue, Variance, and net (service-fee revenue + Variance).

### Requirement 12: Weight Discrepancy Correction at Pickup

**User Story:** As a platform operator, I want a defined process for when a driver reports that a package's actual weight doesn't match what the customer declared, so pricing stays accurate without silently overcharging or undercharging, and without stranding a driver waiting indefinitely.

#### Acceptance Criteria

1. WHEN a driver on an On_Demand_Leg (at `arrived_pickup` status, before transitioning to `picked_up`) reports an actual package weight that differs from the delivery's declared `packageWeight`, THE API SHALL recompute every On_Demand_Leg of that delivery (not only the leg where reported) using the corrected weight, via `computeOnDemandQuote`. Carrier_Legs of the same delivery are unaffected, since their pricing is not weight-based (Requirement 2.3).
2. THE API SHALL compute a single combined delta as `(sum of corrected On_Demand_Leg totals) − (sum of originally-confirmed On_Demand_Leg totals)` and present it to the customer as one clear correction with an explanation (declared weight vs. reported weight), not as separate corrections at separate points in the journey.
3. THE original, already-paid escrow amount SHALL NOT be modified. The delta SHALL be applied as a separate, additional wallet transaction (a charge if positive, a refund if negative) once approved — never a retroactive replacement of the original confirmed total.
4. THE delta SHALL always require explicit customer approval before the delivery proceeds past the reporting leg's pickup — THE API SHALL NOT auto-debit the wallet for a Weight_Discrepancy_Correction under any circumstance, regardless of available balance.
5. THE customer SHALL have `weight_correction_approval_window_min` (default 10 minutes, per Requirement 9.1) to respond. IF the window elapses with no response, THEN THE correction SHALL be treated as declined (not approved).
6. WHEN a Weight_Discrepancy_Correction is declined (explicitly or via Requirement 12.5 timeout), THE entire delivery SHALL fail at that point — no leg proceeds — and THE already-escrowed original Composite_Quote amount SHALL be refunded using the existing `arrived_pickup` tier in `REFUND_RATES` (`apps/api/src/routes/booking-payment.ts:107-115`, currently 85%), rather than a new bespoke refund percentage for this failure mode.

## Out of Scope (flagged for follow-on specs, not this one)

- **Intercity routing/path optimization** — customers will be offered three delivery modes: (1) in-city on-demand only, (2) a customer-chosen fixed carrier route for a single intercity leg (e.g., "PH–Aba" or "PH–Abuja"), and (3) an end-to-end "SureWaka way" mode where the system picks the cheapest path across available carrier routes, potentially chaining more than one intercity leg when no direct route exists. The graph-search/path-optimization algorithm for mode 3 is a separate future spec. This pricing spec is compatible with it by design — Leg_Quotes are computed per leg regardless of how many legs exist or how the leg sequence was decided, and Speculative_Quotes being stateless means a routing engine can price multiple candidate paths cheaply while comparing them, without writing throwaway rows. **Prerequisite the routing spec inherits, not fixed here:** `delivery_legs.leg_number` (from Spec 0, already built) is a `smallint` commented `-- 1, 2, 3`, implying a cap that must be lifted before multi-hop intercity chains can exist.
- **Carrier settlement/payout** — no schema support exists today for actually *paying* a carrier (only `driverWalletId` exists on `escrow_holds`, no `carrierWalletId`, and `escrow_holds` is anchored to `delivery_id` not `delivery_leg_id`). Requirement 11 records what SureWaka owes a carrier for visibility; it does not move money. This spec fixes what the *customer* is quoted and charged, and gives operators margin visibility — actually settling with carriers, per leg or per delivery, is separate, pre-existing tech debt. See ADR-009.
- **Real carrier rate-card integration** — `computeCarrierQuote` uses the static `carriers.basePrice` for v1; replacing this with a live per-shipment carrier rate/API is future work that should preserve the additive-markup model established in ADR-009.
- **Category or dimension-based discrepancy correction** — Requirement 12 covers weight only, since weight is the only chargeable input with a physical, on-the-spot verification step (a scale). A mismatched package *category* (e.g., declared "parcel" but actually "fragile") is a handling/liability question, not a pricing one, and is not addressed here.
- **Delivery-option tiers** (saver/standard/priority) — `TODO.md` item; requires its own pricing-multiplier design, deferred until this base fee engine exists.
- **Promo codes / gift codes** — deferred; would apply as a discount layer on top of the Composite_Quote once the engine is stable.
- **SureWakaCoins / loyalty points** — deferred; same reasoning as promo codes.
- **Zone-based surcharges using the `dynamic-zones` spec's zone data** — that spec is scoped to zone infrastructure only. This spec's distance surcharge uses raw haversine distance; wiring in zone-tier surcharges is a natural fast-follow once `dynamic-zones` ships.
- **AI-based package weight/category capture at delivery creation** — separate `TODO.md` item; this spec assumes `packageWeight` and `packageCategory` are already reliably captured as they are today (manual customer entry), subject to correction per Requirement 12.
- **Time-of-day / surge pricing** — multipliers that vary by hour-of-day, day-of-week, or real-time demand volume are deferred to a follow-on spec. The vehicle type multiplier introduced here is static (admin-set, not demand-reactive).
- **Dynamic demand-based pricing** — algorithmic price adjustment based on real-time supply/demand ratio (e.g., fewer drivers available → higher price) is explicitly out of scope for this spec. This would require demand-sensing infrastructure that does not yet exist.
