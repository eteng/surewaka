# Requirements Document

## Introduction

Push notifications currently use the OS default notification sound on both `mobile-customer` and `mobile-driver`. This spec replaces it with one signature, custom "SureWaka sound" across both apps, for every push notification the platform sends — a brand-recognition goal (a user hears it and knows it's SureWaka before looking at the phone), not per-event-type sound differentiation. See `design.md` for the technical mechanism, which differs meaningfully between Android (notification channel, client-side) and iOS (per-message payload field, server-side) — verified against Expo's current documentation during design, not assumed.

## Glossary

- **Brand_Sound**: The single custom audio asset used for every push notification across both apps, replacing the OS default.
- **Notification_Channel**: Android's mechanism (API 26+) for grouping notification behavior including sound; governs Android sound regardless of what a push payload specifies.
- **Push_Payload_Sound**: The `sound` field on an outgoing Expo push message; the only mechanism iOS respects for a custom remote-push sound, since iOS has no channel concept.

## Requirements

### Requirement 1: Source the Sound Asset

**User Story:** As the product owner, I want a properly licensed, correctly-formatted brand sound available in the repo, so implementation isn't blocked or later found to be legally or technically unusable.

#### Acceptance Criteria

1. THE sourced asset SHALL be in `.wav` format
2. THE sourced asset SHALL be 5 seconds or shorter — iOS silently falls back to the default system sound for anything longer, so this is a hard constraint, not a preference
3. THE sourced asset SHALL be either fully original/commissioned work or explicitly licensed for commercial use, with licensing proof retained
4. THE same single asset SHALL be used for both `mobile-customer` and `mobile-driver` — no per-app variant

### Requirement 2: Register the Asset in Both Apps

**User Story:** As a developer, I want the sound asset bundled into both native builds, so the OS-level mechanisms in Requirements 3 and 4 have a file to reference.

#### Acceptance Criteria

1. THE `expo-notifications` config plugin SHALL be configured in both `apps/mobile-customer/app.json` and `apps/mobile-driver/app.json` with the Brand_Sound registered in its `sounds` array
2. Registering the plugin SHALL require a fresh EAS development (and later production) build for both apps, since this is a native configuration change, not a JS-only change

### Requirement 3: Android — Notification Channel

**User Story:** As an Android user of either app, I want to hear the SureWaka Brand_Sound when I receive a push notification, so I recognize it's SureWaka without unlocking my phone.

#### Acceptance Criteria

1. WHEN either app starts, THE app SHALL ensure a Notification_Channel exists with the Brand_Sound configured as its sound
2. THE Notification_Channel setup SHALL live in `packages/mobile-shared` (shared between both apps, alongside the existing `usePushNotifications` hook) rather than being duplicated per app
3. WHEN a push notification is delivered to an Android device via that channel, THE Brand_Sound SHALL play instead of the OS default, regardless of the `sound` value in the server-sent push payload (Android channel configuration takes precedence over payload-level sound)

### Requirement 4: iOS — Push Payload Sound Field

**User Story:** As an iOS user of either app, I want to hear the same SureWaka Brand_Sound when I receive a push notification, so the brand experience is consistent regardless of platform.

#### Acceptance Criteria

1. WHEN `workers/push-worker/src/processor.ts` builds an outgoing push message (`buildMessages()`), THE message's `sound` field SHALL be set to the Brand_Sound's filename rather than `'default'`
2. THIS change SHALL apply to every outgoing push regardless of notification type or target app — consistent with the single-brand-sound goal (Requirement 1.4), not per-event differentiation
3. WHEN a push notification is delivered to an iOS device, THE Brand_Sound SHALL play instead of the OS default, provided Requirement 2 (asset bundled into the iOS build) is satisfied

### Requirement 5: Verification

**User Story:** As the person shipping this, I want confirmation it actually works on both platforms before considering it done, given push notifications in this codebase have a history of failing silently (see `.kiro/specs/actor-simulator/` session notes on the FCM credentials and silent-catch logging gaps found while testing).

#### Acceptance Criteria

1. AFTER both apps are rebuilt with the new configuration, THE Brand_Sound SHALL be manually verified as audible on a real Android device
2. AFTER both apps are rebuilt with the new configuration, THE Brand_Sound SHALL be manually verified as audible on a real iOS device
3. No new automated test coverage is required for this change — it's a one-line backend change plus native configuration, not logic that benefits from new test infrastructure (confirm this scope assessment still holds if implementation reveals more complexity than expected)
