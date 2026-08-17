# Requirements Document

## Introduction

Tapping a push notification is supposed to deep-link into the relevant screen via `PUSH_DEEP_LINK_MAP` (`packages/shared/src/constants.ts`) and `navigateToDeepLink` (`packages/mobile-shared/src/utils/deep-link-router.ts`). Auditing every entry against both apps' actual `expo-router` file trees (found while manually testing push notifications, `.kiro/specs/actor-simulator/`) found **5 of 13 notification types point at routes that don't exist**:

| Type | Template | Target app | Problem |
|---|---|---|---|
| `delivery_status_change` | `/delivery/:resourceId` | customer | no such route (customer only has `/delivery/[id]/dispute`, `/rate`, `/receipt` — no bare index) |
| `delivery_cancelled` | `/delivery/:resourceId` | customer | same |
| `routing-complete` | `/delivery/:resourceId` | customer | same |
| `payment_received` | `/wallet` | driver | mobile-driver has no wallet route at all |
| `wallet_withdrawal` | `/wallet` | both | customer's `wallet/` has a `_layout.tsx` but no `index.tsx` |
| `system_alert` | `/alerts` | admin | no such route either app; currently unreachable in practice since no admin push tokens exist (`resolveTokens` returns `[]` for `targetApp === 'admin'`), but still wrong if that ever changes |

The remaining 7 (`driver_arrived`, `dispute_opened`, `delivery_assigned`, `carrier_verified`, `weight_correction`, `routing-failed`) were verified correct against real files.

Two structural problems caused this and will keep causing it:

1. **One shared, hand-typed map used by two apps with different route trees, with nothing verifying a template resolves to a real screen.** A route rename in either app breaks push deep links with no compile-time signal — only a real user hitting a 404 screen, which is how this was found.
2. **Redundant, inconsistent resolution.** The server computes and sends a fully-resolved `deepLink` string in every push payload (e.g. `delivery-accept.ts` does the same `:resourceId` substitution server-side and puts it in `data.deepLink`), but `navigateToDeepLink` ignores that value for every type except `'broadcast'` and recomputes the identical thing client-side from its own copy of the same shared constant. Harmless only because both sides import the same map today — but it's two code paths doing the same job, and a confusing pattern to maintain.

## Glossary

- **Deep_Link_Map**: `PUSH_DEEP_LINK_MAP`, the `PushNotificationType → route template` mapping in `packages/shared/src/constants.ts`.
- **Route_Template**: One Deep_Link_Map value, e.g. `/delivery/:resourceId`, with `:resourceId` substituted at resolution time.
- **Server_Resolved_Deep_Link**: The already-substituted deep link string the server computes and sends in `data.deepLink` on every push payload, currently used only for `'broadcast'` notifications client-side.

## Requirements

### Requirement 1: Fix the Currently-Broken Destinations

**User Story:** As a user of either app, I want tapping a push notification to actually take me to the relevant screen, not a "route not found" page.

#### Acceptance Criteria

1. WHEN a `delivery_status_change`, `delivery_cancelled`, or `routing-complete` push is tapped on the customer app, THE app SHALL navigate to a real, existing screen relevant to that delivery — not a nonexistent `/delivery/:resourceId` route (confirm during design whether this means building a customer delivery-detail screen, or redirecting these types to the existing `/tracking/:resourceId` screen)
2. WHEN a `payment_received` push is tapped on the driver app, THE app SHALL navigate to a real wallet/earnings screen (confirm during design: build a driver wallet route, or redirect to the existing `(tabs)/earnings.tsx`)
3. WHEN a `wallet_withdrawal` push is tapped on either app, THE app SHALL navigate to a real screen (confirm during design: add `wallet/index.tsx` to the customer app, or redirect to the existing `wallet/transactions.tsx`)
4. IF `system_alert` ever becomes reachable by a real device (e.g. an admin web push channel is added later), THEN its Route_Template SHALL also resolve to a real destination — not required to fix now given it's currently unreachable, but SHALL NOT be left silently wrong without a tracking note if left as-is

### Requirement 2: Prevent This Class of Regression

**User Story:** As a developer, I want a route rename to be caught automatically, so this can't silently break again and only surface when a real user hits a dead link.

#### Acceptance Criteria

1. THE system SHALL have an automated check (test or lint-time script — confirm which during design) that, for every Deep_Link_Map entry, verifies the Route_Template's static path segments correspond to an actual registered route file in the entry's target app (per `PUSH_APP_ROUTING`)
2. THE check SHALL run in CI, so a route rename that breaks a push deep link fails the build rather than shipping
3. THE check SHALL account for `expo-router` conventions correctly (route groups like `(tabs)` excluded from the URL path, dynamic segments like `[id]` matching `:resourceId`) — confirm the exact verification approach during design, since naively string-matching paths against the file tree needs to handle these conventions

### Requirement 3: One Source of Truth for Deep Link Resolution

**User Story:** As a developer maintaining this code, I want one clear place that decides where a push notification navigates to, not two code paths (server-computed string vs. client-recomputed template) that happen to agree today by coincidence of both reading the same constant.

#### Acceptance Criteria

1. THE system SHALL resolve to a single approach: either the client always uses Server_Resolved_Deep_Link (`data.deepLink`) for every notification type, or the server stops computing/sending it for non-broadcast types and the client-side Deep_Link_Map remains the sole source of truth — confirm which during design
2. WHICHEVER approach is chosen SHALL be applied consistently across every notification type, not special-cased per type as it is today (only `'broadcast'` currently uses the server-sent value)

## Out of Scope (confirm during design, not decided here)

- Whether missing screens (customer delivery-detail, driver wallet, customer wallet index) are genuinely missing product features that should be built, versus these notification types simply redirecting to an existing equivalent screen (tracking, earnings, transactions) — this is a product decision affecting Requirement 1's implementation, not something to assume in requirements
- Any broader redesign of the notification-to-screen mapping beyond fixing what's broken and preventing regression (e.g. per-notification-type contextual actions) is not in scope unless it falls out naturally from fixing Requirements 1–3
