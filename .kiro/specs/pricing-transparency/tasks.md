# Implementation Plan: Pricing Transparency & Fee Engine

## Overview

Implements server-side fee calculation, quote lifecycle, and price-lock for SureWaka's delivery booking flow. Includes vehicle-type-based price differentiation for on-demand legs via a `vehicle_type_rates` table and a multiplier applied before tax. Follows the rollout sequence: schema → Fee Engine → quote service → API routes → mobile UI → admin UI → alert-engine expiry check. Rate maintenance and margin reconciliation are parallelizable with mobile UI once schema lands.

## Tasks

- [x] 1. Database schema and shared types
  - [x] 1.1 Create `fee_settings` table schema and seed row
    - Create `packages/db/src/schema/fee-settings.ts` with singleton table definition (base_rate_kobo, per_kg_rate_kobo, per_km_rate_kobo, carrier_commission_rate_pct, tax_rate_pct, min_price_kobo, weight_correction_approval_window_min, updated_at)
    - Export from `packages/db/src/schema/index.ts`
    - Add a seed script or extend existing `seed:ops` to insert one default row
    - _Requirements: 9.1_

  - [x] 1.2 Create `vehicle_type_rates` table schema and seed rows
    - Create `packages/db/src/schema/vehicle-type-rates.ts` with columns: id (uuid PK), vehicle_type (vehicle_type enum, UNIQUE), multiplier (numeric(4,2) NOT NULL), updated_at (timestamptz)
    - Seed four rows: motorcycle=1.0, car=1.3, van=1.6, truck=2.0
    - Export from `packages/db/src/schema/index.ts`
    - _Requirements: 9.2_

  - [x] 1.3 Create `quotes` table schema
    - Create `packages/db/src/schema/quotes.ts` with columns: id, delivery_leg_id (FK), delivery_id (FK), carrier_id (FK nullable), line_items (jsonb), total_kobo, distance_km, package_weight_kg, expires_at, superseded_at, confirmed_at, created_at
    - Add partial index `idx_quotes_leg_active` on (delivery_leg_id) WHERE superseded_at IS NULL AND confirmed_at IS NULL
    - Add index `idx_quotes_delivery` on (delivery_id)
    - Export from `packages/db/src/schema/index.ts`
    - _Requirements: 5.1, 5.2, 5.5_

  - [x] 1.4 Create `weight_discrepancy_corrections` table schema
    - Create `packages/db/src/schema/weight-discrepancy-corrections.ts` with columns: id, delivery_id (FK), reported_leg_id (FK), declared_weight_kg, reported_weight_kg, delta_kobo, status (text, default 'pending_approval'), approval_deadline, responded_at, wallet_transaction_ref, created_at
    - Add partial index `idx_weight_corrections_pending` on (approval_deadline) WHERE status = 'pending_approval'
    - Export from `packages/db/src/schema/index.ts`
    - _Requirements: 12.1, 12.5_

  - [x] 1.5 Create `carrier_rate_history` table schema
    - Create `packages/db/src/schema/carrier-rate-history.ts` with columns: id, carrier_id (FK), old_base_price_kobo (nullable), new_base_price_kobo, changed_by (FK users), reason (text nullable), created_at
    - Export from `packages/db/src/schema/index.ts`
    - _Requirements: 10.2_

  - [x] 1.6 Create `carrier_invoice_reconciliations` table schema
    - Create `packages/db/src/schema/carrier-invoice-reconciliations.ts` with columns: id, carrier_id (FK), period_start (date), period_end (date), invoiced_amount_kobo, quoted_carrier_total_kobo, variance_kobo, entered_by (FK users), notes, created_at; unique constraint on (carrier_id, period_start, period_end)
    - Export from `packages/db/src/schema/index.ts`
    - _Requirements: 11.1, 11.2_

  - [x] 1.7 Modify `deliveries` table — `price` column to `price_kobo` integer
    - Drop existing `deliveries.price` (decimal/float) and recreate as `price_kobo integer` — pre-launch test data only, no backfill needed
    - Update any references in `packages/db/src/schema/deliveries.ts`
    - _Requirements: 1.6_

  - [x] 1.8 Add shared types and Zod validators for fee engine
    - Add `VehicleType` union type (`'motorcycle' | 'car' | 'van' | 'truck'`), `VehicleTypeRates = Record<VehicleType, { multiplier: number }>`, `LineItem`, `LegQuote`, `FeeSettings`, `CompositeQuote` types to `packages/shared/src/types.ts`
    - Add Zod schemas for quote request/response (including `vehicleType` per on-demand leg), weight correction request/response, fee settings update, vehicle type rates update in `packages/shared/src/validators.ts`
    - Add `INVALID_VEHICLE_TYPE` error code to shared error constants
    - Remove `amount` from `bookingConfirmSchema` (or make optional during transition)
    - _Requirements: 1.1, 1.4, 4.4, 6.2_

  - [x] 1.9 Run migration
    - Run `pnpm --filter @surewaka/db db:generate` then `pnpm --filter @surewaka/db db:migrate` to apply all new tables
    - _Requirements: 1.6, 5.1, 9.1, 9.2, 10.2, 11.1, 12.1_

