# Booking Address Resilience Bugfix Design

## Overview

The booking pickup (`apps/mobile-customer/app/booking/pickup.tsx`) and dropoff
(`apps/mobile-customer/app/booking/dropoff.tsx`) screens silently swallow every failure from the
addresses client and lack the async states required by `.kiro/steering/frontend-resilience.md` §2/§4.
Four confirmed defects exist in near-identical form on both screens:

1. The on-mount `client.list()` / `client.listRecent()` loads guard only on `if (r.data)`, so an
   in-flight load shows nothing and an error/rejection leaves the saved-address chip row and the
   Recent/Saved search sections silently empty — no loading, no error, no retry.
2. `handleSaveNudge` awaits `client.create(...)` and acts only in the `if (!result.error)` success
   branch, so a failed save gives the user no feedback and reports nothing.
3. `handleConfirm` fires `client.upsertRecent(...)` fully unhandled (no `.then`, no `.catch`), so a
   rejection becomes an unhandled promise rejection.
4. There is no Sentry reporting anywhere in these screens.

The fix is **minimal and additive**: no API/server changes, no new packages, no schema changes. It
introduces a small load-state model plus a `reload` callback, lightweight loading and error+retry
affordances scoped to the two small UI regions, a failure branch on the save-nudge, and a caught
(but still non-blocking) `upsertRecent` write — all reporting to Sentry via the already-initialized
`@sentry/react-native`. Because the two screens are structurally identical in the affected areas, the
fix is centralized in a new shared hook `useSavedAddresses(token)` in `packages/mobile-shared` so the
data/async logic is written and tested once, with each screen supplying its own small presentation
and route context.

The happy path — chips, search sections, save-nudge confirmation, background recent write, and
navigation — is preserved exactly, and the fire-and-forget (non-blocking) semantics of `upsertRecent`
are kept; only its rejection is caught and reported.

## Glossary

- **Bug_Condition (C)**: An input `X` (address-client call outcome plus async timing) for which the
  current screens give no feedback or produce an unhandled rejection — a load is in flight, a
  `list`/`listRecent`/`create` call resolves with a non-null `error` or rejects, or an `upsertRecent`
  call rejects/errors.
- **Property (P)**: The correct behavior for a bug input — a loading affordance while in flight, an
  error affordance with a working Retry for load failures, a visible message for save-nudge failures,
  and a caught+reported (silent, non-blocking) `upsertRecent` rejection.
- **Preservation**: Existing behavior that must not change for non-bug inputs — successful chip/search
  population, the "Saved as {label}" confirmation and append, the non-blocking recent write and
  navigation, plus the untouched LocationIQ `searchAddress`, map `reverseGeocode`, and profile
  addresses screen.
- **addrLoadState**: New per-screen (hook-owned) state `'loading' | 'error' | 'ready'` describing the
  combined saved/recent on-mount load.
- **reloadAddresses / reload**: New callback that re-runs `client.list()` + `client.listRecent()`,
  used on mount and by the Retry control.
- **useSavedAddresses(token)**: New shared hook in `packages/mobile-shared/src/hooks/` that owns
  `savedAddresses`, `recentLocations`, `state`, `reload`, and `addSaved`, encapsulating the load
  resilience logic for both screens.
- **client**: The object from `createAddressesClient(token)` exposing `list`, `listRecent`, `create`,
  and `upsertRecent`, each returning `{ data, error }`.
- **Sentry**: `@sentry/react-native`, already initialized in `apps/mobile-customer/app/_layout.tsx`;
  the app and `packages/mobile-shared` both declare it as a dependency.

## Bug Details

### Bug Condition

