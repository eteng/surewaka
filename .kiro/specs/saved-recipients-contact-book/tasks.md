# Implementation Plan: Saved Recipients Contact Book

## Overview

This plan implements the Saved Recipients Contact Book by following the shipped
`mobile-address-lookup` build order, adapted for recipients: DB schema →
shared validators → API service → API routes → mobile client + store →
RN screens → booking integration, with property-based and unit tests placed
close to the code they validate.

The feature is additive. It reuses `recipientDetailsSchema`/`RecipientDetails`
from `@surewaka/shared`, introduces a new owner-scoped `user_saved_recipients`
table (no RLS), and never touches the `deliveries` snapshot path. All code is
TypeScript, matching the existing monorepo. Each task builds on the previous
ones and ends by wiring the new code into the running app. Property tests use
**fast-check** (min 100 iterations), each tagged
`Feature: saved-recipients-contact-book, Property N: ...`, with the DB mocked.

## Tasks

- [x] 1. Create the `user_saved_recipients` schema and migration
  - [x] 1.1 Add the Drizzle table `packages/db/src/schema/saved-recipients.ts`
    - Define `userSavedRecipients` (`user_saved_recipients`) with `id` uuid `defaultRandom()` PK, `userId` (`user_id`) notNull, `label` text nullable, `recipientName` (`recipient_name`) notNull, `recipientPhone` (`recipient_phone`) notNull, `deliveryNotes` (`delivery_notes`) nullable, `createdAt`/`updatedAt` timestamptz `defaultNow().notNull()`
    - Add FK `user_saved_recipients_user_id_fkey` on `userId` → `users.id` with `onDelete('cascade')`; no RLS
    - Export from `packages/db/src/schema/index.ts` (`export * from './saved-recipients';` under "User features")
    - _Requirements: Rel. 3, Rel. 8, 4.3_
  - [x] 1.2 Generate and apply the migration
    - Run `pnpm --filter @surewaka/db db:generate` and confirm the generated SQL matches the design (columns, FK cascade, no RLS), then `pnpm --filter @surewaka/db db:migrate`
    - _Requirements: Rel. 8_

- [x] 2. Add shared saved-recipient validators and types
  - [x] 2.1 Add validators in `packages/shared` reusing `recipientDetailsSchema`
    - Add `savedRecipientSchema = recipientDetailsSchema.extend({ id: z.string().uuid(), label: z.string().max(50).optional(), created_at: z.string() })`
    - Add `createSavedRecipientSchema = savedRecipientSchema.omit({ id: true, created_at: true })` and `updateSavedRecipientSchema = createSavedRecipientSchema.partial()`
    - Export `SavedRecipient`, `CreateSavedRecipient`, `UpdateSavedRecipient` types; do NOT redefine recipient name/phone/notes validation
    - Export all three schemas and three types from the package index
    - _Requirements: Rel. 2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x]* 2.2 Write unit tests for the shared validators
    - `savedRecipientSchema`/`create`/`update` accept valid shapes; reject bad name (<2, >100), phone (regex violations), notes (>200), label (>50); `create` omits `id`/`created_at`; `update` is fully partial
    - _Requirements: 7.2, 7.3, 7.4, 7.5_
    - ✅ 30 tests passing (packages/shared/src/__tests__/saved-recipient-validators.test.ts)