- [x] 2. Fee Engine — pure calculation functions
  - [x] 2.1 Implement `computeOnDemandQuote`
    - Create `apps/api/src/lib/fee-engine.ts`
    - Implement pure function: input `{ packageWeight, distanceKm, vehicleType }` + `FeeSettings` + `VehicleTypeRates` → `LegQuote`
    - Validate `vehicleType` is one of motorcycle/car/van/truck — throw/return error for invalid values
    - Look up `vehicleTypeRates[vehicleType].multiplier`
    - Formula: `subtotal = (base_rate_kobo + (packageWeight × per_kg_rate_kobo) + (distanceKm × per_km_rate_kobo)) × vehicle_type_multiplier`; then `tax = subtotal × tax_rate_pct / 100`; `total = subtotal + tax`
    - Per-kg applies from kg 0 — no free-weight allowance
    - All outputs must be integers (Math.round each line item)
    - Line items: "Base fee", "Weight surcharge (Xkg)", "Distance surcharge (Xkm)", "Vehicle type (type × multiplier)", "Tax" (if tax_rate_pct > 0)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Implement `computeCarrierQuote`
    - In same file `apps/api/src/lib/fee-engine.ts`
    - Implement pure function: input `{ carrierBasePrice }` + `FeeSettings` → `LegQuote`
    - Formula: carrier_rate + service_fee (carrierBasePrice × carrier_commission_rate_pct / 100) + tax on service_fee only
    - No weight/distance surcharges — carrier's flat rate is the base
    - All outputs must be integers
    - Line items: "Carrier rate (CarrierName)", "SureWaka service fee", "Tax" (if applicable)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.3 Implement `assembleCompositeQuote` helper
    - Pure function that takes an array of `{ legType, legLabel, quote: LegQuote }` and returns a grouped composite with `compositeTotalKobo`
    - Apply minimum price floor (`min_price_kobo`) at the composite level
    - _Requirements: 3.1, 3.2, 1.7_

  - [ ]* 2.4 Write property tests for `computeOnDemandQuote`
    - **Property 1: On-demand quote formula correctness (with vehicle type multiplier)**
    - **Property 2: Output integrity — integer kobo and line-item sum**
    - Create `apps/api/src/lib/__tests__/fee-engine.property.test.ts`
    - Use fast-check with arbFeeSettings, arbVehicleTypeRates, arbVehicleType, arbPackageWeight, arbDistanceKm generators
    - Verify formula: `((base + weight + distance) × vehicle_type_multiplier) + tax` for all four vehicle types
    - Minimum 100 iterations
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 4.5**

  - [ ]* 2.5 Write property tests for `computeCarrierQuote`
    - **Property 4: Carrier quote formula correctness**
    - **Property 2: Output integrity — integer kobo and line-item sum** (shared)
    - Use fast-check with arbCarrierBasePrice generator
    - Verify no weight/distance line items appear, tax only on service fee
    - Minimum 100 iterations
    - **Validates: Requirements 2.1, 2.3, 2.4**

  - [ ]* 2.6 Write property test for minimum price floor
    - **Property 3: Minimum delivery price floor**
    - Generate composite quotes that sum below min_price_kobo, verify floor is applied
    - **Validates: Requirements 1.7**

  - [ ]* 2.7 Write unit tests for Fee Engine (known-value examples and edge cases)
    - Create `apps/api/src/lib/__tests__/fee-engine.test.ts`
    - Test all four vehicle types with known inputs: motorcycle (1.0× — no multiplier effect), car (1.3×), van (1.6×), truck (2.0× — doubles subtotal)
    - Test zero weight, zero distance, max weight (500kg), zero tax, high commission rates
    - Test invalid vehicle type input returns proper error
    - Verify integer rounding with rates that produce fractional kobo
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.3, 2.4_

