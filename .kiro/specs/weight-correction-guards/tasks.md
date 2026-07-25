# Weight Correction Interim Guards — Tasks

Bottom-up order: constants → service logic → route handlers → admin endpoint → tests.
Pick up from the first unchecked task.

---

## Layer 1 — Constants

- [ ] 1. Add weight correction guard constants to `packages/shared/src/constants.ts`: `MAX_WEIGHT_CORRECTION_MULTIPLIER = 3`, `MIN_WEIGHT_CORRECTION_KG = 0.5`, `WEIGHT_CORRECTION_ABUSE_COUNT = 5`, `WEIGHT_CORRECTION_ABUSE_WINDOW_DAYS = 7`. Export all.

- [ ] 2. Add `'weight_correction_abuse'` to the `ALERT_RULES` array in `packages/shared/src/constants.ts`.

---

## Layer 2 — Service Validation Guards

- [ ] 3. Update `apps/api/src/services/weight-correction-service.ts` → `reportDiscrepancy()`: after loading `delivery.packageWeight`, add minimum delta check — if `Math.abs(reportedWeightKg - declaredWeightKg) < MIN_WEIGHT_CORRECTION_KG`, throw `new Error('WITHIN_TOLERANCE')`. This must be the first validation (before the max delta check).

- [ ] 4. In the same function, add maximum delta check — if `reportedWeightKg > declaredWeightKg * MAX_WEIGHT_CORRECTION_MULTIPLIER`, throw `new Error('WEIGHT_DELTA_TOO_LARGE')`. This check comes after the minimum delta check and before the existing computation logic.

- [ ] 5. In the same file, add `checkDriverCorrectionFrequency(db, reportedLegId, deliveryId)` async function: queries all legs assigned to the reporting driver, counts corrections in the last 7 days, fires a `weight_correction_abuse` alert if count exceeds threshold. Call it with `void` (fire-and-forget) after the successful correction insert at the end of `reportDiscrepancy()`.

---

## Layer 3 — Route Handler Error Mapping

- [ ] 6. Update `apps/api/src/routes/deliveries.ts` → the `POST /:id/legs/:legId/weight-correction` handler's catch block: add handling for `WITHIN_TOLERANCE` (return 200 with `{ data: { status: 'within_tolerance' }, error: null }`) and `WEIGHT_DELTA_TOO_LARGE` (return 422 with appropriate error code and message).

---

## Layer 4 — Admin Reversal Endpoint

- [ ] 7. Add `POST /:id/reverse-weight-correction` to `apps/api/src/routes/admin/deliveries.ts`: requires `surewaka_admin` role. Validates delivery is `failed` and has an `expired` or `declined` correction. Computes withheld amount (15% of original escrow). Credits customer wallet. Updates correction status to `reversed`. Writes `commission_reversal` ledger event. Returns 409 if already reversed.

- [ ] 8. Add `'reversed'` as a recognized status in the weight correction service comments/types. No DB migration needed (text column, no check constraint), but update any TypeScript type that enumerates correction statuses (if one exists in `@surewaka/shared`).

---

## Layer 5 — Tests

- [ ] 9. Create `apps/api/src/services/__tests__/weight-correction-guards.test.ts`: test `reportDiscrepancy` with mocked DB. Cases: (a) delta < 0.5kg → throws WITHIN_TOLERANCE; (b) reported > 3× declared → throws WEIGHT_DELTA_TOO_LARGE; (c) valid delta within bounds → proceeds normally (returns correction result); (d) exactly at boundary (0.5kg delta, 3× weight) → both should proceed (≥ 0.5 and ≤ 3×).

- [ ] 10. Create `apps/api/src/services/__tests__/weight-correction-frequency.test.ts`: test `checkDriverCorrectionFrequency`. Mock DB to return count of 6 corrections → assert alert row is inserted. Mock DB to return count of 3 → assert no alert inserted.

- [ ] 11. Create or extend `apps/api/src/__tests__/admin-weight-correction-reversal.test.ts`: test the admin reversal endpoint. Cases: (a) delivery not failed → 422; (b) no expired correction → 422; (c) happy path → 200 with refund amount; (d) already reversed → 409. Use `stubAuthModule(personas.admin())` from test-utils.

---

## Layer 6 — Verification

- [ ] 12. Verify all packages compile: `pnpm --filter @surewaka/shared exec tsc --noEmit` and `pnpm --filter @surewaka/api exec tsc --noEmit`.

- [ ] 13. Run full test suite: `pnpm test`. Fix any failures.

- [ ] 14. Update `docs/issues/pricing-grilling-outcomes.md`: mark the "Weight correction interim guards" task as complete.