The bug manifests whenever the outcome of an addresses-client call on either screen falls outside the
narrow success path the current code handles. For the on-mount load, the `client.list()` /
`client.listRecent()` calls are either in flight (no state rendered) or resolve with a non-null
`error` / reject (guarded away by `if (r.data)`). For the save nudge, `client.create(...)` resolves
with a non-null `error` or rejects (no `else` branch). For the background recent write,
`client.upsertRecent(...)` rejects or resolves with an error while completely unhandled.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type AddressClientOutcome
         { op: 'list' | 'listRecent' | 'create' | 'upsertRecent',
           phase: IN_FLIGHT | SETTLED,
           result: { data, error } | REJECTED }
  OUTPUT: boolean

  // Load ops: in-flight (no state) or failed/rejected are all buggy today.
  IF input.op IN ['list', 'listRecent'] THEN
    RETURN input.phase = IN_FLIGHT
        OR input.result IS REJECTED
        OR input.result.error IS NOT NULL
  END IF

  // Save-nudge: only the failure/rejection outcome is buggy.
  IF input.op = 'create' THEN
    RETURN input.result IS REJECTED
        OR input.result.error IS NOT NULL
  END IF

  // Background recent write: rejection/error is buggy (unhandled today).
  IF input.op = 'upsertRecent' THEN
    RETURN input.result IS REJECTED
        OR input.result.error IS NOT NULL
  END IF

  RETURN false
