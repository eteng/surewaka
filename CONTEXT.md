# SureWaka Domain Glossary

Terms resolved through explicit design decisions. Do not include implementation details — see specs and ADRs for those.

## Terms

### Customer_Profile
The `public.users` row for a user whose role is `'customer'`. The single source of truth for profile display in the mobile app — always fetched from the DB, not derived from Clerk session metadata.

### Email_Verification_Flow
The process by which a customer's new email is confirmed. Initiated via the Clerk user update API from the mobile client, which sends a verification link. On confirmation, a webhook from Clerk syncs the confirmed email to `public.users.email`. See ADR-008 (now superseded — originally described a Supabase trigger approach).

### Gender
An optional attribute on Customer_Profile. One of three values: `'woman'`, `'man'`, `'prefer_not_to_disclose'`. Stored in `public.users.gender`. Display labels: "Woman", "Man", "Prefer not to disclose".

### Internal_User
A user added/invited by an administrator — ops team, support agents, admins. Distinct from a Customer. Internal users go through a name-change approval workflow; customers do not.

### Name_Change_Approval_Workflow
The process by which an Internal_User requests a name correction that requires admin sign-off before taking effect. **Does not apply to customers** — customers update their name directly. See [[admin-user-profile spec]].

### Delivery_Leg
One segment of a delivery, per the multi-leg model (`delivery_legs` table, Spec 0 of the ops-intelligence platform): `first_mile`, `intercity`, or `last_mile`. An intra-city delivery is a single `first_mile` or `last_mile` leg; an interstate delivery may chain first-mile, one or more `intercity` legs, and last-mile, or only `intercity` (self-drop/self-collect at a hub, no home pickup/dropoff). More than one `intercity` leg is possible when a route requires multiple hops (e.g. no direct carrier route between two cities) — see [[intercity-routing spec]] (not yet written; `delivery_legs.leg_number` currently assumes at most one intercity leg and needs revisiting first). Pricing, actor assignment, and driver-reported corrections all happen at the leg level, not the delivery level.

### On_Demand_Leg
A `Delivery_Leg` with `actor_type = 'driver'` — always `first_mile` or `last_mile`, never `intercity`. Priced by `computeOnDemandQuote` (weight + distance + admin-configured rates). SureWaka is the sole price-setter for this leg.

### Carrier_Leg
A `Delivery_Leg` with `actor_type = 'carrier'` — always `intercity`; carriers do not perform first- or last-mile legs. Priced by `computeCarrierQuote`, additively on top of the carrier's own rate (today: static `carriers.basePrice`). The carrier is the price-setter, not SureWaka.

### Fee_Engine
Two independent per-leg calculation functions — `computeOnDemandQuote` for an On_Demand_Leg, `computeCarrierQuote` for a Carrier_Leg. A delivery's customer-facing total is the sum of its legs' quotes, computed once at booking and paid as a single upfront charge (no per-leg payment). See [[pricing-transparency spec]], [[ADR-009]].

### Weight_Discrepancy_Correction
The process triggered when a driver on an On_Demand_Leg reports, at physical pickup, that the actual package weight differs from what the customer declared. Recomputes every On_Demand_Leg of that delivery (not just the leg where discovered, since weight is a package-level property) and produces one combined delta charge or refund on top of the original, untouched, already-paid total — never a silent replacement of the confirmed price. Requires explicit customer approval within a fixed window; a timeout is treated as declined, not approved, and fails the whole delivery at that point. See [[pricing-transparency spec]].

### Zone
A named geographic delivery area within a city (e.g., "Lekki" in Lagos). Used for delivery classification, carrier SLA routing, alert context, and analytics heatmaps. Zones are defined by keyword sets and optional bounding boxes. A delivery leg may be "unclassified" (null zone) if the classifier cannot determine a match. The `city` field on a zone represents the metropolitan/operational area, not necessarily an administrative city boundary.