- [x] 3. Checkpoint — Fee Engine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Quote Service — persistence and lifecycle
  - [x] 4.1 Implement `createAuthoritativeQuotesForDelivery`
    - Create `apps/api/src/services/quote-service.ts`
    - For each delivery_leg, call the appropriate Fee Engine function based on `actor_type`
    - For on-demand legs: pass `vehicleType` (from delivery/leg data) and loaded `VehicleTypeRates` to `computeOnDemandQuote`
    - For carrier legs: pass carrier's `basePrice` to `computeCarrierQuote`
    - Persist one `quotes` row per leg with `expires_at = now() + 15 minutes`
    - Return the full composite quote breakdown
    - _Requirements: 5.1, 5.3, 3.1_

  - [x] 4.2 Implement `getActiveQuoteForLeg` and `getCompositeTotal`
    - `getActiveQuoteForLeg`: query for the non-superseded, non-expired quote for a leg
    - `getCompositeTotal`: sum all active leg quotes for a delivery
    - _Requirements: 5.5, 6.1_

  - [x] 4.3 Implement `supersedeLeg` (re-quote support)
    - Mark prior active quote with `superseded_at = now()`
    - Insert new quote row — ensures at most one active quote per leg at all times
    - _Requirements: 5.5, 7.2_

  - [x] 4.4 Implement `confirmAll`
    - Stamp `confirmed_at` on all active quotes for a delivery
    - Validate none are expired before confirming
    - _Requirements: 6.1, 5.4_

  - [ ]* 4.5 Write property test for one-active-quote-per-leg invariant
    - **Property 9: At most one active quote per leg**
    - After any sequence of create/supersede operations, verify at most one active quote per delivery_leg_id
    - **Validates: Requirements 5.5**

  - [ ]* 4.6 Write property test for quote expiry timestamp correctness
    - **Property 8: Quote expiry timestamp correctness**
    - Verify `expires_at` equals creation time + 15 minutes (within 1s tolerance)
    - **Validates: Requirements 5.3**

  - [ ]* 4.7 Write unit tests for quote service
    - Test quote creation, supersession, expiry detection, composite sum calculation
    - Test that vehicle type is correctly passed through to Fee Engine for on-demand legs
    - Test edge cases: single-leg delivery, multi-leg (3+ legs), expired quotes at confirm time
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 6.1_

