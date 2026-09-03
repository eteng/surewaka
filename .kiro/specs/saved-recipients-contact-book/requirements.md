# Requirements Document

## Introduction

The Saved Recipients Contact Book gives senders in the SureWaka customer mobile app (`apps/mobile-customer`) a reusable address-book of delivery recipients. Today, the shipped `booking-recipient-contact` feature collects recipient name, phone, and delivery notes as one-off fields that are snapshotted onto the `deliveries` row at booking time — nothing is reusable, so every booking requires re-typing the recipient. This feature lets a sender SAVE a recipient to their own owner-scoped table and PICK that recipient again on future bookings, mirroring how `mobile-address-lookup` made pickup/dropoff places reusable (quick-select chips plus an inline "save as label" nudge).

The contact book is a CONVENIENCE SOURCE for pre-filling the existing Recipient booking step. It is NOT the system of record for a delivery: the delivery record continues to snapshot recipient details at booking time, and later edits or deletions to a saved recipient never alter historical deliveries.

The feature follows the established `mobile-address-lookup` architecture template: a new owner-scoped table (`user_saved_recipients`), an owner-scoped CRUD API under a new `/api/v1/recipients` route behind `requireAuth` with an explicit `WHERE user_id = ?` on every query, a `@surewaka/mobile-shared` API client, and additive UI (quick-select chips + inline save nudge) on the existing Recipient booking step plus a profile management screen.

## Glossary

- **Customer_App**: The Expo/React Native customer mobile application at `apps/mobile-customer`.
- **Saved_Recipient**: A persisted recipient contact owned by a single user. It consists of a `RecipientDetails` payload (recipient name, recipient phone, optional delivery notes) plus an `id`, an owner `user_id`, and an optional `label`.
- **RecipientDetails**: The existing shared type/shape from `@surewaka/shared` defined by `recipientDetailsSchema` — `recipientName` (2–100 characters), `recipientPhone` (Nigerian mobile matching `^(\+234|0)[789][01]\d{8}$`), and optional `deliveryNotes` (max 200 characters). Defined in `packages/shared/src/validators.ts`.
- **Recipient_Step**: The existing booking step screen at `apps/mobile-customer/app/booking/recipient.tsx`, introduced by the `booking-recipient-contact` feature, where the sender enters recipient details for the current booking.
- **Recipient_API**: The new owner-scoped CRUD API for saved recipients, served under `/api/v1/recipients` in `apps/api`, behind the `requireAuth` Clerk middleware.
- **Recipients_Client**: The new `@surewaka/mobile-shared` API client that the Customer_App uses to call the Recipient_API.
- **Profile_Recipients_Screen**: The new profile-area list screen for managing saved recipients, mirroring `apps/mobile-customer/app/profile/addresses.tsx`.
- **Recipient_Edit_Screen**: The new profile-area create/edit screen for a single saved recipient, mirroring `apps/mobile-customer/app/profile/address-edit.tsx`.
- **Quick_Select_Chip**: A tappable UI element on the Recipient_Step representing a Saved_Recipient that, when tapped, pre-fills the recipient form.
- **Save_Nudge**: The inline UI on the Recipient_Step that offers to save the currently entered recipient details as a Saved_Recipient.
- **Delivery_Snapshot**: The recipient name, phone, and delivery notes copied onto the `deliveries` row at booking creation time; the immutable record of who a specific delivery was for.
- **Recipient_Cap**: The maximum number of Saved_Recipients a single user may store (25, consistent with the saved-address cap).
- **Owner**: The authenticated user identified by `user_id`, the only user permitted to read or modify their Saved_Recipients.
- **Sentry**: The error monitoring service; mobile errors are tagged with `app:mobile-customer`.

## Relationship to Existing Specs

This section defines the fixed boundaries between this feature and the specs it depends on. These boundaries are requirements, not background.