END FUNCTION
```

### Examples

- **List in flight (Req 2.1)**: On screen mount with a slow network, `client.list()` has not resolved
  yet. Expected: a loading affordance in the saved-address region. Actual: nothing renders — the chip
  row is gated on `savedAddresses.length > 0`, which is `0`.
- **List error (Req 2.2)**: `client.list()` resolves `{ data: null, error: {...} }` (e.g. 500).
  Expected: an inline error with a Retry that re-runs the load, plus a Sentry report. Actual:
  `if (r.data)` is false, so `savedAddresses` stays `[]` silently and nothing is reported.
- **listRecent error (Req 2.4)**: `client.listRecent()` rejects. Expected: error+retry affordance for
  the Recent section, plus Sentry. Actual: the rejection is swallowed by the bare `.then`, Recent
  stays empty silently.
- **Save-nudge failure (Req 2.5)**: User taps "Home"; `client.create(...)` resolves with an `error`.
  Expected: a visible "Couldn't save" message and a Sentry report. Actual: the `if (!result.error)`
  block is skipped and nothing happens — no confirmation, no error, no report.
- **upsertRecent rejection (Req 2.6)**: On Confirm, `client.upsertRecent(...)` rejects. Expected: the
  rejection is caught and reported to Sentry, navigation still proceeds, user sees nothing. Actual:
  unhandled promise rejection; navigation proceeds but the error is lost.
- **Edge — retry succeeds (Req 2.7)**: After a failed load, the user taps Retry and the retried call
  succeeds. Expected: error affordance clears and data renders. Actual: no retry affordance exists.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Successful `client.list()` loads SHALL still populate the saved-address chip row and the Saved
  search section exactly as today (Req 3.1).
- Successful `client.listRecent()` loads SHALL still populate the Recent search section exactly as
  today (Req 3.2).
- A successful save-nudge SHALL still set the "Saved as {label}" confirmation and append the new
  address to `savedAddresses` (Req 3.3).
- `handleConfirm` SHALL still set pickup/dropoff in the booking store, advance the step, fire
  `client.upsertRecent(...)` as a non-blocking background write, and navigate without awaiting or
  blocking on that write (Req 3.4).
- The LocationIQ `searchAddress` autocomplete path (its own try/catch), the map `reverseGeocode` /
  map-press selection path, and the profile addresses screen SHALL remain byte-for-byte unchanged
  (Req 3.5, 3.6, 3.7).

**Scope:**
All inputs that are NOT bug inputs (per `isBugCondition`) SHALL be completely unaffected by this fix.
This includes:
- Successful load, create, and recent-write outcomes.
- The LocationIQ autocomplete search flow and its `searching` spinner.
- The map interactions (`handleMapPress`, `reverseGeocode`) and the initial device-location flow that
  drives the existing full-screen `loading` gate.
- Any behavior on the profile addresses screen (`apps/mobile-customer/app/profile/addresses.tsx`).

**Note:** The correct behavior for bug inputs is defined in the Correctness Properties section
(Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the confirmed code, the defects are not incidental — they are structural omissions repeated
identically in both screens:

1. **Success-only load guard**: The on-mount effect uses `client.list().then((r) => { if (r.data)
   setSavedAddresses(r.data); })` (and the same for `listRecent`). There is no state variable for
   loading or error, and the `error` branch of `{ data, error }` is never read, so both the in-flight
   and failure cases produce an empty, silent UI. The chip row and search sections are gated purely on
   array length, so "empty because loading", "empty because error", and "genuinely empty" are
   indistinguishable.

2. **Success-only save handler**: `handleSaveNudge` has only an `if (!result.error)` branch and no
   `else`, and it is not wrapped in try/catch, so both an `error` result and a thrown rejection leave
   the user with no feedback.

3. **Unhandled fire-and-forget write**: `handleConfirm` calls `client.upsertRecent(...)` with no
   `.then`/`.catch`. The intent (non-blocking background write) is correct, but the missing `.catch`
   turns any rejection into an unhandled promise rejection.

4. **No Sentry instrumentation**: Unlike sibling screens (`weight-correction.tsx`, `register.tsx`)
   these screens never call `Sentry.captureException`, so none of the above failures are reported.

Root cause summary: the screens were written for the happy path only, and because pickup and dropoff
were copy-pasted, the same four omissions exist in both. Centralizing the load logic in a shared hook
addresses the largest duplicated defect once.

## Correctness Properties

Property 1: Bug Condition - Address Resilience And Reporting

_For any_ addresses-client outcome where the bug condition holds (`isBugCondition` returns true), the
fixed screens SHALL:
- for an in-flight `list`/`listRecent` load, show a loading affordance in the corresponding UI region
  (saved-address chip area and/or Recent/Saved search section);
- for a failed/rejected `list`/`listRecent` load, show an inline error affordance with a Retry control
  that re-triggers the same load, and report the failure to Sentry via `captureException` tagged
  `app:mobile-customer` with route context;
- for a failed/rejected `create` (save nudge), surface a visible failure message to the user and
  report to Sentry tagged `app:mobile-customer` with route context;
- for a rejected/errored `upsertRecent`, catch the rejection (no unhandled promise rejection) and
  report to Sentry tagged `app:mobile-customer` with route context, WITHOUT surfacing an error to the
  user and WITHOUT blocking navigation;
- and, when a Retry for a failed load succeeds, clear the error affordance and render the loaded data.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation - Happy Path And Out-Of-Scope Paths Unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed code
SHALL produce the same result as the original function, preserving successful chip/search population,
the "Saved as {label}" confirmation and append, the non-blocking recent write and navigation, and the
untouched LocationIQ `searchAddress`, map `reverseGeocode`/map-press, and profile addresses screen
behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Shared-hook approach (recommended)

Because pickup and dropoff are near-identical in every affected area, the load resilience logic is
extracted into a new shared hook rather than duplicated. This is consistent with existing convention
(`useLocation`, `useQuoteExpiry`, `usePushNotifications` all live in
`packages/mobile-shared/src/hooks/` and are re-exported from the barrel), and `@sentry/react-native`
is already an (optional) peer dependency of `packages/mobile-shared`, so the hook can report the load
failures itself.

**Justification:** the single largest defect (the load state model + retry + Sentry) is identical on
both screens; writing it once removes the risk of the two screens drifting and lets the property-based
and unit tests target one implementation. The save-nudge failure branch and the `upsertRecent`
`.catch` are small, screen-local edits that touch screen-specific UI/state (`savedLabel`, the nudge
row, `handleConfirm` navigation) and stay in each screen, but they call into the hook's `addSaved`
helper to keep `savedAddresses` mutation centralized. If, during implementation, the shared hook is
found to add integration risk (e.g. token-timing differences), the fallback is to apply the identical
fix inline in both screens symmetrically; the properties and tests below apply equally to either
layout.

**New file**: `packages/mobile-shared/src/hooks/use-saved-addresses.ts` (exported from
`packages/mobile-shared/src/index.ts`).

```
export type AddrLoadState = 'loading' | 'error' | 'ready';

