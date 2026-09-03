# Bugfix Requirements Document

## Introduction

The booking pickup and dropoff screens in the SureWaka customer mobile app silently swallow API
failures and lack the async states required by the workspace frontend-resilience standard
(`.kiro/steering/frontend-resilience.md`). Affected files:

- `apps/mobile-customer/app/booking/pickup.tsx`
- `apps/mobile-customer/app/booking/dropoff.tsx`

Both screens use `createAddressesClient(token)` from `@surewaka/mobile-shared`, which calls
`GET /api/v1/addresses` (`list`), `GET /api/v1/addresses/recent` (`listRecent`),
`POST /api/v1/addresses` (`create`), and `POST /api/v1/addresses/recent` (`upsertRecent`).
Each method returns `{ data, error }`.

Four confirmed failure paths give users no feedback and, in one case, produce an unhandled promise
rejection:

1. On-mount saved-address (`list`) and recent-location (`listRecent`) loads guard only on
   `if (r.data)`, so any error leaves the saved-address chip row and the Recent/Saved search
   sections silently empty — no loading, empty, or error+retry state (violates §2).
2. The save-nudge handler (`handleSaveNudge`) awaits `client.create(...)` and acts only on success
   (`if (!result.error)`). On failure the user who tapped "Home"/"Office"/"Work"/"Other" gets no
   feedback and nothing is reported (violates §2 and §4).
3. `handleConfirm` fires `client.upsertRecent(...)` fully unhandled — no `.then`, no `.catch` — so a
   rejected promise becomes an unhandled promise rejection (violates §4).
4. There is no Sentry reporting anywhere in these screens, despite §4 requiring `captureException`
   tagged `app:mobile-customer`.

Scope is mobile-client-only and limited to these two screens. The profile addresses screen
(`apps/mobile-customer/app/profile/addresses.tsx`) already handles loading/empty/error/retry and
delete-failure correctly and is out of scope. The LocationIQ `searchAddress` autocomplete path
(already wrapped in try/catch), the maps `reverseGeocode` handling, and any API/server changes are
also out of scope. The happy-path booking flow — chips, search sections, save nudge, background
recent write, and navigation — must be preserved, and the fire-and-forget (non-blocking) semantics of
`upsertRecent` must be kept; only its rejection is to be caught and reported.

## Bug Analysis

### Bug Condition Definitions (C(X) style)

The screens are modeled as pure input-to-behavior mappings. `F` is the current (unfixed) screen
behavior; `F'` is the fixed behavior. Inputs `X` are the outcomes of the address client calls plus
the async timing window.

```pascal
FUNCTION isBugCondition_SavedRecentLoad(X)
  INPUT: X = outcome of client.list() / client.listRecent() on mount
  OUTPUT: boolean
  // Bug manifests when a load is in flight (no state shown) OR resolves to an error / rejects.
  RETURN X.phase = IN_FLIGHT
      OR X.result.error IS NOT NULL
      OR X.result IS REJECTED
END FUNCTION

FUNCTION isBugCondition_SaveNudge(X)
  INPUT: X = outcome of client.create(nudgeLabel, ...) after a save-nudge tap
  OUTPUT: boolean
  // Bug manifests when the create call resolves with an error or rejects.
  RETURN X.result.error IS NOT NULL
      OR X.result IS REJECTED
END FUNCTION

FUNCTION isBugCondition_RecentWrite(X)
  INPUT: X = outcome of client.upsertRecent(...) fired during handleConfirm
  OUTPUT: boolean
  // Bug manifests when the background write rejects (unhandled promise rejection).
  RETURN X.result IS REJECTED
      OR X.result.error IS NOT NULL
END FUNCTION
```

### Current Behavior (Defect)

What currently happens when the bug is triggered on either screen.

1.1 WHEN the on-mount `client.list()` (saved addresses) request is in flight THEN the system shows no loading state for the saved-address chip row or the Recent/Saved search sections
1.2 WHEN the on-mount `client.list()` request resolves with a non-null `error` or rejects THEN the system silently leaves `savedAddresses` empty with no error message and no retry affordance
1.3 WHEN the on-mount `client.listRecent()` (recent locations) request is in flight THEN the system shows no loading state for the Recent search section
1.4 WHEN the on-mount `client.listRecent()` request resolves with a non-null `error` or rejects THEN the system silently leaves `recentLocations` empty with no error message and no retry affordance
1.5 WHEN a user taps a save-nudge label ("Home"/"Office"/"Work"/"Other") and `client.create(...)` resolves with a non-null `error` or rejects THEN the system does nothing — no confirmation, no error message, and no report
1.6 WHEN `handleConfirm` fires `client.upsertRecent(...)` and that request rejects THEN the system produces an unhandled promise rejection because the call has no `.then` or `.catch`
1.7 WHEN any of the address load, save-nudge, or recent-write requests fails THEN the system reports nothing to Sentry