1. THE Saved Recipients Contact Book feature SHALL depend on and extend the shipped `booking-recipient-contact` feature and SHALL NOT replace it.
2. THE Saved Recipients Contact Book feature SHALL reuse `recipientDetailsSchema` and the `RecipientDetails` type from `@surewaka/shared` for validating recipient name, recipient phone, and delivery notes, rather than defining a new recipient validation shape.
3. WHERE a Saved_Recipient is persisted, THE Saved_Recipient SHALL consist of a RecipientDetails payload plus an `id`, an owner `user_id`, and an optional `label`.
4. WHEN a delivery is created, THE Customer_App SHALL continue to write the recipient name, recipient phone, and delivery notes as a Delivery_Snapshot on the `deliveries` row exactly as the `booking-recipient-contact` feature does today.
5. WHEN a user edits a Saved_Recipient, THE Recipient_API SHALL leave the Delivery_Snapshot of every previously created delivery unchanged.
6. WHEN a user deletes a Saved_Recipient, THE Recipient_API SHALL leave the Delivery_Snapshot of every previously created delivery unchanged.
7. THE Saved Recipients Contact Book feature SHALL follow the `mobile-address-lookup` architecture template: a new owner-scoped table `user_saved_recipients`, an owner-scoped CRUD API under `/api/v1/recipients` behind `requireAuth`, a `@surewaka/mobile-shared` Recipients_Client, and additive quick-select and save-nudge UI on the existing Recipient_Step.
8. THE `user_saved_recipients` table SHALL be defined as one file per table under `packages/db/src/schema/` and exported via `packages/db/src/schema/index.ts`, with a uuid `id` defaulting to `defaultRandom()` and `created_at` / `updated_at` timestamp columns, and authorization enforced in the API layer (no RLS).

## Requirements

### Requirement 1: Save a recipient from the Recipient booking step

**User Story:** As a sender entering recipient details during booking, I want to save that recipient with one tap, so that I can reuse the recipient on future bookings without re-typing.

#### Acceptance Criteria

1. WHILE the entered recipient details on the Recipient_Step are valid against `recipientDetailsSchema`, THE Customer_App SHALL display a Save_Nudge offering to save the recipient.
2. IF the entered recipient details on the Recipient_Step fail validation against `recipientDetailsSchema`, THEN THE Customer_App SHALL hide the Save_Nudge.
3. WHILE the Owner already stores a number of Saved_Recipients equal to the Recipient_Cap, THE Customer_App SHALL hide the Save_Nudge.
4. WHEN a user activates the Save_Nudge, THE Recipients_Client SHALL send a create request to the Recipient_API containing the current `recipientName`, `recipientPhone`, `deliveryNotes`, and the chosen optional `label`.
5. WHEN the Recipient_API confirms the Saved_Recipient was created, THE Customer_App SHALL display a brief confirmation message and SHALL allow the user to continue the booking flow without interruption.
6. IF the create request from the Save_Nudge fails, THEN THE Customer_App SHALL display a visible failure message to the user, SHALL allow the booking flow to continue, and SHALL report the error to Sentry tagged with `app:mobile-customer`.

### Requirement 2: Quick-select a saved recipient on the Recipient step

**User Story:** As a sender who has saved recipients, I want to pick one on the Recipient step, so that the form fills in automatically.

#### Acceptance Criteria

1. WHILE the Owner has at least one Saved_Recipient, THE Customer_App SHALL display a Quick_Select_Chip for each Saved_Recipient above the recipient form on the Recipient_Step.
2. WHILE the Owner has no Saved_Recipients, THE Customer_App SHALL NOT display any Quick_Select_Chip.
3. WHILE the Owner has at least one Saved_Recipient, WHEN a user taps a Quick_Select_Chip, THE Customer_App SHALL pre-fill the Recipient_Step form fields `recipientName`, `recipientPhone`, and `deliveryNotes` from the selected Saved_Recipient.
4. WHEN a user taps a Quick_Select_Chip, THE Customer_App SHALL leave the pre-filled fields editable so the user can adjust them before continuing.
5. WHEN a user taps a Quick_Select_Chip, THE Customer_App SHALL NOT create a delivery or advance to the next booking step until the user explicitly submits the Recipient_Step.
6. IF the request to load the Owner's Saved_Recipients for the Recipient_Step fails, THEN THE Customer_App SHALL present a retry action, AND WHEN the retry action is successfully presented, THE Customer_App SHALL report the error to Sentry tagged with `app:mobile-customer`.

