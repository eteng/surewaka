- [] WhatsApp-first phone auth — Clerk handles sessions/identity, Termii delivers OTP (WhatsApp primary, SMS fallback). Clerk webhook intercepts OTP delivery at POST /webhooks/clerk/otp. Driver app needs auth screens built from scratch (sign-in, verify, register). Customer app needs text updates + resend option. API needs Termii service + webhook handler + optional role:'driver' on register endpoint. No DB schema changes. Design discussed 2026-07-12, brainstorming doc exists in conversation context.

- [x] DONE: payout/withdrawal flow wired end-to-end (2026-07-12) — process-payout job, Paystack Transfer API, transfer webhooks, push notifications, admin list endpoint. Known limitation: if all BullMQ retries exhaust before reaching Paystack (e.g. createRecipient keeps failing), wallet is re-credited but no push notification fires — user sees balance restored but gets no explicit "withdrawal failed" push. Webhook path (transfer.failed/reversed) always pushes correctly.

- [] Saved bank accounts — let users save verified bank accounts (user_bank_accounts table with userId, bankCode, accountNumber, paystackRecipientCode) so repeat withdrawals pre-fill and skip recipient creation. UX feature, not a blocker for payout v1.
- [] Admin payout retry — add "Retry" button on failed payout rows in the admin payout list (re-enqueues the process-payout job). Fast follow after payout v1 plumbing ships.

- [] booking order sumarry
- []  total and tax
- [] how is delievery fee calculated
- [] Delivery options - order for later / saver  / standard / Priority 
- [] offers / promos / gift code here / apply and 
- [] use points /SureWakaCoins 
- [] Package weight and category are captured on delivery creation ywith AI 

- [x] DONE: Withdrawal fee (2026-07-16) — flat ₦100 fee per payout request. `withdrawal_fee_kobo` added to fee_settings (default 10000, admin-configurable via Fee Settings page). Deducted from wallet on payout request alongside transfer amount; refunded in full if transfer exhausts retries. Admin payout list shows fee as sub-line under Amount.

- [x] DONE: Intercity routing / path optimization spec written (2026-07-21) — see .kiro/specs/routing-worker/. carrier_parks + carrier_routes + carrier_route_schedules schema, Dijkstra routing engine, BullMQ routing worker, surewaka_way delivery mode.

- [] Compensation voucher / credit system — when SureWaka cannot find an on-demand driver by the scheduled pick-up time, the customer cancels free and receives a compensation voucher. Voucher/credit system does not yet exist. Record the obligation as a ledger event for now; build redemption flow as a dedicated spec.
- [] No-show detection — customer fails to be at pickup within 15 min of scheduled time triggers a cancellation fee (= full leg price). Needs a cron/timer job that marks the delivery and charges the fee; driver matching system must be in place first.
- [] Admin UI for carrier parks / routes / schedules — CRUD screens in the admin dashboard for managing carrier parks, routes, and departure slots. API endpoints exist (routing-worker spec); UI is a separate spec.
- [] CSV / bulk import of carrier parks and routes — operator tooling for seeding the carrier network at scale; manual API calls are the interim solution.
- [] First/last-mile cost factored into route selection — routing engine currently optimises intercity cost only; first/last-mile is additive after the path is chosen. True end-to-end cost optimisation requires knowing distance from customer to each candidate origin park before Dijkstra runs.
- [] Carrier direct: self-drop-off flow — customer physically delivers to the origin park themselves (no first_mile leg). Carrier staff register the delivery in SureWaka for tracking. Needs a distinct booking path and carrier-side registration UI.
- [] Carrier slot reservation — when a surewaka_way route is confirmed, notify/reserve the carrier's departure slot so capacity is tracked; not modelled in the routing-worker spec.
- [] Carrier settlement/payout — no carrierWalletId exists anywhere, escrow_holds only pays drivers (see ADR-009)
- [] Real carrier rate-card integration — replace static carriers.basePrice with live per-shipment carrier rates/API
- [] Package category/dimension discrepancy correction at pickup — pricing spec only covers weight correction (Req 12), not category/size mismatches
- [] Zone-based delivery surcharges — wire dynamic-zones data into the fee engine once that spec ships
- [] Dispute Resolution & Refund SLA spec — not yet written (see docs/superpowers/specs/2026-07-08-operational-excellence-strategy.md)
- [] Time of day / surge pricing — dynamic demand-based pricing, explicitly out of scope for pricing-transparency v1
- [] Fuel surcharge — separate line item reflecting fuel cost volatility, not yet in the fee_settings model
- [] Insurance — package protection / delivery insurance fee, not yet scoped anywhere
- [] VAT — fee_settings already has a tax_rate_pct field scaffolded at 0% (pricing-transparency spec) so turning it on is a rate change not a schema change, but the actual VAT-registration/activation decision hasn't been made
