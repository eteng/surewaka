# Weight Correction Interim Guards — Design

## Overview

Three validation layers in the report path, one async fraud signal, and one admin reversal endpoint:

```
Driver calls POST /deliveries/:id/legs/:legId/weight-correction
                           │
                    ┌──────┼──────────────────────────────────┐
                    │      ▼                                    │
                    │  REQ-2: |delta| < 0.5kg?                 │
                    │    YES → 200 WITHIN_TOLERANCE (no-op)    │
                    │    NO  → continue                        │
                    │      ▼                                    │
                    │  REQ-1: reported > 3× declared?          │
                    │    YES → 422 WEIGHT_DELTA_TOO_LARGE      │
                    │    NO  → continue                        │
                    │      ▼                                    │
                    │  [existing logic: compute delta,          │
                    │   insert correction row, notify customer] │
                    │      ▼                                    │
                    │  REQ-3: count corrections for driver      │
                    │   in last 7 days — if > 5, fire alert    │
                    │                                          │
                    └──────────────────────────────────────────┘

Admin calls POST /admin/deliveries/:id/reverse-weight-correction
                           │
                    ┌──────┼──────────────────────────────────┐
                    │      ▼                                    │
                    │  Validate: delivery failed + correction   │
                    │  expired/declined                         │
                    │      ▼                                    │
                    │  Credit remaining 15% to customer wallet  │
                    │  Update correction → reversed             │
                    │  Write commission_reversal ledger event   │
                    └──────────────────────────────────────────┘
```

---

## Validation Guards (in `reportDiscrepancy`)

### Current function signature (unchanged)

```ts
export async function reportDiscrepancy(
  db: DrizzleDB,
  deliveryId: string,
  reportedLegId: string,
  reportedWeightKg: number,
  settings: FeeSettings,
  vehicleTypeRates: VehicleTypeRates,
): Promise<{ ... }>
```

### New early-return validations (inserted before the existing logic)

```ts
import {
  MAX_WEIGHT_CORRECTION_MULTIPLIER,
  MIN_WEIGHT_CORRECTION_KG,
  WEIGHT_CORRECTION_ABUSE_COUNT,
  WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS,
} from '@surewaka/shared';

// Inside reportDiscrepancy, after loading delivery.packageWeight:

const declaredWeightKg = delivery.packageWeight;

// REQ-2: Minimum delta threshold
const absDelta = Math.abs(reportedWeightKg - declaredWeightKg);
if (absDelta < MIN_WEIGHT_CORRECTION_KG) {
  throw new Error('WITHIN_TOLERANCE');
}

// REQ-1: Maximum delta cap
if (reportedWeightKg > declaredWeightKg * MAX_WEIGHT_CORRECTION_MULTIPLIER) {
  throw new Error('WEIGHT_DELTA_TOO_LARGE');
}

// ... existing logic continues ...
```

### Route handler error mapping

In `apps/api/src/routes/deliveries.ts`, the weight-correction POST handler's catch block:

```ts
if (message === 'WITHIN_TOLERANCE') {
  return c.json(
    { data: { status: 'within_tolerance' }, error: null, meta: null },
    200,
  );
}

if (message === 'WEIGHT_DELTA_TOO_LARGE') {
  return c.json(
    {
      data: null,
      error: {
        code: 'WEIGHT_DELTA_TOO_LARGE',
        message: 'Reported weight exceeds 3× declared. Contact support for manual review.',
      },
      meta: null,
    },
    422,
  );
}
```

---

## Driver Fraud Flag (REQ-3)

### After successful correction insertion

```ts
// After the insert into weightDiscrepancyCorrections (end of reportDiscrepancy):

// REQ-3: Check driver correction frequency (fire-and-forget — don't block the response)
void checkDriverCorrectionFrequency(db, reportedLegId, deliveryId);
```

### Separate async function

```ts
import { alerts, deliveryLegs, weightDiscrepancyCorrections } from '@surewaka/db';
import { sql, eq, and, gte, inArray } from 'drizzle-orm';

async function checkDriverCorrectionFrequency(
  db: DrizzleDB,
  reportedLegId: string,
  deliveryId: string,
): Promise<void> {
  try {
    // Find the driver who owns this leg
    const [leg] = await db
      .select({ actorId: deliveryLegs.actorId })
      .from(deliveryLegs)
      .where(eq(deliveryLegs.id, reportedLegId));

    if (!leg) return;
    const driverId = leg.actorId;

    // Count corrections on legs assigned to this driver in the last 7 days
    const windowStart = new Date(
      Date.now() - WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    // Get all leg IDs for this driver
    const driverLegs = await db
      .select({ id: deliveryLegs.id })
      .from(deliveryLegs)
      .where(eq(deliveryLegs.actorId, driverId));

    const driverLegIds = driverLegs.map((l) => l.id);
    if (driverLegIds.length === 0) return;

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(weightDiscrepancyCorrections)
      .where(
        and(
          inArray(weightDiscrepancyCorrections.reportedLegId, driverLegIds),
          gte(weightDiscrepancyCorrections.createdAt, windowStart),
        ),
      );

    const count = result?.count ?? 0;

    if (count > WEIGHT_CORRECTION_ABUSE_COUNT) {
      // Fire alert
      await db.insert(alerts).values({
        deliveryId,
        legId: reportedLegId,
        rule: 'weight_correction_abuse',
        severity: 'warning',
        context: { driverId, count, window: `${WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS}d` },
        firedAt: new Date(),
      });
    }
  } catch (err) {
    // Non-critical — log and continue
    console.error('[weight-correction] Failed to check driver frequency:', err);
  }
}
```