### Requirement 3: Manage saved recipients from the profile area

**User Story:** As a sender, I want to view, edit, and delete my saved recipients in my profile, so that I can keep my contact book accurate.

#### Acceptance Criteria

1. WHEN a user opens the Profile_Recipients_Screen, THE Recipients_Client SHALL request the Owner's Saved_Recipients from the Recipient_API.
2. WHEN the Recipient_API returns one or more Saved_Recipients, THE Profile_Recipients_Screen SHALL display each Saved_Recipient showing its label (or recipient name when no label is set) and recipient phone.
3. WHEN a user opens the Recipient_Edit_Screen for an existing Saved_Recipient, THE Recipient_Edit_Screen SHALL pre-populate the form with that Saved_Recipient's recipient name, recipient phone, delivery notes, and label.
4. WHEN a user saves changes on the Recipient_Edit_Screen for an existing Saved_Recipient, THE Recipients_Client SHALL send an update request to the Recipient_API for that Saved_Recipient.
5. WHEN a user requests deletion of a Saved_Recipient, THE Customer_App SHALL require an explicit confirmation before sending a delete request to the Recipient_API.
6. WHEN the Recipient_API confirms deletion of a Saved_Recipient, THE Profile_Recipients_Screen SHALL remove that Saved_Recipient from the displayed list.
7. IF an update or delete request is attempted and fails, THEN THE Customer_App SHALL keep the affected Saved_Recipient in the list, SHALL attempt to display a failure message, and SHALL attempt to report the error to Sentry tagged with `app:mobile-customer`; the requirement is satisfied when the affected Saved_Recipient remains visible even if the message or Sentry report does not succeed.
8. WHILE no update or delete request has been attempted, or WHEN an update or delete request succeeds, THE Customer_App SHALL NOT display a failure message or report an error to Sentry.

### Requirement 4: Owner scoping and authentication

**User Story:** As a sender, I want my saved recipients to be private to me, so that no other user can see or change them.

#### Acceptance Criteria

1. THE Recipient_API SHALL require a valid Clerk session via `requireAuth` for every recipient endpoint.
2. IF a request to the Recipient_API has no valid authenticated session, THEN THE Recipient_API SHALL respond with HTTP 401 and SHALL NOT return any Saved_Recipient data.
3. WHEN the Recipient_API reads, modifies, counts, or checks the existence of Saved_Recipients, THE Recipient_API SHALL constrain every database query — including existence checks and count queries — with an explicit `WHERE user_id = ?` bound to the authenticated user's identifier.
4. WHEN an authenticated user requests a Saved_Recipient whose `user_id` differs from the authenticated user's identifier, THE Recipient_API SHALL respond with HTTP 404 and SHALL NOT return that Saved_Recipient.
5. WHEN the Recipient_API creates a Saved_Recipient, THE Recipient_API SHALL set the `user_id` from the authenticated session rather than from the request body.

### Requirement 5: Cap on saved recipients

**User Story:** As the platform, I want to limit how many recipients a user stores, so that the contact book stays manageable and consistent with the saved-address limit.

#### Acceptance Criteria

1. THE Recipient_Cap SHALL be 25 Saved_Recipients per Owner.
2. WHEN the Recipient_API receives a create request while the Owner already stores a number of Saved_Recipients equal to the Recipient_Cap, THE Recipient_API SHALL reject the request with HTTP 400 and an error code of `LIMIT_REACHED`.
3. WHEN the Recipient_API rejects a create request with `LIMIT_REACHED`, THE Recipient_API SHALL NOT create a new Saved_Recipient.
4. WHEN the Owner stores a number of Saved_Recipients equal to the Recipient_Cap, THE Profile_Recipients_Screen SHALL hide the add-new-recipient action and SHALL display a message stating that the maximum of 25 saved recipients has been reached.
5. WHEN the Recipient_API receives any create request while the Owner already stores a number of Saved_Recipients equal to the Recipient_Cap, including requests originating from bulk or import operations, THE Recipient_API SHALL reject the request with `LIMIT_REACHED` and SHALL NOT create a new Saved_Recipient.

