# Weight Correction Interim Guards — Requirements

## Context

The weight correction system allows drivers to report a package weight discrepancy at pickup.
If the actual weight differs from the customer's declared weight, the fee engine recomputes
the price delta and gives the customer 10 minutes to approve or decline.

Currently there are **no guards** against abuse:

- A malicious driver can report 50kg on a 2kg document envelope — enormous delta charge
- If the customer misses the notification (asleep, phone silent), the correction auto-expires
  and the delivery fails with only an 85% refund — the customer loses 15% to a false report
- No photo evidence is required
- No limit on how often a single driver can trigger corrections
- No admin path to reverse an auto-expired correction after a customer complaint

This spec adds **interim guards** (validation rules, fraud scoring, admin override) to
protect customers until the full photo+AI verification system is built.

---

## User Stories

### REQ-1 — Maximum delta cap

WHEN a driver reports a weight that exceeds 3× the declared weight,  
THEN the correction request is rejected with a specific error,  
THEN the driver is told to contact support for manual review.

Acceptance criteria:
- Validation: `reportedWeightKg <= declaredWeightKg * 3`
- If violated: return HTTP 422 with `{ code: 'WEIGHT_DELTA_TOO_LARGE', message: 'Reported weight exceeds 3× declared. Contact support for manual review.' }`
- The 3× multiplier is a constant (`MAX_WEIGHT_CORRECTION_MULTIPLIER = 3`) in `packages/shared/src/constants.ts`
- No correction row is inserted — the request is blocked before any DB write
- The check lives in `reportDiscrepancy()` in `weight-correction-service.ts`, before the computation logic

### REQ-2 — Minimum delta threshold

WHEN the absolute weight difference is less than 0.5kg,  
THEN the correction is silently ignored (not sent to the customer),  
THEN the driver is told "Difference is within acceptable tolerance" and the delivery proceeds normally.

Acceptance criteria:
- Validation: `Math.abs(reportedWeightKg - declaredWeightKg) >= 0.5`
- If below threshold: return HTTP 200 with `{ code: 'WITHIN_TOLERANCE', message: 'Weight difference is within acceptable tolerance. Delivery continues.' }`
- No correction row is inserted
- Constant: `MIN_WEIGHT_CORRECTION_KG = 0.5` in `packages/shared/src/constants.ts`
- The delivery continues as-is — no status change, no notification to customer

### REQ-3 — Driver correction frequency flag

WHEN a driver triggers more than 5 weight corrections within a 7-day rolling window,  
THEN an alert is fired with rule `weight_correction_abuse` and severity `warning`,  
THEN the driver's subsequent correction requests are still allowed (not blocked) but flagged for ops review.

Acceptance criteria:
- After successfully inserting a `weight_discrepancy_corrections` row, query: `SELECT COUNT(*) FROM weight_discrepancy_corrections WHERE reported_leg_id IN (legs assigned to this driver) AND created_at > now() - interval '7 days'`
- If count > 5: insert an alert row with `rule: 'weight_correction_abuse'`, `severity: 'warning'`, `context: { driverId, count, window: '7d' }`
- Add `'weight_correction_abuse'` to the `ALERT_RULES` constant in `packages/shared/src/constants.ts`
- Thresholds: `WEIGHT_CORRECTION_ABUSE_COUNT = 5`, `WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS = 7` — both in constants
- The alert is informational — it doesn't block the current correction, just flags the driver

### REQ-4 — Admin manual correction reversal

WHEN a customer contacts support after an auto-expired weight correction claiming fraud,  
THEN a SureWaka admin can reverse the failed delivery and issue a full refund.

Acceptance criteria:
- New endpoint: `POST /api/v1/admin/deliveries/:id/reverse-weight-correction`
- Requires `surewaka_admin` role
- Validates: delivery status is `failed` and a `weight_discrepancy_corrections` row exists with status `expired` or `declined`
- Action: credits the customer's wallet with the remaining 15% that was withheld (the difference between 100% and the 85% already refunded)
- Updates the correction row status to `reversed`
- Writes a `commission_reversal` ledger event for the withheld amount
- Idempotent: if correction status is already `reversed`, returns 409

### REQ-5 — Constants and configuration

WHEN the system needs to reference weight correction guard thresholds,  
THEN all values are defined as named constants in `packages/shared/src/constants.ts`.

Acceptance criteria:
- `MAX_WEIGHT_CORRECTION_MULTIPLIER = 3` (REQ-1)
- `MIN_WEIGHT_CORRECTION_KG = 0.5` (REQ-2)
- `WEIGHT_CORRECTION_ABUSE_COUNT = 5` (REQ-3)
- `WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS = 7` (REQ-3)
- All exported and usable in both API and worker code
- Future: these could be moved to `fee_settings` for admin configurability, but constants are sufficient for MVP