---

## Admin Reversal Endpoint (REQ-4)

### File: `apps/api/src/routes/admin/deliveries.ts` (add to existing file)

```ts
// POST /admin/deliveries/:id/reverse-weight-correction
adminDeliveryRoutes.post('/:id/reverse-weight-correction', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('id');

  // 1. Load delivery
  const [delivery] = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      customerId: deliveries.customerId,
      amountPaid: deliveries.amountPaid,
      escrowHoldId: deliveries.escrowHoldId,
    })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!delivery) {
    return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
  }

  if (delivery.status !== 'failed') {
    return c.json(
      { data: null, error: { code: 'INVALID_STATUS', message: 'Only failed deliveries can be reversed' }, meta: null },
      422,
    );
  }

  // 2. Find the expired/declined correction
  const [correction] = await db
    .select()
    .from(weightDiscrepancyCorrections)
    .where(
      and(
        eq(weightDiscrepancyCorrections.deliveryId, deliveryId),
        inArray(weightDiscrepancyCorrections.status, ['expired', 'declined']),
      ),
    )
    .limit(1);

  if (!correction) {
    return c.json(
      { data: null, error: { code: 'NO_CORRECTION', message: 'No expired/declined weight correction found for this delivery' }, meta: null },
      422,
    );
  }

  if (correction.status === 'reversed') {
    return c.json(
      { data: null, error: { code: 'ALREADY_REVERSED', message: 'Correction already reversed' }, meta: null },
      409,
    );
  }

  // 3. Compute the withheld amount (15% of original escrow)
  const originalAmount = Number(delivery.amountPaid ?? 0);
  const alreadyRefunded = Math.floor(originalAmount * 0.85);
  const withheldAmount = originalAmount - alreadyRefunded;

  if (withheldAmount <= 0) {
    return c.json(
      { data: null, error: { code: 'NOTHING_TO_REVERSE', message: 'No withheld amount to refund' }, meta: null },
      422,
    );
  }

  // 4. Credit the customer
  const wallet = await getWalletByUserId(delivery.customerId);
  await creditWallet(
    wallet.id,
    withheldAmount,
    'refund',
    `weight_correction_reversal_${correction.id}`,
    `Admin reversal of weight correction for delivery ${deliveryId}`,
    { correction_id: correction.id, delivery_id: deliveryId, reversed_by: user.id },
  );

  // 5. Update correction status
  await db
    .update(weightDiscrepancyCorrections)
    .set({ status: 'reversed', respondedAt: new Date() })
    .where(eq(weightDiscrepancyCorrections.id, correction.id));

  // 6. Ledger event
  writeLedgerEvent({
    category: 'revenue',
    type: 'commission_reversal',
    amountKobo: withheldAmount,
    sourceId: delivery.escrowHoldId ?? delivery.id,
    sourceType: 'escrow_hold',
  }).catch((err) => console.error('[admin] reversal ledger write failed:', err));

  return c.json({
    data: {
      correctionId: correction.id,
      refundedAmountKobo: withheldAmount,
      newCorrectionStatus: 'reversed',
    },
    error: null,
    meta: null,
  });
});
```

---

## Schema Changes

### `weight_discrepancy_corrections.status` — add `'reversed'`

Current allowed values: `pending_approval`, `approved`, `declined`, `expired`.

Add `reversed` — no check constraint exists (it's a text column with no `CHECK`), so no migration needed. Just ensure the service and admin route can write `'reversed'`.

### `alerts` table — new rule value

Add `'weight_correction_abuse'` to `ALERT_RULES` constant. The `alerts.rule` column is text — no DB constraint update needed, just the TypeScript constant.

---

## Constants (in `packages/shared/src/constants.ts`)

```ts
// ─── Weight Correction Guards ─────────────────────────────────────────────────

export const MAX_WEIGHT_CORRECTION_MULTIPLIER = 3;
export const MIN_WEIGHT_CORRECTION_KG = 0.5;
export const WEIGHT_CORRECTION_ABUSE_COUNT = 5;
export const WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS = 7;
```

---

## File Changes Summary

| File | Change Type |
|------|------------|
| `packages/shared/src/constants.ts` | Modify — add 4 constants + 1 alert rule |
| `apps/api/src/services/weight-correction-service.ts` | Modify — add validation guards + frequency check |
| `apps/api/src/routes/deliveries.ts` | Modify — add error handling for new throw codes |
| `apps/api/src/routes/admin/deliveries.ts` | Modify — add reversal endpoint |
| `apps/api/src/routes/admin/deliveries.ts` | Import `writeLedgerEvent`, `creditWallet`, `getWalletByUserId` |

---

## Testing Strategy

- **Unit test `reportDiscrepancy`:** mock DB, test that <0.5kg delta returns WITHIN_TOLERANCE, >3× returns WEIGHT_DELTA_TOO_LARGE, valid delta proceeds normally
- **Unit test frequency check:** mock DB to return count > 5, assert alert is inserted
- **Integration test admin reversal:** mock auth as admin, create a failed delivery with expired correction, call reversal endpoint, assert wallet credit + correction status + ledger event
