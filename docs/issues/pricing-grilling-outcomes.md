# Pricing Grilling Session — Outcomes & Tasks

Tracked decisions and follow-up tasks from the pricing architecture grilling session (Jul 2026).

---

## Resolved Decisions

| # | Topic | Decision |
|---|-------|----------|
| Q1 | Haversine vs real road distance | Integrate Mapbox Directions API before launch (cheaper than Google at $0.60/1000 requests) |
| Q2 | Flat carrier pricing | Solved — `carrier_routes.basePriceKobo` is route-specific (park→park) |
| Q3 | Clock skew race on quote expiry | 15-min window is sufficient; surewaka_way auto-re-routes on QUOTE_EXPIRED. No action. |
| Q4 | Fee_settings change between speculative/authoritative quote | Accept the gap — authoritative quote at delivery creation is the truth. Admin changes are infrequent. |
| Q6 | Fraudulent weight reports | Interim guards + mandatory photo proof (customer at booking, driver at pickup). AI verification planned. |
| Q8 | Missing ledger reversal on cancellation | Partially addressed — late-cancel surewaka_way writes commission. Full-refund reversals still missing (see task below). |
| Q9 | Haversine in routing worker | Same fix as Q1 — Mapbox Directions in routing worker |
| Q10 | Cancellation deadline UI | Need to build; data already available in `cancellationDeadlineAt` |
| Q11 | Transfer driver dispatch | Triggered by carrier marking intercity leg as delivered OR park staff confirming arrival → auto-dispatch to driver pool |
| Q12 | Stalled routing jobs | No protection currently — need resilience implementation |

---

## Task: Replace haversine with Mapbox Directions API

**Priority:** P1 (pre-launch)  
**Workstream:** Tech  
**Status:** ✅ Complete (2026-07-25)

### What
Replace all `haversineKm()` calls in pricing/quoting paths with actual road distance from Mapbox Directions API.

### Affected call sites
1. `apps/api/src/routes/booking-quote.ts` — speculative quotes (first/last-mile distance)
2. `apps/api/src/routes/deliveries.ts` — authoritative quotes at delivery creation
3. `workers/routing-worker/src/jobs/route-delivery.ts` — first-mile, last-mile, and transfer leg distances

### Implementation
- Create `packages/shared/src/lib/mapbox-distance.ts` (or `apps/api/src/lib/mapbox-distance.ts`)
- `async function getRouteDistanceKm(fromLat, fromLng, toLat, toLng): Promise<number>`
- Use Mapbox Directions API: `https://api.mapbox.com/directions/v5/mapbox/driving/{lng1},{lat1};{lng2},{lat2}`
- Extract `routes[0].distance` (meters) → convert to km
- Fallback to haversine if Mapbox call fails (network timeout, rate limit)
- Env var: `MAPBOX_ACCESS_TOKEN` (already in use for admin map)
- Cache results for same coordinate pairs within a session (avoid duplicate calls for same park)

### Cost estimate
- $0.60 per 1,000 requests (Mapbox Directions)
- ~7 calls per booking session (speculative quotes)
- ~5 calls per routing job (first-mile + last-mile + transfers)
- At 1,000 bookings/day: ~$7/day — well within budget

---

## Task: Routing worker resilience (Q12)

**Priority:** P1 (pre-launch)  
**Workstream:** Tech  
**Status:** ✅ Complete (2026-07-25)

### Problem
The routing worker (`workers/routing-worker`) has no protection against stalled jobs. If the process dies mid-job (OOM, deploy, Fly.io eviction), deliveries stay in `pending_routing` indefinitely.

### Current gaps
- No `stalledInterval` configured — stalled detection relies on BullMQ defaults
- No `lockDuration` override — default 30s is too short for routing jobs (10-30s execution)
- No graceful shutdown handler — `SIGTERM` kills mid-job
- No external rescue mechanism for truly orphaned jobs
- No `stalled` event listener for observability

### Implementation plan

#### 1. Worker configuration (`workers/routing-worker/src/index.ts`)
```ts
const worker = new Worker('routing', handler, {
  connection,
  concurrency: 3,
  lockDuration: 120_000,       // 2 min — routing jobs do DB + graph + Ably
  stalledInterval: 60_000,     // Check for stalled every 60s
  maxStalledCount: 2,          // 2 stalls before failing (forgives GC pauses)
});

worker.on('stalled', (jobId) => {
  console.warn(`[routing-worker] Job ${jobId} stalled — will be retried`);
});
```

