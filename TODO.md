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

- [] Withdrawal fee — add `withdrawal_fee_kobo` to fee_settings, deduct fee on payout request. Decide model: fee added on top of withdrawal amount vs deducted from transfer. Covers Paystack ₦10 transfer cost + platform margin.

- [] Intercity routing / path optimization — "SureWaka way" end-to-end auto-routing, cheapest path across carrier network, may chain multiple intercity legs. Needs delivery_legs.leg_number cap lifted first (see .kiro/specs/pricing-transparency out-of-scope)
- [] Carrier settlement/payout — no carrierWalletId exists anywhere, escrow_holds only pays drivers (see ADR-009)
- [] Real carrier rate-card integration — replace static carriers.basePrice with live per-shipment carrier rates/API
- [] Package category/dimension discrepancy correction at pickup — pricing spec only covers weight correction (Req 12), not category/size mismatches
- [] Zone-based delivery surcharges — wire dynamic-zones data into the fee engine once that spec ships
- [] Dispute Resolution & Refund SLA spec — not yet written (see docs/superpowers/specs/2026-07-08-operational-excellence-strategy.md)
- [] Time of day / surge pricing — dynamic demand-based pricing, explicitly out of scope for pricing-transparency v1
- [] Fuel surcharge — separate line item reflecting fuel cost volatility, not yet in the fee_settings model
- [] Insurance — package protection / delivery insurance fee, not yet scoped anywhere
- [] VAT — fee_settings already has a tax_rate_pct field scaffolded at 0% (pricing-transparency spec) so turning it on is a rate change not a schema change, but the actual VAT-registration/activation decision hasn't been made
