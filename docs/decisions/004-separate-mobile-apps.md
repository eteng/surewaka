# ADR-004: Separate Mobile Apps for Customers and Drivers

## Status

Accepted

## Context

SureWaka serves two distinct mobile user groups: customers (senders/receivers) and drivers. The original plan was a single Expo app (`apps/mobile`) serving both roles with a role-based login flow. As we defined the feature requirements for each user type, it became clear the overlap is minimal and the constraints are very different.

## Decision

Split into two separate Expo apps sharing a common package:

- `apps/mobile-customer` — booking, carrier comparison, real-time tracking, payments
- `apps/mobile-driver` — job queue, map navigation, proof-of-delivery capture, earnings
- `packages/mobile-shared` — API client, auth hooks, design tokens, shared components

Fleet managers (carriers) do NOT get a native app. The `apps/carrier` web portal will be built responsive/PWA-ready to cover mobile use cases for fleet dispatch.

## Rationale

### UX divergence

Drivers need a map-centric, always-on interface with background location tracking. Customers need a transactional flow (book → track → confirm). These are fundamentally different interaction models that would fight each other in a single app.

### Permissions

The driver app requires:
- Background location (real-time tracking updates)
- Camera (proof-of-delivery photos)
- Potentially phone/call access

The customer app needs only foreground notifications. A combined app would request all permissions upfront, hurting install conversion rates — especially in the Nigerian market where users are permission-sensitive.

### Bundle size

Driver-specific SDKs (maps, navigation, camera) add ~5-8MB to the bundle. Customers don't need any of that. Keeping apps lean matters for users on limited data plans.

### Independent release cycles

Driver app changes are driven by ops/logistics needs (new delivery statuses, route optimization). Customer app changes are driven by product/growth (onboarding, promotions, UX improvements). Decoupling lets each ship without blocking the other.

### App store presence

Two focused apps with clear value propositions convert better than one app that asks "are you a driver or sender?" at login. Ratings stay isolated — driver frustrations don't tank the customer app's score.

### Fleet managers stay on web

Fleet management is desk-oriented work: reviewing requests, assigning drivers, managing documents, viewing reports. A responsive web app (with PWA push notifications) covers the occasional mobile check without justifying a third native app.

## Consequences

**Positive:**
- Each app is focused and lean
- Independent deployments via EAS Build
- Clean app store listings with targeted screenshots/descriptions
- Permissions only requested where needed
- Easier to A/B test and iterate per user segment

**Negative:**
- Two EAS Build pipelines to maintain
- Shared code must be carefully managed in `packages/mobile-shared`
- Design system changes need testing in both apps
- Slightly more CI configuration

## Alternatives Considered

1. **Single app with role-based routing** — Rejected due to permission bloat, bundle size, and UX compromise
2. **Three apps (customer + driver + fleet)** — Rejected; fleet managers' needs are better served by a responsive web portal
3. **Customer web-only, driver native-only** — Rejected; customers benefit from native push notifications and smoother tracking UX on mobile

## When to Revisit

- If a significant user segment both sends and drives (unlikely for SureWaka's market)
- If maintaining two EAS pipelines becomes a bottleneck with a small team
- If fleet managers demonstrate strong demand for native mobile features beyond what PWA provides