#### 2. Graceful shutdown
```ts
async function shutdown() {
  console.info('[routing-worker] Shutting down gracefully...');
  await worker.close();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

#### 3. Cron rescue job (`workers/cron/src/jobs/rescue-stale-routing.ts`)
- Runs every 5 minutes
- Queries: `SELECT * FROM deliveries WHERE status = 'pending_routing' AND created_at < now() - interval '10 minutes'`
- For each: re-enqueue to routing queue with fresh `bookingTime`
- Idempotent: routing worker's existing status check (`if (status !== 'pending_routing') skip`) prevents double-processing

#### 4. Health check endpoint
- HTTP server on port 4002 (or via Fly.io's built-in TCP check)
- Reports: Redis connected, queue stats (waiting/active/stalled), last job completion time
- Fly.io health check restarts zombie workers

---

## Task: Cancellation deadline UI (Q10)

**Priority:** P2  
**Workstream:** Tech  
**Status:** ✅ Complete (2026-07-25)

Implemented:
1. `confirm.tsx` — shows "Free cancellation until [time]" with clear explanation of consequences
2. `tracking/[id].tsx` — shows cancellation deadline for surewaka_way deliveries in pending status, with dynamic text indicating whether window is still open or has passed

### What
Show the customer when their free-cancel window closes for surewaka_way deliveries.

### Where
1. **Confirm screen** (`apps/mobile-customer/app/booking/confirm.tsx`) — already shows `expiresAt` (quote expiry), should also show cancellation deadline with explanation
2. **Delivery detail/tracking screen** — show countdown or timestamp: "Free cancellation until [time]"
3. **Push notification** — consider sending a reminder 30 min before deadline closes

### Data
`deliveries.cancellationDeadlineAt` is already returned by `GET /deliveries/:id`. No API changes needed — purely mobile UI work.

---

## Task: Weight correction interim guards (Q6)

**Priority:** P2 (before launch)  
**Workstream:** Tech  
**Status:** ✅ Complete (2026-07-25)

### What
Prevent fraudulent/accidental weight correction abuse before the photo+AI system is built.

### Guards to implement
1. **Max delta cap:** Driver cannot report more than 3× declared weight without manual admin review. Reject the correction request with a specific error code.
2. **Min delta threshold:** Don't trigger the customer-facing correction flow for differences under 0.5kg — absorb it silently.
3. **Driver fraud flag:** If a driver triggers >5 weight corrections in 7 days, flag their account for ops review (insert into alert system with rule `weight_correction_abuse`).
4. **Admin override path:** If a correction auto-expires and customer disputes via support, admin can reverse the 85% refund and issue full refund manually.

### Where
- `apps/api/src/services/weight-correction-service.ts` — `reportDiscrepancy()` function: add validation before inserting correction
- Alert engine: add new rule for driver correction frequency

---

## Task: Platform ledger — commission reversal on full refund (Q8)

**Priority:** P2  
**Workstream:** Tech  
**Status:** ✅ Complete (2026-07-25)

**Resolution:** After analysis, the original framing (commission_reversal for full refunds) was incorrect. Full refunds (100%) happen when escrow is still `held` — no commission was ever earned, so nothing to reverse. The actual gap was: partial refunds (50-85%) retain escrow that represents platform revenue, but it wasn't recorded. Fixed by adding a `commission` ledger event for the retained portion on partial-refund cancellations. The existing `payment-worker/src/jobs/refund.ts` already handles `commission_reversal` for post-delivery refunds.

### Problem
When a delivery is cancelled with a full 100% refund (status: `pending` or `accepted`), the platform earned zero revenue — but no `commission_reversal` ledger event is written. P&L reporting will overcount.

### Where the gap exists
- `apps/api/src/routes/booking-payment.ts` — the `POST /deliveries/:id/cancel` handler for non-surewaka_way deliveries with `REFUND_RATES` at 100%
- Any refund path where `refundAmount === amountPaid`

### Fix
After the transaction commits, if `refundAmount === amountPaid` (full refund) and an escrow existed, write:
```ts
writeLedgerEvent({
  category: 'revenue',
  type: 'commission_reversal',
  amountKobo: /* original commission from that delivery */,
  sourceId: escrowHoldId,
  sourceType: 'escrow_hold',
});
```

**Challenge:** The original commission amount isn't stored explicitly. Options:
- (a) Compute it: for on-demand legs, commission = `COMMISSION_RATE × totalKobo`; for carrier legs, commission = service fee line item
- (b) Store commission earned at confirm-time in a new `escrow_holds.commissionKobo` column

Option (b) is cleaner for auditing. Add the column and populate it in `POST /booking/confirm`.

---

## Task: Transfer driver dispatch design (Q11)

**Priority:** P2  
**Workstream:** Product + Tech

### What
Design and implement the trigger mechanism for dispatching a driver to move a package between parks in an intermediate city during multi-hop surewaka_way deliveries.

### Trigger
When carrier marks intercity leg as `delivered` (package arrived at destination park):
1. System identifies the next leg (type: `transfer`)
2. Enters the transfer leg into the driver matching pool for that city
3. A driver accepts → transfer leg status moves to `accepted` → normal on-demand flow from there

### Open questions to resolve
- Does the driver matching pool already exist? (Current system has NIL_UUID placeholders for driver assignment)
- Is there a park-staff confirmation step, or is the carrier's status update sufficient?
- SLA for transfer dispatch: how long before we alert ops that no driver has accepted?
- Payment: transfer leg cost is already in the composite quote (customer paid upfront) — driver gets paid from that portion via subtractive commission. Confirm this flow matches the escrow disbursement design.

### Dependency
- Driver matching/dispatch system (not yet built for any delivery mode)
- This is blocked until driver matching exists