- [x] 5. Weight Correction Service
  - [x] 5.1 Implement `reportDiscrepancy`
    - Create `apps/api/src/services/weight-correction-service.ts`
    - Recompute every On_Demand_Leg of the delivery with corrected weight (using the leg's original `vehicleType` and current `VehicleTypeRates`)
    - Compute combined delta: (sum of corrected on-demand totals) − (sum of original on-demand totals)
    - Insert `weight_discrepancy_corrections` row with `approval_deadline = now() + weight_correction_approval_window_min`
    - Carrier_Legs are untouched
    - _Requirements: 12.1, 12.2_

  - [x] 5.2 Implement `respondToCorrection`
    - `approved`: apply delta as a separate wallet transaction (charge or refund), set `wallet_transaction_ref`, allow leg to proceed
    - `declined`: fail the delivery, apply `arrived_pickup` REFUND_RATES tier (85%) to original escrow
    - Validate correction is still in `pending_approval` status and not past deadline
    - _Requirements: 12.3, 12.4, 12.6_

  - [x] 5.3 Implement `resolveExpired`
    - Query pending corrections past `approval_deadline`
    - Execute same decline path as explicit customer decline
    - Called by alert-engine tick
    - _Requirements: 12.5, 12.6_

  - [ ]* 5.4 Write property test for weight correction delta
    - **Property 13: Weight discrepancy recomputes all on-demand legs only**
    - Generate deliveries with mixed leg types and various vehicle types, verify only on-demand legs recomputed with correct multiplier, carrier legs untouched
    - **Validates: Requirements 12.1, 12.2**

  - [ ]* 5.5 Write property test for correction as separate transaction
    - **Property 14: Weight correction delta is a separate transaction**
    - Verify original escrow remains untouched after approved correction
    - **Validates: Requirements 12.3**

  - [ ]* 5.6 Write unit tests for weight correction service
    - Test: report with weight increase (positive delta), weight decrease (negative delta), same weight (zero delta edge), expired correction, already-responded correction
    - Verify vehicle type multiplier is correctly applied during recomputation
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 6. Checkpoint — Services tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. API routes — quote, delivery, confirm, re-quote, weight correction
  - [x] 7.1 Implement `POST /api/v1/booking/quote` (Speculative Quote)
    - Create `apps/api/src/routes/booking-quote.ts`
    - Auth required, no delivery_id needed
    - Validate request body: legs array with legType, coordinates (for on-demand), carrierId (for intercity), packageWeight, and `vehicleType` (required per on-demand leg)
    - Return `INVALID_VEHICLE_TYPE` error (HTTP 400) if vehicleType is absent or not one of motorcycle/car/van/truck for an on-demand leg
    - Load `fee_settings` and `vehicle_type_rates` from DB
    - Call appropriate Fee Engine function per leg (passing `vehicleType` + `VehicleTypeRates` for on-demand), return itemized response
    - Never write to `quotes` table
    - Register route in `apps/api/src/index.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.2 Modify `POST /api/v1/deliveries` to create legs + authoritative quotes
    - Accept leg composition in request body: which legs exist, carrierId for intercity legs, `vehicleType` per on-demand leg
    - Create `delivery_legs` rows
    - Load `fee_settings` and `vehicle_type_rates` from DB
    - Call quote-service `createAuthoritativeQuotesForDelivery` within the same DB transaction
    - Return leg quotes + composite total in response (including vehicle type line item for on-demand legs)
    - _Requirements: 5.1, 3.1, 3.3_

  - [x] 7.3 Rewrite `POST /api/v1/booking/confirm` to use server-side quotes
    - Look up active Authoritative_Quote for every delivery_leg under the delivery
    - If any quote is missing → HTTP 422 (QUOTE_MISSING)
    - If any quote is expired → HTTP 409 (QUOTE_EXPIRED)
    - Sum all active quotes' `total_kobo` as escrow `totalAmount`
    - Ignore any client-supplied `amount` field
    - Remove the `// TODO(security)` comment at `booking-payment.ts:28-29`
    - Use `FOR UPDATE` row lock to prevent race with concurrent re-quote
    - Call `confirmAll` on success
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 5.4_

  - [x] 7.4 Implement `POST /api/v1/deliveries/:id/requote`
    - Only callable in draft/pending status (pre-pickup)
    - Re-run Fee Engine for affected legs (using the leg's `vehicleType` and current `VehicleTypeRates`), supersede those quotes only
    - Return new composite total for customer acknowledgment
    - _Requirements: 7.2_

  - [x] 7.5 Implement `POST /api/v1/deliveries/:id/legs/:legId/weight-correction`
    - Driver-only auth, validate leg is at `arrived_pickup` status and is an on-demand leg
    - Call weight-correction-service `reportDiscrepancy`
    - Return correction details (declared vs reported weight, delta, approval deadline)
    - _Requirements: 12.1, 12.2_

  - [x] 7.6 Implement `POST /api/v1/deliveries/:id/weight-correction/:correctionId/respond`
    - Customer-only auth
    - Validate correction is pending and not expired
    - Call weight-correction-service `respondToCorrection`
    - Return result (approved with transaction ref, or declined with refund details)
    - _Requirements: 12.3, 12.4, 12.5, 12.6_

  - [ ]* 7.7 Write property test for speculative quotes being stateless
    - **Property 7: Speculative quotes are stateless**
    - Call `POST /booking/quote` with valid inputs (including vehicleType per on-demand leg), verify quotes table row count unchanged
    - **Validates: Requirements 4.3**

  - [ ]* 7.8 Write property test for escrow total matching leg quote sum
    - **Property 10: Escrow total equals sum of active leg quotes**
    - Create deliveries with various leg compositions and vehicle types, confirm, verify escrow matches quote sum exactly
    - **Validates: Requirements 6.1**

  - [ ]* 7.9 Write integration tests for API routes
    - Test speculative quote round-trip (with different vehicle types returning different totals)
    - Test `INVALID_VEHICLE_TYPE` error for invalid/missing vehicleType
    - Test delivery creation + quotes, confirm with valid/expired/missing quotes, re-quote flow, weight correction flow
    - _Requirements: 4.1, 4.3, 4.4, 5.1, 5.4, 6.1, 6.3, 7.2, 12.1_

- [x] 8. Checkpoint — API routes tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Admin API routes — fee settings, carrier rates, reconciliation
  - [x] 9.1 Implement `GET/PUT /api/v1/admin/fee-settings`
    - Create `apps/api/src/routes/admin/fee-settings.ts`
    - `surewaka_admin` role required
    - GET: return current fee_settings row
    - PUT: validate input with Zod, update the singleton row, return updated settings
    - Register route in `apps/api/src/index.ts`
    - _Requirements: 9.1, 9.3_

  - [x] 9.2 Implement `GET/PUT /api/v1/admin/vehicle-type-rates`
    - In same file or separate `apps/api/src/routes/admin/fee-settings.ts`
    - `surewaka_admin` role required
    - GET: return all vehicle type rates (4 rows)
    - PUT: accept vehicle_type + new multiplier (must be > 0), update the row, return updated rates
    - Validate multiplier is numeric and positive
    - _Requirements: 9.2, 9.3_

  - [x] 9.3 Implement `PATCH /api/v1/admin/carriers/:id/rate`
    - Create `apps/api/src/routes/admin/carrier-rates.ts`
    - `surewaka_admin` role required
    - Validate new basePrice > 0
    - Update `carriers.basePrice`, insert `carrier_rate_history` row with old/new/reason/changed_by
    - Return updated carrier + history entry
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 9.4 Implement `POST/GET /api/v1/admin/carrier-reconciliations`
    - POST: accept carrier_id, period_start, period_end, invoiced_amount_kobo, notes
    - Compute `quoted_carrier_total_kobo` by summing "Carrier rate" line items from confirmed quotes for that carrier in the period
    - Compute `variance_kobo = quoted_carrier_total_kobo - invoiced_amount_kobo`
    - GET: list reconciliation records, filterable by carrier_id
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 9.5 Write property test for variance computation
    - **Property 15: Variance computation correctness**
    - Generate reconciliation scenarios, verify variance = sum(carrier rate line items) − invoiced_amount
    - **Validates: Requirements 11.2**

  - [ ]* 9.6 Write property test for forward-only fee/rate changes
    - **Property 12: Fee setting and rate changes are forward-only**
    - Change fee settings and vehicle type multipliers, verify existing quotes unchanged, new quotes use new values; verify rate history row created for carrier changes
    - **Validates: Requirements 9.3, 10.2, 10.3**

  - [ ]* 9.7 Write integration tests for admin routes
    - Test fee settings CRUD, vehicle type rates CRUD (update multiplier, verify new on-demand quotes reflect it)
    - Test carrier rate update + history, reconciliation entry + variance
    - Test non-admin access returns 403
    - _Requirements: 9.1, 9.2, 10.1, 10.2, 11.1, 11.2_

- [x] 10. Mobile Customer UI — booking flow
  - [x] 10.1 Add vehicle type selection to booking flow
    - In `apps/mobile-customer/app/booking/`, ensure vehicle type selection UI feeds into the booking store (`useBookingStore`)
    - Store selected `vehicleType` per on-demand leg in Zustand state
    - Pass `vehicleType` in all quote requests and delivery creation
    - _Requirements: 1.1, 1.4, 4.5_

  - [x] 10.2 Update carrier comparison screen with real speculative quotes
    - Modify `apps/mobile-customer/app/booking/carriers.tsx`
    - Call `POST /api/v1/booking/quote` with the full leg set (including `vehicleType` per on-demand leg) when the screen mounts or inputs change
    - Display each carrier's real itemized Speculative_Quote (carrier rate + service fee) instead of static `basePrice` "From ₦X"
    - Show vehicle type multiplier line item for on-demand legs
    - Show loading state while quote is being fetched
    - _Requirements: 4.1, 8.2_

  - [x] 10.3 Update booking review screen with composite quote display
    - Modify `apps/mobile-customer/app/booking/review.tsx`
    - Remove the hardcoded `const deliveryAmount = 350000` placeholder
    - Render the Composite_Quote's `line_items` grouped by leg from the delivery-creation response
    - Each leg gets a clear label (e.g., "First-mile pickup", "Intercity — GIG Logistics", "Last-mile delivery")
    - Show vehicle type multiplier as a visible line item per on-demand leg
    - Show each platform fee as a visible separate line item
    - _Requirements: 8.1, 8.3, 8.5_

  - [x] 10.4 Implement quote expiry countdown and refresh prompt
    - On the review screen, track `expires_at` from the authoritative quotes
    - When any quote has < 2 minutes remaining, show a prompt to refresh
    - On refresh, call re-quote endpoint and update displayed amounts
    - _Requirements: 8.4_

  - [x] 10.5 Remove client-supplied `amount` from confirm call
    - In the confirm action (booking store or review screen submit), stop sending the `amount` field to `POST /api/v1/booking/confirm`
    - The server now computes the total from its own quotes
    - _Requirements: 6.1, 6.2_

  - [x] 10.6 Implement weight correction approval screen
    - New screen/modal for the customer to approve or decline a weight discrepancy correction
    - Show: declared weight, reported weight, delta amount (charge or refund), approval deadline countdown
    - Call `POST /api/v1/deliveries/:id/weight-correction/:correctionId/respond` with decision
    - Handle push notification to navigate to this screen
    - _Requirements: 12.2, 12.3, 12.4_

- [x] 11. Mobile Driver UI — weight correction reporting
  - [x] 11.1 Implement "report actual weight" step at arrived_pickup
    - In `apps/mobile-driver`, add a weight entry step when leg status is `arrived_pickup` for an on-demand leg
    - Allow driver to enter actual weight in kg
    - Call `POST /api/v1/deliveries/:id/legs/:legId/weight-correction`
    - Show confirmation that correction has been submitted and awaiting customer response
    - Handle the "proceed" signal once customer approves (leg transitions to `picked_up`)
    - _Requirements: 12.1_

- [x] 12. Admin UI — rate maintenance, vehicle type rates, and reconciliation
  - [x] 12.1 Add carrier rate edit control to carrier detail screen
    - In `apps/admin`, add a rate-edit form on the carrier detail page
    - Wire to `PATCH /api/v1/admin/carriers/:id/rate` with reason field
    - Display `carrier_rate_history` as a changelog below the current rate
    - _Requirements: 10.1, 10.2_

  - [x] 12.2 Add fee settings management screen (including vehicle type rates)
    - New admin screen for viewing and editing `fee_settings`
    - Include a section for vehicle type rate multipliers — show all four types with editable multiplier fields
    - Wire fee settings to `GET/PUT /api/v1/admin/fee-settings`
    - Wire vehicle type rates to `GET/PUT /api/v1/admin/vehicle-type-rates`
    - Show current values with edit form; indicate that changes apply only to future quotes
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 12.3 Add reconciliation entry and display to Carrier Performance tab
    - Modify `apps/admin/app/components/analytics/carrier-performance-tab.tsx`
    - Add reconciliation entry form: carrier selection, period dates, invoiced amount, notes
    - Display per-carrier per-period: total quoted service-fee revenue, variance, net
    - Wire to `POST/GET /api/v1/admin/carrier-reconciliations`
    - _Requirements: 11.1, 11.2, 11.4_

- [x] 13. Alert Engine — weight correction expiry check
  - [x] 13.1 Implement correction expiry rule in alert-engine
    - Add a new check in `workers/alert-engine/src/rules/` (separate from the 7 existing alert rules)
    - Each 60s tick: query `weight_discrepancy_corrections` WHERE `status = 'pending_approval' AND approval_deadline < now()`
    - For each expired correction, call `resolveExpired()` from weight-correction-service (decline + refund + fail delivery)
    - _Requirements: 12.5, 12.6_

  - [ ]* 13.2 Write integration test for correction expiry
    - Create a pending correction with a past deadline, run the expiry check, verify it's declined and delivery is failed with correct refund
    - _Requirements: 12.5, 12.6_

- [x] 14. Final checkpoint — full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Rate maintenance (task 9.3) and margin reconciliation (task 9.4) can be built in parallel with mobile UI (tasks 10–11) once schema (task 1) lands
- The weight correction flow depends on push notifications being available — the alert-engine expiry check (task 13) is the safety net
- Vehicle type multiplier is multiplicative (applied to on-demand subtotal before tax), not an additive fixed fee — this ensures all cost components scale proportionally with vehicle class
- `vehicle_type_rates` is seeded with defaults (motorcycle=1.0, car=1.3, van=1.6, truck=2.0) and admin-editable only by `surewaka_admin` role

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 1, "tasks": ["1.9"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 5, "tasks": ["4.5", "4.6", "4.7", "5.1", "5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4", "5.5", "5.6", "7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.5", "7.6"] },
    { "id": 8, "tasks": ["7.7", "7.8", "7.9", "9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["9.5", "9.6", "9.7", "10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "11.1", "12.1", "12.2", "12.3"] },
    { "id": 10, "tasks": ["13.1"] },
    { "id": 11, "tasks": ["13.2"] }
  ]
}
```