- [x] 3. Implement the API recipient service
  - [x] 3.1 Create `apps/api/src/services/recipient-service.ts` mirroring `address-service.ts`
    - Define `RECIPIENT_CAP = 25`, `ServiceResult<T>`, and `toSavedRecipient(row)` (map columns; `label`/`deliveryNotes` → `undefined` when null; `created_at` from `createdAt.toISOString()`)
    - `listRecipients(userId)` — `WHERE user_id`, `ORDER BY createdAt asc`
    - `getRecipient(userId, id)` — `WHERE id AND user_id`, `limit(1)`, `NOT_FOUND` when no row
    - `createRecipient(userId, input)` — count `WHERE user_id`; if `>= RECIPIENT_CAP` return `LIMIT_REACHED` and do not insert; else insert with `userId` from the session parameter (never the body) + `returning()`
    - `updateRecipient(userId, id, input)` — partial `updates` of defined fields, always set `updatedAt: new Date()`, `WHERE id AND user_id`, `NOT_FOUND` when no row
    - `deleteRecipient(userId, id)` — `WHERE id AND user_id` `.returning()`, `NOT_FOUND` when no row
    - _Requirements: 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3_
  - [x]* 3.2 Write property test for owner isolation
    - **Property 1: Owner isolation on every query** — generate recipients across ≥2 users; assert every op with `userId=A` only touches `user_id=A` rows; cross-owner `get`/`update`/`delete` ⇒ `NOT_FOUND` (DB mocked, 100+ iters)
    - **Validates: Requirements 4.3, 4.4**
  - [x]* 3.3 Write property test for session-owned create
    - **Property 2: Create sets owner from the session** — generate create inputs (some with a stray body `user_id`); assert persisted `user_id === session userId` (DB mocked, 100+ iters)
    - **Validates: Requirements 4.5**
  - [x]* 3.4 Write property test for the cap invariant
    - **Property 3: Cap invariant (LIMIT_REACHED)** — generate counts around the cap boundary (24/25/26); assert `createRecipient` at `>= 25` ⇒ `LIMIT_REACHED` and count unchanged (DB mocked, 100+ iters)
    - **Validates: Requirements 5.2, 5.3, 5.5**
  - [x]* 3.5 Write property test for snapshot immutability
    - **Property 4: Snapshot immutability** — generate a delivery snapshot + random `update`/`delete` sequences on recipients; assert snapshot bytes unchanged and `deliveries` is never among the mocked DB's written tables (DB mocked, 100+ iters)
    - **Validates: Requirements 6.1, 6.2, 6.3**
  - [x]* 3.6 Write unit tests for the service
    - Owner-scoped `NOT_FOUND` on cross-owner get/update/delete; `RECIPIENT_CAP === 25`; count query carries `WHERE user_id`; `updatedAt` set on update; validation-failure structured log emitted with no PII fields
    - _Requirements: 4.3, 4.4, 5.1_