useSavedAddresses(token: string, route: string) returns {
  savedAddresses:  SavedAddress[];
  recentLocations: RecentLocation[];
  state:           AddrLoadState;   // 'loading' until first settle
  reload:          () => void;       // re-runs list() + listRecent()
  addSaved:        (addr: SavedAddress) => void; // append after successful create
}
```

Hook behavior:
- Holds `savedAddresses`, `recentLocations`, and `state`.
- `reload()` sets `state = 'loading'`, runs `client.list()` and `client.listRecent()` together
  (`Promise.all`), and on settle: if either result has a non-null `error` or the combined promise
  rejects, set `state = 'error'` and call `Sentry.captureException(...)` once, tagged
  `app:mobile-customer` with `extra: { route, op: 'load' }`; otherwise populate both arrays and set
  `state = 'ready'`. Sentry is invoked at the point the error state (and thus the retry affordance) is
  presented, per Req 2.2/2.4.
- Runs `reload()` in a `useEffect` keyed on `token` when `token` is non-empty (preserving today's
  `if (!token) return;` gate), so the happy path timing is unchanged (Req 3.1, 3.2).
- `addSaved(addr)` appends to `savedAddresses` (used by the screen's save-nudge success branch to
  preserve Req 3.3).

### Screen changes (pickup.tsx and dropoff.tsx, symmetric)

**File**: `apps/mobile-customer/app/booking/pickup.tsx`
**File**: `apps/mobile-customer/app/booking/dropoff.tsx`

1. **Adopt the hook**: Replace the local `savedAddresses` / `recentLocations` `useState` + the
   on-mount `useEffect` that calls `client.list()`/`client.listRecent()` with
   `const { savedAddresses, recentLocations, state: addrLoadState, reload, addSaved } =
   useSavedAddresses(token, 'booking/pickup');` (route `'booking/dropoff'` on the other screen). The
   `if (!token) return;` gate moves into the hook.

2. **Loading affordance (Req 2.1, 2.3)**: While `addrLoadState === 'loading'`, render a lightweight
   loading placeholder in place of the saved-address chip row (a short `animate-pulse` row of muted
   pill-shaped blocks matching the chip shape), and, when the search panel is open (`showEmptySearch`),
   a matching muted placeholder row under a "Recent"/"Saved" header. Kept proportional to these small
   regions rather than a full-screen skeleton. The device-location full-screen `loading` gate is
   unchanged and unrelated.

3. **Error + retry affordance (Req 2.2, 2.4, 2.7)**: While `addrLoadState === 'error'`, render a small
   inline error affordance (icon + short message such as "Couldn't load your addresses") with a
   `Retry` control whose `onPress` calls `reload()`. On successful retry the hook flips `state` to
   `'ready'`, which clears the affordance and renders the data (Req 2.7). The error affordance sits in
   the same small region as the chips/search sections and must NOT cover or disable the search
   `TextInput` or the map, so manual search and map selection keep working (preservation).

4. **Save-nudge failure branch (Req 2.5, 3.3)**: Wrap `handleSaveNudge` in try/catch and add the
   missing failure handling:
   ```
   try {
     const result = await client.create({...});
     if (!result.error) {
       setSavedLabel(nudgeLabel);
       addSaved(result.data!);          // preserves Req 3.3
     } else {
       setSaveError("Couldn't save — try again");   // visible inline message near the nudge row
       Sentry.captureException(
         result.error instanceof Error ? result.error : new Error(JSON.stringify(result.error)),
         { tags: { app: 'mobile-customer', screen: 'booking/pickup' }, extra: { op: 'create' } },
       );
     }
   } catch (e) {
     setSaveError("Couldn't save — try again");
     Sentry.captureException(e, { tags: { app: 'mobile-customer', screen: 'booking/pickup' }, extra: { op: 'create' } });
   }
   ```
   A small `saveError` state renders a red inline message adjacent to the save-nudge pills (consistent
   with the app's inline-error style); it clears when a new address is selected (the existing
   `setSavedLabel(null)` reset points). The success path is untouched (Req 3.3).

5. **upsertRecent rejection handling (Req 2.6, 3.4)**: Attach a `.catch` to the fire-and-forget call
   WITHOUT awaiting it, so navigation still fires synchronously right after:
   ```
   client
     .upsertRecent({...})
     .catch((e) => Sentry.captureException(e, {
       tags: { app: 'mobile-customer', screen: 'booking/pickup' },
       extra: { op: 'upsertRecent' },
     }));

   router.push('/booking/dropoff');   // unchanged, still synchronous, not awaited
   ```
   No `await`, no user-facing surface — the write stays a silent background write (Req 2.6), and the
   store update / step advance / navigation are unchanged (Req 3.4).

### Out of scope (explicit scope guard)

The following are explicitly NOT changed by this fix:
- The profile addresses screen `apps/mobile-customer/app/profile/addresses.tsx` (already resilient).
- The LocationIQ `searchAddress` autocomplete path (already wrapped in try/catch) and the `searching`
  spinner.
- The map `reverseGeocode` path, `handleMapPress`, and the device-location full-screen `loading` gate.
- The fire-and-forget semantics of `upsertRecent` — preserved; only its rejection is caught/reported.
- Any API, server, schema, or package additions.

## Components/Interfaces Touched

| Component / Interface | Change | Requirements |
|-----------------------|--------|--------------|
| `packages/mobile-shared/src/hooks/use-saved-addresses.ts` (new) | Owns load state, `reload`, Sentry-on-error, `addSaved` | 2.1–2.4, 2.7, 3.1, 3.2 |
| `packages/mobile-shared/src/index.ts` | Add `export { useSavedAddresses }` and `AddrLoadState` type | — |
| `apps/mobile-customer/app/booking/pickup.tsx` | Adopt hook; add loading/error+retry UI; save-nudge failure branch; `upsertRecent` `.catch`; import Sentry | 2.1–2.7, 3.1, 3.3, 3.4 |
| `apps/mobile-customer/app/booking/dropoff.tsx` | Same changes as pickup, symmetric (route `booking/dropoff`) | 2.1–2.7, 3.1, 3.3, 3.4 |

No changes to `createAddressesClient`, the API, the DB schema, or `@surewaka/shared` types.

## Error Handling

All mobile error reporting uses `@sentry/react-native` (already initialized in
`apps/mobile-customer/app/_layout.tsx`): `Sentry.captureException(error, { tags: { app:
'mobile-customer', screen: '<route>' }, extra: { op } })`, matching the existing pattern in
`weight-correction.tsx` and `register.tsx`. `extra` carries the route/op only — never PII (no address
text, city, or coordinates). Non-`Error` `{ data, error }` values are wrapped in an `Error` before
capture (as `register.tsx` does).

| Failure point | Detection | User-facing behavior | Sentry / logging | Requirements |
|---------------|-----------|----------------------|------------------|--------------|
| `list`/`listRecent` in flight | `state === 'loading'` | Loading placeholder in chip row / search section | none | 2.1, 2.3 |
| `list`/`listRecent` error or rejection | non-null `error` or `Promise.all` rejects | Inline error + Retry (`reload()`); does not block search/map | `captureException` tag `app:mobile-customer`, `op:'load'`, route | 2.2, 2.4 |
| Retry succeeds | retried load resolves clean | Error clears, data renders | none | 2.7 |
| Save-nudge `create` error or rejection | non-null `error` or thrown | Visible inline "Couldn't save — try again" near nudge | `captureException` tag `app:mobile-customer`, `op:'create'`, route | 2.5 |
| `upsertRecent` rejection or error | `.catch` on the fire-and-forget promise | none (silent background write) | `captureException` tag `app:mobile-customer`, `op:'upsertRecent'`, route | 2.6 |

## Sentry

- Import `import * as Sentry from '@sentry/react-native';` in both screens (and in the shared hook,
  where it is an optional peer dependency of `packages/mobile-shared`).
- No re-initialization: `Sentry.init(...)` already runs once in `_layout.tsx`; these changes only call
  `captureException`.
- Every capture is tagged `app: 'mobile-customer'` and includes the screen/route (`booking/pickup` or
  `booking/dropoff`) plus an `op` discriminator (`load` | `create` | `upsertRecent`).
- No PII in `extra`: never include `address_text`, `city`, `state`, `lat`, or `lng` values — only the
  route, operation name, and (for `create`) the wrapped error.
- The load failure is reported once per failed load (at the moment the error state / retry affordance
  is presented), not per individual `list`/`listRecent` call, to avoid duplicate noise.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each defect on the UNFIXED code, confirming
the root-cause analysis; then verify the fix satisfies the fix-checking properties and preserves the
happy path and out-of-scope paths. The addresses client is mocked to return controlled `{ data, error }`
outcomes and rejections; Sentry's `captureException` is spied; navigation (`router.push`) and the
booking store setters are spied. Component behavior is exercised with the RN Testing Library; the
preservation property is exercised with fast-check over generated client outcomes.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each defect BEFORE implementing the fix, confirming
or refuting the root-cause analysis. If refuted, re-hypothesize.

**Test Plan**: Render each screen with a mocked addresses client and drive each bug input, asserting
the (currently missing) correct behavior so the tests fail on unfixed code.

**Test Cases**:
1. **List in-flight** — mount with `list()` unresolved; assert a loading affordance is present (fails
   on unfixed code — nothing renders).
2. **List error** — `list()` resolves `{ data: null, error }`; assert an error+Retry affordance and a
   `captureException` call (fails on unfixed code — silent empty, no report).
3. **listRecent rejection** — `listRecent()` rejects; assert Recent-section error+Retry and a
   `captureException` (fails on unfixed code — swallowed).
4. **Save-nudge failure** — tap a label with `create()` resolving `{ error }`; assert a visible
   message and a `captureException` (fails on unfixed code — no-op).
5. **upsertRecent rejection** — Confirm with `upsertRecent()` rejecting; assert no unhandled rejection
   and a `captureException`, and that `router.push` was still called synchronously (fails on unfixed
   code — unhandled rejection, no report).

**Expected Counterexamples**:
- Load: no loading state; on error, empty UI with no retry and no Sentry call.
- Save nudge: no message, no Sentry call.
- upsertRecent: unhandled promise rejection, no Sentry call.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the
expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := renderAndDrive_fixed(input)
  ASSERT expectedBehavior(result)   // loading OR (error+retry+sentry) OR
                                     // (save message+sentry) OR
                                     // (caught+sentry+silent+nav-not-blocked)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the
same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT screen_original(input) = screen_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because it
generates many client outcomes automatically across the input domain, catches edge cases manual tests
miss, and gives strong assurance that non-bug behavior is unchanged.

**Test Plan**: Observe the happy-path behavior on UNFIXED code first (successful chip/search
population, "Saved as {label}" + append, non-blocking recent write + navigation), then encode
property-based tests that assert the fixed screen matches for all non-bug inputs.

**Test Cases**:
1. **Successful load preservation** — generate successful `list`/`listRecent` data; assert chip row
   and Recent/Saved sections render identically to unfixed behavior (Req 3.1, 3.2).
2. **Save-nudge success preservation** — `create()` succeeds; assert "Saved as {label}" and the
   `savedAddresses` append are unchanged, with no error message and no Sentry call (Req 3.3).
3. **Confirm preservation** — valid selected location; assert store setter, step advance, non-blocking
   `upsertRecent` fire, and `router.push` all occur as before, with navigation not awaiting the write
   (Req 3.4).
4. **Out-of-scope preservation** — assert `searchAddress` autocomplete, `reverseGeocode`/map-press, and
   the profile addresses screen are untouched (Req 3.5, 3.6, 3.7).

### Unit Tests

- Hook `reload()`: loading→ready on success (populates both arrays); loading→error + single
  `captureException` on either `error` result or a rejection; Retry path re-runs and recovers to ready.
- Save-nudge: success branch sets label + appends; failure/`error` branch shows message + captures;
  thrown rejection is caught, shows message + captures.
- `handleConfirm`: `upsertRecent` rejection is caught + captured, no user surface, and `router.push`
  is called synchronously (assert call order: navigation not blocked).
- Assert no unhandled promise rejection is emitted for any failure path.

### Property-Based Tests

- Generate arbitrary `{ data, error }` / rejection outcomes for `list`, `listRecent`, `create`,
  `upsertRecent`; for bug inputs assert the matching Property-1 behavior; for non-bug inputs assert
  Property-2 equivalence with the original happy-path rendering/actions.
- Generate arbitrary saved/recent datasets and assert successful renders match unfixed output
  (preservation of chip/search population).

### Integration Tests

- Full pickup→dropoff flow with a failing then recovering address load: error+retry shown, retry
  succeeds, data renders, flow continues.
- Save a nudge under failure then success across both screens: message shown, then confirmation shown.
- Confirm under `upsertRecent` failure: navigation to the next screen still occurs, no error surfaced,
  Sentry captured.