### Requirement 6: Reusability without breaking delivery history

**User Story:** As a sender, I want editing or removing a saved recipient to leave my past deliveries untouched, so that historical records stay accurate.

#### Acceptance Criteria

1. WHEN a delivery is created from the Recipient_Step, THE Customer_App SHALL persist the recipient name, recipient phone, and delivery notes as a Delivery_Snapshot on the delivery, independent of any Saved_Recipient.
2. WHEN a user edits a Saved_Recipient after a delivery referencing the same recipient details was created, THE Recipient_API SHALL leave that delivery's Delivery_Snapshot unchanged.
3. WHEN a user deletes a Saved_Recipient after a delivery referencing the same recipient details was created, THE Recipient_API SHALL leave that delivery's Delivery_Snapshot unchanged.
4. THE Customer_App SHALL create deliveries without requiring any Saved_Recipient to exist.

### Requirement 7: Validation reuse

**User Story:** As a sender, I want saved recipients validated the same way as booking recipient details, so that a saved recipient is always usable at booking time.

#### Acceptance Criteria

1. WHEN the Recipient_API validates a create or update request, THE Recipient_API SHALL validate `recipientName`, `recipientPhone`, and `deliveryNotes` using `recipientDetailsSchema` from `@surewaka/shared`.
2. IF a create or update request contains a `recipientPhone` that does not match the Nigerian mobile pattern `^(\+234|0)[789][01]\d{8}$`, THEN THE Recipient_API SHALL respond with HTTP 400, SHALL NOT persist the Saved_Recipient, and SHALL log the validation failure for monitoring and analytics.
7. THE Recipient_API SHALL validate `recipientPhone` only against the basic Nigerian mobile pattern `^(\+234|0)[789][01]\d{8}$` and SHALL NOT apply carrier-specific digit-pattern validation.
3. IF a create or update request contains a `recipientName` shorter than 2 characters or longer than 100 characters, THEN THE Recipient_API SHALL respond with HTTP 400 and SHALL NOT persist the Saved_Recipient.
4. IF a create or update request contains `deliveryNotes` longer than 200 characters, THEN THE Recipient_API SHALL respond with HTTP 400 and SHALL NOT persist the Saved_Recipient.
5. WHERE a Saved_Recipient includes a `label`, THE Recipient_API SHALL validate the label as a string no longer than 50 characters.
6. WHEN the Recipient_Edit_Screen validates form input before submission, THE Recipient_Edit_Screen SHALL validate against `recipientDetailsSchema` from `@surewaka/shared`.

### Requirement 8: Async and resilience states

**User Story:** As a sender, I want the contact-book screens to clearly show loading, empty, and error states, so that the app feels reliable and I always know what is happening.

#### Acceptance Criteria

1. WHILE the Profile_Recipients_Screen is loading the Owner's Saved_Recipients, THE Profile_Recipients_Screen SHALL display a skeleton loader matching the shape of the recipient list.
2. WHEN the Recipient_API returns zero Saved_Recipients for the Profile_Recipients_Screen, THE Profile_Recipients_Screen SHALL display an empty state prompting the user to add a recipient.
3. IF loading the Owner's Saved_Recipients on the Profile_Recipients_Screen fails, THEN THE Profile_Recipients_Screen SHALL display an error message with a retry action that re-requests the Saved_Recipients.
4. WHILE the Recipient_Step is loading the Owner's Saved_Recipients for quick-select, THE Customer_App SHALL display a loading indicator in place of the Quick_Select_Chip row.
5. IF loading the Owner's Saved_Recipients for the Recipient_Step quick-select fails, THEN THE Customer_App SHALL display an error affordance with a retry action and SHALL NOT block manual entry of recipient details.
6. WHEN any user-initiated Save_Nudge, quick-select load, list, edit, or delete operation fails, THE Customer_App SHALL surface feedback to the user rather than silently discarding the failure.
8. WHERE an operation is a background operation the user did not explicitly trigger, THE Customer_App SHALL NOT be required to surface user-facing feedback for its failure.
7. WHEN the Customer_App reports a contact-book error to Sentry, THE Customer_App SHALL tag the reported error with `app:mobile-customer`.