### Expected Behavior (Correct)

What should happen instead, per frontend-resilience §2 and §4.

2.1 WHEN the on-mount `client.list()` request is in flight THEN the system SHALL show a loading state (skeleton matching the chip row / search section shape) for the saved-address content
2.2 WHEN the on-mount `client.list()` request resolves with a non-null `error` or rejects THEN the system SHALL show an error affordance with a Retry control that re-triggers `client.list()`, AND SHALL report the failure to Sentry via `captureException` tagged `app:mobile-customer` with route context
2.3 WHEN the on-mount `client.listRecent()` request is in flight THEN the system SHALL show a loading state for the Recent search section
2.4 WHEN the on-mount `client.listRecent()` request resolves with a non-null `error` or rejects THEN the system SHALL show an error affordance with a Retry control that re-triggers `client.listRecent()`, AND SHALL report the failure to Sentry via `captureException` tagged `app:mobile-customer` with route context
2.5 WHEN a user taps a save-nudge label and `client.create(...)` resolves with a non-null `error` or rejects THEN the system SHALL surface a visible failure message to the user, AND SHALL report the failure to Sentry via `captureException` tagged `app:mobile-customer` with route context
2.6 WHEN `handleConfirm` fires `client.upsertRecent(...)` and that request rejects or resolves with an error THEN the system SHALL catch the rejection (no unhandled promise rejection) and report it to Sentry via `captureException` tagged `app:mobile-customer` with route context, WITHOUT surfacing an error to the user (background write)
2.7 WHEN the Retry control for a failed saved-address or recent-location load is activated and the retried request succeeds THEN the system SHALL clear the error affordance and render the loaded data

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved for inputs that do not trigger the bug.

3.1 WHEN `client.list()` succeeds with data THEN the system SHALL CONTINUE TO populate the saved-address chip row and the Saved search section exactly as before
3.2 WHEN `client.listRecent()` succeeds with data THEN the system SHALL CONTINUE TO populate the Recent search section exactly as before
3.3 WHEN a user taps a save-nudge label and `client.create(...)` succeeds THEN the system SHALL CONTINUE TO set the "Saved as {label}" confirmation and append the new address to `savedAddresses`
3.4 WHEN `handleConfirm` runs with a valid selected location THEN the system SHALL CONTINUE TO set the pickup/dropoff in the booking store, advance the step, fire `client.upsertRecent(...)` as a non-blocking background write, and navigate to the next screen without awaiting or blocking on that write
3.5 WHEN the LocationIQ `searchAddress` autocomplete path runs THEN the system SHALL CONTINUE TO behave as it does today (its existing try/catch is unchanged)
3.6 WHEN the map `reverseGeocode` path or map-press selection runs THEN the system SHALL CONTINUE TO behave as it does today
3.7 WHEN the profile addresses screen (`apps/mobile-customer/app/profile/addresses.tsx`) is used THEN the system SHALL CONTINUE TO behave as it does today (out of scope, unchanged)

### Fix Checking and Preservation Checking (structured properties)

```pascal
// Property: Fix Checking — saved/recent load resilience
FOR ALL X WHERE isBugCondition_SavedRecentLoad(X) DO
  IF X.phase = IN_FLIGHT THEN
    ASSERT loading_state_shown_for(saved_chip_row OR recent_search_section)
  ELSE  // error or rejection
    ASSERT error_affordance_with_retry_shown()
       AND retry_re_triggers_same_request()
       AND sentry_captured(tag = 'app:mobile-customer', route_context = present)
  END IF
END FOR

// Property: Fix Checking — save-nudge failure feedback
FOR ALL X WHERE isBugCondition_SaveNudge(X) DO
  ASSERT user_visible_failure_message_shown()
     AND sentry_captured(tag = 'app:mobile-customer', route_context = present)
END FOR

// Property: Fix Checking — recent-write rejection handling
FOR ALL X WHERE isBugCondition_RecentWrite(X) DO
  ASSERT rejection_caught()                 // no unhandled promise rejection
     AND sentry_captured(tag = 'app:mobile-customer', route_context = present)
     AND NOT user_error_surfaced()          // background write stays silent to user
     AND navigation_not_blocked()           // fire-and-forget preserved
END FOR

// Property: Preservation Checking — happy path unchanged
FOR ALL X WHERE NOT isBugCondition_SavedRecentLoad(X)
             AND NOT isBugCondition_SaveNudge(X)
             AND NOT isBugCondition_RecentWrite(X) DO
  ASSERT F(X) = F'(X)   // chips, search sections, save-nudge confirmation,
                        // background recent write, and navigation identical to today
END FOR
```