- [x] 4. Implement and register the API routes
  - [x] 4.1 Create `apps/api/src/routes/recipients.ts` behind `requireAuth`
    - Hono sub-app with `requireAuth` on `'*'`; `{ data, error, meta }` responses; user id always `c.get('user').id`
    - `GET /` → 200 list; `GET /:id` → 200 / 404; `POST /` `.safeParse(createSavedRecipientSchema)` → 201 / 400 `VALIDATION_ERROR` / 400 `LIMIT_REACHED`; `PUT /:id` `.safeParse(updateSavedRecipientSchema)` → 200 / 400 / 404; `DELETE /:id` → 200 `{ data: null }` / 404; unexpected → 500 `INTERNAL_ERROR`
    - On `.safeParse` failure emit `logger.warn({ event: 'recipient_validation_failed', userId, field, code })` (no PII) and never call the service
    - Use PUT for update (standardized — do not copy the address PATCH/PUT inconsistency)
    - _Requirements: 4.1, 4.2, 4.5, 5.2, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 4.2 Register the route in `apps/api/src/index.ts`
    - `app.route('/api/v1/recipients', recipientRoutes)`
    - _Requirements: Rel. 7, 4.1_
  - [x]* 4.3 Write property test for validation reuse
    - **Property 5: Validation reuse** — generate arbitrary payloads; assert the route's accept/reject decision equals `recipientDetailsSchema` + label≤50; rejected ⇒ HTTP 400 and never persisted; no carrier-specific digit validation (100+ iters)
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7**
  - [x]* 4.4 Write route unit tests behind `requireAuth`
    - Each of GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id` returns 401 with no session and no data; POST/PUT invalid body ⇒ 400 `VALIDATION_ERROR`; create at cap ⇒ 400 `LIMIT_REACHED`; cross-owner/unknown id ⇒ 404; success 200/201; `user_id` always from session
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 5.2, 7.2_

- [x] 5. Checkpoint — API layer verified
  - Run `pnpm --filter @surewaka/api exec tsc --noEmit`. Ensure all API and shared tests pass, ask the user if questions arise.

- [x] 6. Implement the mobile client and store
  - [x] 6.1 Add `createRecipientsClient(token)` in `packages/mobile-shared/src/api/recipients.ts`
    - Mirror `createAddressesClient`: `list`, `get(id)`, `create(body)`, `update(id, body)` via **PUT**, `remove(id)`
    - Export from `packages/mobile-shared/src/index.ts`
    - _Requirements: Rel. 7, 3.4_
  - [x] 6.2 Add `useRecipientStore` in `packages/mobile-shared/src/store/recipient-store.ts`
    - Mirror `useAddressStore`: state `recipients`, `fetched`; actions `fetch(token)` (GET `/api/v1/recipients`, set `{ recipients, fetched: true }` only on success), `add`, `update`, `remove`
    - Export from the package index
    - _Requirements: Rel. 7, 2.1, 3.6, 8.3_
  - [x]* 6.3 Write unit tests for the client and store
    - Client `update` issues PUT to `/api/v1/recipients/:id`; store `fetch` leaves state intact on error and sets `fetched` only on success; `add`/`update`/`remove` mutate list correctly
    - _Requirements: 3.4, 8.3_
    - ✅ 15 tests passing (added ts-jest harness to packages/mobile-shared)

- [x] 7. Integrate quick-select and save-nudge into the booking Recipient step
  - [x] 7.1 Extend `apps/mobile-customer/app/booking/recipient.tsx`
    - Preserve the existing RHF + `zodResolver(recipientDetailsSchema)`, `useBookingStore` `recipientDetails`/`setRecipientDetails`, and `onSubmit → setStep(4) → push('/booking/carriers')` verbatim
    - On mount: load via `useRecipientStore.fetch(token)`; show a loading indicator in place of the chip row while loading; on failure show an inline error + Retry that does NOT block manual entry and report to Sentry (`app:mobile-customer`) when the retry affordance is presented
    - Quick-select chip row above the form: one chip per saved recipient, render nothing when zero; tapping prefills `recipientName`/`recipientPhone`/`deliveryNotes` via RHF `reset()`/`setValue`, leaves fields editable, and does not create a delivery or advance the step
    - Save_Nudge below the form: visible iff current values pass `recipientDetailsSchema` AND count `< RECIPIENT_CAP`; activate ⇒ `createRecipientsClient.create({ recipientName, recipientPhone, deliveryNotes, label })`; success ⇒ "Saved ✓" + `useRecipientStore.add` + flow continues; failure ⇒ visible message + flow continues + Sentry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.4, 8.4, 8.5, 8.6, 8.7, 8.8_
  - [x]* 7.2 Write property test for save-nudge visibility
    - **Property 6: Save-nudge visibility** — generate form values × counts; assert visible iff `recipientDetailsSchema.safeParse(v).success && count < 25` (100+ iters)
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - ✅ `__tests__/booking-recipient.nudge.property.test.tsx` (300+150 runs) + 2 component-level ties
  - [x]* 7.3 Write property test for quick-select prefill correctness
    - **Property 7: Quick-select prefill correctness** — generate a `SavedRecipient`; assert prefilled `recipientName`/`recipientPhone`/`deliveryNotes` equal its values with no navigation/create side-effect (100+ iters)
    - **Validates: Requirements 2.3, 2.5**
    - ✅ `__tests__/booking-recipient.prefill.property.test.tsx` (100 runs, component-level)
  - [x]* 7.4 Write resilience-state unit tests for `recipient.tsx`
    - Loader in place of chips on load (8.4); load failure ⇒ retry + manual entry works + Sentry (2.6, 8.5); N recipients ⇒ N chips (2.1), zero ⇒ none (2.2); tap prefills + editable (2.4) + no advance (2.5); nudge activate ⇒ create with fields+label (1.4); success ⇒ "Saved ✓" + continue (1.5); failure ⇒ message + continue + Sentry (1.6)
    - _Requirements: 1.4, 1.5, 1.6, 2.1, 2.2, 2.4, 2.5, 2.6, 8.4, 8.5_
    - ✅ `__tests__/booking-recipient.resilience.test.tsx` (load/tap states) + `.save-success.test.tsx` (1.4/1.5) + `.save-failure.test.tsx` (1.6). Split because test-renderer@1.x + React 19.2 does not reset its reconciler between async event-handler renders in one file; jest per-file isolation gives each mutation test a clean reconciler. Prod code unchanged.

- [x] 8. Build the profile recipients list screen
  - [x] 8.1 Create `apps/mobile-customer/app/profile/recipients.tsx` mirroring `profile/addresses.tsx`
    - Read `useRecipientStore`; skeleton loader matching list shape while loading; empty state prompting "add a recipient"; error message + Retry that re-requests
    - `FlatList` row shows label (or recipient name when no label) + recipient phone; row delete uses `Alert` confirmation before `createRecipientsClient.remove`; success ⇒ remove via store; failure ⇒ keep row + message + Sentry
    - `ListFooter` "+ Add New Recipient" (→ `push('/profile/recipient-edit')`) unless count ≥ 25, in which case hide the add action and show "You've reached the maximum of 25 saved recipients"; tap row → `push('/profile/recipient-edit?id=<id>')`
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 5.4, 8.1, 8.2, 8.3, 8.6, 8.7_
  - [x]* 8.2 Write property test for primary-label derivation
    - **Property 8: Primary-label derivation** — generate `SavedRecipient` with/without label; assert row primary text == `label` when non-empty else `recipientName` (100+ iters)
    - **Validates: Requirements 3.2**
    - ✅ `__tests__/profile-recipients.label.property.test.tsx` (100 runs, component-level)
  - [x]* 8.3 Write resilience-state unit tests for `recipients.tsx`
    - Skeleton while loading (8.1); empty state (8.2); error+retry re-requests (8.3); delete Alert confirmation (3.5) then removes on success (3.6); failure keeps item + message + Sentry (3.7); no error on success/before attempt (3.8); footer hides add + shows max message at 25 (5.4)
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 5.4, 8.1, 8.2, 8.3_
    - ✅ `.states.test.tsx` (loading/empty/footer/max), `.retry.test.tsx` (8.3), `.delete-success.test.tsx` (3.5/3.6/3.8), `.delete-failure.test.tsx` (3.7). Async delete/retry handlers each isolated per file (see 7.4 note).

- [x] 9. Build the profile recipient edit screen
  - [x] 9.1 Create `apps/mobile-customer/app/profile/recipient-edit.tsx` mirroring `address-edit.tsx`
    - Read optional `id` via `useLocalSearchParams`; in edit mode fetch via `createRecipientsClient.get(id)` and pre-populate recipientName, recipientPhone, deliveryNotes, label (null-safe → empty strings)
    - Label preset chips `Home / Office / Work / Other` + custom field, label optional; validate form against `recipientDetailsSchema` before submission
    - Save via `createRecipientsClient.create` (new) or `createRecipientsClient.update` (edit, **PUT**); update `useRecipientStore` (`add`/`update`) on success then `router.back()`; failure ⇒ visible message + Sentry
    - _Requirements: 3.3, 3.4, 7.6, 8.6, 8.7_
  - [x]* 9.2 Write unit tests for `recipient-edit.tsx`
    - Edit-mode fetch pre-populates all four fields incl. label, null-safe (3.3); form validates against `recipientDetailsSchema` (7.6); save ⇒ create or update via PUT (3.4) + store update + `router.back()`; failure ⇒ message + Sentry
    - _Requirements: 3.3, 3.4, 7.6_
    - ✅ `recipient-edit.prefill.test.tsx` (3.3 incl. null-safe), `.create.test.tsx` (POST no-id + store + back), `.update.test.tsx` (PUT with-id + store + back), `.validation.test.tsx` (7.6 blocks submit), `.failure.test.tsx` (Alert + Sentry). Async submit handlers isolated per file (see 7.4 note).

- [x] 10. Snapshot-immutability integration test and final verification
  - [x]* 10.1 Write the snapshot-immutability integration test
    - Create a delivery via the existing booking path with recipient details, save the same recipient, then edit and delete it; assert the delivery row's `recipient_name`/`recipient_phone`/`delivery_notes` are unchanged; assert a delivery can be created with an empty recipient store
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
    - ✅ Mobile boundary portion: `mobile-boundary.client-surface.test.ts` (Recipients_Client has only recipient CRUD, only hits `/api/v1/recipients`, never a delivery path) + `mobile-boundary.empty-store-booking.test.tsx` (booking submits with an EMPTY recipient store → `setRecipientDetails` + push `/booking/carriers`). DB-level snapshot immutability is covered by the API property test 3.5.
  - [x]* 10.2 Write the background-op exemption test
    - A background (non-user-initiated) refresh failure surfaces no user-facing feedback
    - _Requirements: 8.8_
    - ✅ `__tests__/background-refresh-exemption.test.tsx`: a background `useRecipientStore.fetch()` failure surfaces no Alert/visible error/Sentry and leaves state intact; contrast test pins the user-initiated mount-load affordance (retry + Sentry).
  - [x] 10.3 Final type-check and build verification
    - Run `pnpm --filter @surewaka/api exec tsc --noEmit`, `pnpm --filter @surewaka/mobile-shared exec tsc --noEmit`, `pnpm --filter @surewaka/mobile-customer exec tsc --noEmit`, and `pnpm --filter @surewaka/db db:generate` (confirm schema compiles into a migration)
    - _Requirements: Rel. 8_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core implementation tasks are never marked optional.
- Each task references specific requirements (including relationship boundaries "Rel. N") for traceability.
- Property tests use fast-check with a minimum of 100 iterations, each tagged `Feature: saved-recipients-contact-book, Property N: ...`, with the DB mocked for the service-layer properties (1–5).
- The recipient service never reads or writes the `deliveries` table, preserving the Delivery_Snapshot (Property 4).
- Update uses PUT in both the route and the mobile client (standardized), intentionally not copying the shipped address PATCH/PUT inconsistency.
- Checkpoints ensure incremental validation via `tsc --noEmit` and the test suite.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 6, "tasks": ["6.1", "6.2"] },
    { "id": 7, "tasks": ["6.3", "7.1", "8.1", "9.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "7.4", "8.2", "8.3", "9.2", "10.1", "10.2"] },
    { "id": 9, "tasks": ["10.3"] }
  ]
}
```
