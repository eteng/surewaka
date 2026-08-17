# Implementation Plan: Custom Notification Sound

## Overview

Bottom-up: the asset has to exist before anything else can happen, then native registration, then the two platform-specific mechanisms (which are independent of each other and can go in either order), then the backend line, then rebuild and verify. No schema changes, no new automated tests (see `requirements.md` Requirement 5.3) — this is a small, mostly-configuration change with one real code addition (Task 3).

## Tasks

- [ ] 1. Source the Sound Asset
  - [ ] 1.1 Produce or commission the Brand_Sound
    - `.wav`, ≤ 5 seconds, original or properly licensed (retain proof)
    - Land it in the repo at a location both apps' build process can reach (confirm shared vs. per-app copy when wiring Task 2 — design.md flags this as an open call)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
    - _Blocks everything else — this is a product/design deliverable, not something an engineer can produce unilaterally._

- [ ] 2. Register the Asset (both apps)
  - [ ] 2.1 Add/configure the `expo-notifications` config plugin in `apps/mobile-customer/app.json`
    - `sounds: ["<path-to-asset>"]`; verify the plugin isn't already present in some other form first
    - _Requirements: 2.1_
  - [ ] 2.2 Same for `apps/mobile-driver/app.json`
    - _Requirements: 2.1_

- [ ] 3. Android — Notification Channel (packages/mobile-shared)
  - [ ] 3.1 Add channel setup call
    - `Notifications.setNotificationChannelAsync('default', { name: 'SureWaka notifications', importance: AndroidImportance.HIGH, sound: '<base-filename>.wav' })`
    - Run once at app start, alongside the existing `usePushNotifications` hook's mount point — shared between both apps, not duplicated
    - Base filename only per Expo's docs (no path)
    - _Requirements: 3.1, 3.2_

- [ ] 4. iOS — Backend Payload Sound Field
  - [ ] 4.1 Update `buildMessages()` in `workers/push-worker/src/processor.ts`
    - `sound: 'default' as const` → `sound: '<base-filename>.wav' as const` (currently line 139 — confirm line number hasn't shifted)
    - _Requirements: 4.1, 4.2_

- [ ] 5. Rebuild and Verify
  - [ ] 5.1 New EAS development build for both apps
    - `eas build --profile development --platform android` and `--platform ios`, both apps — native config change from Task 2 requires this
    - _Requirements: 2.2_
  - [ ] 5.2 Manual verification
    - Trigger a real push (or reuse the same manual test-push approach used earlier this session — see `.kiro/specs/actor-simulator/`) on a real Android device, confirm Brand_Sound plays
    - Same on a real iOS device
    - _Requirements: 5.1, 5.2_
  - [ ] 5.3 Production build once dev verification passes
    - _Requirements: (rollout, no specific acceptance criterion)_
