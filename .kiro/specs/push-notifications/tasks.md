# Implementation Plan: Push Notifications

## Overview

This plan implements push notifications for SureWaka's mobile apps (customer and driver) using Expo Push Notifications, a BullMQ push-worker, multi-device token management, deep linking, and admin broadcast. Implementation proceeds from foundation (DB, types) through backend (API, worker) to mobile integration and admin UI.

## Tasks

- [ ] 1. Database migration — push_tokens table and users.notification_push column
  - Create migration file `supabase/migrations/<timestamp>_push_tokens.sql`
  - Add `push_tokens` table with columns: id (UUID PK), user_id (UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE), expo_push_token (TEXT UNIQUE), device_id (TEXT NOT NULL), platform (TEXT NOT NULL CHECK ios/android), app (TEXT NOT NULL CHECK customer/driver), is_active (BOOLEAN DEFAULT true NOT NULL), created_at (TIMESTAMPTZ DEFAULT now()), updated_at (TIMESTAMPTZ DEFAULT now())
  - Add partial indexes: idx_push_tokens_user_active and idx_push_tokens_user_app_active (WHERE is_active = true)
  - **No RLS needed** — project uses Neon (not Supabase Postgres); authorization is in application code via `requireAuth` middleware
  - Add `notification_push BOOLEAN DEFAULT true NOT NULL` column to users table
  - Run `pnpm --filter @surewaka/db db:pull` to regenerate Drizzle schema
  - **Requirements:** 1.3, 2.3, 4.1, 10.1

- [ ] 2. Shared types, validators, and constants for push notifications
  - Add `PushNotificationType`, `PushTargetApp`, `PushNotificationPayload`, `PushJobData`, `BroadcastChunkJobData`, `PushTokenRecord` types to `packages/shared/src/types.ts`. `BroadcastChunkJobData` = `{ userIds: string[], payload: PushNotificationPayload, segment: string }`. `PushNotificationType` includes: `delivery_status_change`, `delivery_cancelled`, `driver_arrived`, `payment_received`, `dispute_opened`, `delivery_assigned`, `carrier_verified`, `broadcast`.
  - Add `registerPushTokenSchema`, `pushNotificationPayloadSchema`, `broadcastSchema` to `packages/shared/src/validators.ts`
  - Add push constants to `packages/shared/src/constants.ts`: PUSH_NOTIFICATION_TYPES (include `delivery_cancelled`), PUSH_TARGET_APPS, HIGH_PRIORITY_PUSH_TYPES (add `delivery_cancelled` — cancellations are high-priority since money is involved), PUSH_DEEP_LINK_MAP (map `delivery_cancelled` → `/delivery/:resourceId`), PUSH_APP_ROUTING (map `delivery_cancelled` → `'customer'`), MAX_PUSH_TOKENS_PER_USER_PER_APP, PUSH_BATCH_SIZE, PUSH_MAX_RETRIES, PUSH_RETRY_BASE_MS, PUSH_QUEUE_NAME (`push:notifications` for transactional), PUSH_BROADCAST_QUEUE_NAME (`push:broadcasts` for chunk jobs), PUSH_BROADCAST_BATCH_SIZE
  - **IMPORTANT:** In PUSH_APP_ROUTING, set `payment_received: 'driver'` (NOT `'customer'` as shown in the design doc constants section — the design doc is incorrect here). Payment received notifications target the driver who earned the money.
  - Export all new types, schemas, and constants from `packages/shared/src/index.ts`
  - Verify build passes with `pnpm --filter @surewaka/shared build`
  - **Requirements:** 9.1, 9.3, 9.5, 10.2-10.6

- [ ] 3. Push token API routes (register and deactivate)
  - Create `apps/api/src/routes/push-tokens.ts` with Hono router
  - Implement `POST /` — validate body with registerPushTokenSchema, extract `user_id` from `c.get('user').id` (internal UUID — `requireAuth` middleware already resolves Clerk token → internal UUID via `users.clerk_id` lookup), upsert token with ON CONFLICT DO UPDATE
  - Implement token limit enforcement: count active tokens for (user_id, app), if >= 10 deactivate oldest
  - Implement `DELETE /:token` — set is_active = false WHERE expo_push_token = :token AND user_id = `c.get('user').id` (idempotent)
  - Register route in `apps/api/src/index.ts` at `/api/v1/push-tokens`
  - Verify API builds with `pnpm --filter @surewaka/api build`
  - **Requirements:** 1.2, 1.3, 1.4, 1.7, 2.1, 2.3

- [ ] 4. Push service — enqueue logic with preference checks and app routing
  - Create `apps/api/src/services/push-service.ts`
  - Implement `enqueuePush(userId, type, payload, targetAppOverride?)` — validate payload, check user notification_push preference, determine target app from PUSH_APP_ROUTING, determine priority, add job to BullMQ queue
  - **IMPORTANT:** PUSH_APP_ROUTING must use `payment_received: 'driver'` — payment notifications target the driver's tokens (the driver earned the money). The design doc constants section incorrectly shows `'customer'`; implement the corrected routing.
  - Implement `enqueueBroadcast(segment, payload)` — paginate through eligible users in batches of 500 using cursor-based pagination. For each batch, enqueue a single **chunk job** containing `{ userIds: string[], payload, segment }` — NOT one job per user. This batch-per-chunk approach scales to 520K users (~1,040 jobs vs 520K). Preference filtering is intentionally skipped at enqueue time for broadcasts; the worker's `resolveTokens` handles opt-out exclusion at delivery time. **City filter deferred** — no city field on users table yet (launches Lagos-only); `city` param accepted in API schema but ignored until user profiles have a city field.
  - Implement `getBroadcastEstimate(segment)` — query count of eligible users (filter by `notification_push = true` here to show admins accurate estimates in the confirmation UI). City filter deferred.
  - Initialize BullMQ Queue connections: `push:notifications` for transactional push jobs, `push:broadcasts` for broadcast chunk jobs. Both use REDIS_URL. Separate queues prevent broadcast floods from delaying time-sensitive delivery notifications.
  - Verify build passes with `pnpm --filter @surewaka/api build`
  - **Requirements:** 3.1, 3.9, 4.2, 4.3, 7.2, 7.3, 7.5, 9.1, 9.3, 9.5, 10.2-10.7

- [ ] 5. Push worker — package setup and BullMQ consumer
  - Create `workers/push-worker/package.json` with dependencies: bullmq, expo-server-sdk, ioredis, @surewaka/db, @surewaka/shared
  - Create `workers/push-worker/tsconfig.json` extending root config
  - Create `workers/push-worker/src/index.ts` — initialize **two Workers**: one consuming `push:notifications` (transactional, concurrency from env PUSH_WORKER_CONCURRENCY, default 5) and one consuming `push:broadcasts` (chunk jobs, concurrency 2 — lower to avoid starving transactional). Handle Redis connection events with reconnect backoff (max 10 attempts then exit non-zero).
  - Create `workers/push-worker/src/expo-client.ts` — export singleton Expo instance
  - Add @surewaka/worker-push to root pnpm-workspace.yaml and turbo.json
  - Verify worker builds with `pnpm --filter @surewaka/worker-push build`
  - **Requirements:** 8.3, 8.4, 8.6

- [ ] 6. Push worker — token resolver and job processor
  - Create `workers/push-worker/src/token-resolver.ts` — implement `resolveTokens(userId, targetApp)` with preference check and app filter for single-user jobs. Implement `resolveTokensBulk(userIds, segment)` for broadcast chunk jobs — single DB query: `SELECT expo_push_token, user_id FROM push_tokens WHERE user_id = ANY($1) AND is_active = true` joined with `users.notification_push = true`. **Segment-aware token filtering:** when `segment = 'customers'` filter to `app = 'customer'` tokens only; when `segment = 'drivers'` filter to `app = 'driver'` tokens only; when `segment = 'all'` return all tokens regardless of app field (Req 10.4 applies only to `all` segment).
  - Create `workers/push-worker/src/processor.ts` — two processing paths:
    - **Single-user jobs** (`PushJobData`): resolve tokens → build ExpoPushMessages → chunk (max 100) → send via Expo API → process tickets → log metrics
    - **Broadcast chunk jobs** (`BroadcastChunkJobData`): call `resolveTokensBulk(job.data.userIds, job.data.segment)` → segment drives token app filter (`customers` → customer tokens only, `drivers` → driver tokens only, `all` → all tokens per Req 10.4) → build messages for all returned tokens → chunk (max 100) → send via Expo API → bulk-deactivate invalid tokens → log batch metrics
  - Handle permanent Expo errors by marking job failed without retry
  - Handle transient errors via BullMQ retry mechanism
  - Wire processor into Worker instances in index.ts: transactional worker (`push:notifications`) uses single-user processor, broadcast worker (`push:broadcasts`) uses chunk processor. Both share the same token resolver and Expo client.
  - Verify worker builds with `pnpm --filter @surewaka/worker-push build`
  - **Requirements:** 2.2, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.4, 4.5, 7.2, 7.3, 8.1, 8.2

- [ ] 7. Push worker — health check endpoint
  - Create `workers/push-worker/src/health.ts` — minimal HTTP server (port from env PUSH_WORKER_HEALTH_PORT, default 4001)
  - Implement GET /health returning per-queue metrics: transactional queue depth + broadcast queue depth, jobs processed per minute (rolling 5-min window), failure rate per queue
  - Start health server in index.ts after worker initialization
  - **Requirements:** 8.5

- [ ] 8. Deep link router utility
  - Create `packages/mobile-shared/src/utils/deep-link-router.ts`
  - Implement navigateToDeepLink(data, router) — map notification type + resourceId to route using PUSH_DEEP_LINK_MAP. Includes `delivery_cancelled` → `/delivery/:resourceId` (same screen as delivery detail, shows cancellation/refund info).
  - For `payment_received`, navigate to `/wallet` — this is the **driver app's** wallet screen (payment_received targets driver tokens, so only the driver app receives this notification)
  - Handle broadcast custom URLs with internal route validation (Req 5.9)
  - Add try/catch with fallback to home screen for invalid targets (Req 5.10)
  - Export from packages/mobile-shared/src/index.ts
  - **Requirements:** 5.1-5.10

- [ ] 9. Notification banner component
  - Create `packages/mobile-shared/src/components/notification-banner.tsx`
  - Implement animated slide-in from top with safe area offset
  - Show title (1 line) and body (2 lines max) with tap and swipe-up-to-dismiss handlers
  - Style with white background, rounded corners, shadow
  - Export from packages/mobile-shared/src/index.ts
  - **Requirements:** 6.1, 6.2, 6.5

- [ ] 10. Push notifications hook (shared mobile hook)
  - Create `packages/mobile-shared/src/hooks/use-push-notifications.ts`
  - Implement permission request on mount when user is authenticated (use `useAuth().isSignedIn` from `@clerk/expo` to detect auth state)
  - Implement token registration with retry (3x exponential backoff from 1s). Use `useAuth().getToken()` to obtain the Clerk session token for API calls; pass to `apiClient` or `createAuthClient(token)`.
  - Configure foreground handler to suppress system alerts and sounds
  - Implement foreground notification listener with 5s auto-dismiss banner state
  - Implement notification response listener for tap → navigateToDeepLink
  - Implement cold-start notification handling via getLastNotificationResponseAsync
  - Implement deactivatePushToken export for logout flow with retry
  - Handle permission denied gracefully — no error UI
  - Add expo-notifications and expo-device as peer dependencies in packages/mobile-shared
  - **Requirements:** 1.1, 1.2, 1.5, 1.6, 2.1, 2.5, 2.6, 5.1, 5.2, 5.11, 6.1, 6.3, 6.4

- [ ] 11. Integrate push notifications into Customer App
  - Verify expo-notifications plugin is configured in apps/mobile-customer/app.json with icon and color
  - Add usePushNotifications({ app: 'customer' }) in _layout.tsx InnerLayout
  - Render NotificationBanner conditionally when banner state is non-null
  - Integrate deactivatePushToken into auth store signOut function
  - Add EXPO_PUBLIC_EAS_PROJECT_ID and EXPO_PUBLIC_API_URL to app env config
  - Verify app compiles with `pnpm --filter @surewaka/mobile-customer exec tsc --noEmit`
  - **Requirements:** 1.1, 2.1, 6.1, 6.2

- [ ] 12. Integrate push notifications into Driver App
  - **Prerequisite:** Driver app currently has NO Clerk integration in `_layout.tsx`. Add `ClerkProvider` wrapping the app (same pattern as customer app) before push can work. This may already be done in a parallel driver auth task — check before duplicating.
  - Add expo-notifications plugin to apps/mobile-driver/app.json with icon and brand color
  - Install expo-notifications and expo-device dependencies in driver app
  - Add usePushNotifications({ app: 'driver' }) in _layout.tsx (inside ClerkProvider context)
  - Render NotificationBanner conditionally when banner state is non-null
  - Add EXPO_PUBLIC_EAS_PROJECT_ID, EXPO_PUBLIC_API_URL, and EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to driver app env config
  - Verify app compiles with `pnpm --filter @surewaka/mobile-driver exec tsc --noEmit`
  - **Requirements:** 1.1, 2.1, 6.1, 6.2

- [ ] 13. Wire push triggers into delivery and payment handlers
  - Add enqueuePush calls in delivery status update handler for transitions (picked_up, en_route_dropoff, delivered) → notify customer
  - Add enqueuePush in cancellation handler (`POST /deliveries/:id/cancel`) → notify customer with `delivery_cancelled` (high priority). Use `deliveryId` as resourceId. Note: if the cancellation is initiated by the customer themselves, consider skipping the push (they already know); if triggered by driver/carrier/admin, always send.
  - Add enqueuePush in driver assignment handler → notify driver with delivery_assigned
  - Add enqueuePush in driver location update for arrival events → notify customer with driver_arrived. **Note:** No driver status transition endpoint exists yet (driver app is a placeholder). The push fires when delivery status transitions to `arrived_pickup` or `arrived_dropoff` — wire it into whatever handler performs that transition. If the status update route isn't built as part of this feature, leave a clearly marked integration point (exported function or comment) that the driver delivery flow can call when it's implemented. The trigger mechanism (manual "I've arrived" button vs. geofence) is out of scope for push notifications.
  - Add enqueuePush in escrow release handler → notify driver with payment_received (PUSH_APP_ROUTING resolves to 'driver' tokens — no override needed). Use `data.deliveryId` as resourceId (not escrow hold ID) — the delivery is the user-facing entity, and if a payment history screen is added later the delivery context is already in the payload.
  - Add enqueuePush in dispute creation → two calls: (1) notify sender via `enqueuePush(delivery.customerId, 'dispute_opened', payload, 'customer')`, (2) notify driver via `enqueuePush(driverUserId, 'dispute_opened', payload, 'driver')` only if `delivery.driverId` is non-null (resolve driver's user_id from drivers table). Skip the driver push entirely if no driver was assigned — pre-assignment disputes don't have a driver to notify.
  - Add enqueuePush in carrier verification → notify carrier admin with carrier_verified. Use the `carrierId` (UUID from route params) as resourceId — doesn't drive navigation today (deep links to `/`) but future-proofs for a carrier profile deep link. Resolve the carrier admin's userId via carrier_members table (role = 'carrier_admin').
  - Verify API builds with `pnpm --filter @surewaka/api build`
  - **Requirements:** 3.1, 3.9, 10.2, 10.3, 10.5, 10.6

- [ ] 14. Admin broadcast API route and UI
  - Create `apps/api/src/routes/admin/broadcast.ts` — POST /api/v1/admin/broadcast and GET /api/v1/admin/broadcast/estimate
  - Validate with broadcastSchema, check surewaka_admin role, call enqueueBroadcast
  - Register route in apps/api/src/index.ts
  - Create `apps/admin/app/routes/notifications.broadcast.tsx` — form with title, body, segment (radio: All Users / Customers / Drivers). **City dropdown deferred** — field hidden in UI for now; backend schema accepts `city` optionally but ignores it until user profiles have city. Add deep link URL field (optional).
  - Implement character counters, estimate button, confirmation modal, dispatch with error handling
  - Gate access to surewaka_admin role
  - **Requirements:** 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7

- [ ] 15. Deep link deferred navigation for expired sessions
  - Store intended deep link in AsyncStorage when notification is tapped and session is expired
  - Check for stored deep link after successful re-authentication and navigate
  - Clear stored deep link after navigation or after 15 minute timeout (not 5 — Nigerian 3G networks + OTP delays + possible app-switch can easily consume 5 minutes; stale links are safely handled by Req 5.10 fallback)
  - **Requirements:** 5.11

- [ ] 16. Notification preference toggle in mobile profile settings
  - **Customer app:** Add notification_push toggle to existing `apps/mobile-customer/app/profile/settings.tsx`
  - **Driver app:** Add notification_push toggle to existing `apps/mobile-driver/app/(tabs)/profile.tsx` (the profile tab is currently a placeholder — add the toggle inline, gated on auth state; no separate settings route needed)
  - Wire toggle to profile update API endpoint (PATCH /api/v1/profile)
  - Ensure profile update route handles notificationPush field
  - Add notificationPush to ProfilePreferencesUpdate type in packages/shared
  - **Requirements:** 4.1, 4.2, 4.3, 4.6

- [ ] 17. Environment variables and documentation
  - Add REDIS_URL, PUSH_WORKER_CONCURRENCY, PUSH_WORKER_HEALTH_PORT to .env.example
  - Add EXPO_PUBLIC_EAS_PROJECT_ID to .env.example
  - Add push-worker dev/start scripts to root turbo.json pipeline
  - Update infra/docker/docker-compose.yml if needed (ensure Redis service exists)
  - Add push-worker to commands table in AGENTS.md and README.md
  - **Requirements:** —

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Foundation",
      "tasks": [1, 2],
      "description": "Database migration and shared types/validators"
    },
    {
      "name": "Backend Core",
      "tasks": [3, 4, 5, 9],
      "description": "Token API, push service, worker setup, banner component (parallelizable)"
    },
    {
      "name": "Worker & Mobile Logic",
      "tasks": [6, 7, 8, 10],
      "description": "Worker processor, health check, deep link router, push hook"
    },
    {
      "name": "App Integration",
      "tasks": [11, 12, 13, 14, 16],
      "description": "Customer/driver app integration, trigger wiring, admin broadcast, preferences"
    },
    {
      "name": "Polish",
      "tasks": [15, 17],
      "description": "Deferred deep links for expired sessions, env vars and documentation"
    }
  ]
}
```

**Critical path:** 1 → 2 → 4 → 5 → 6 (backend delivery pipeline)

**Parallelizable tracks after Wave 1:**
- Track A (Backend): 3, 4, 5, 6, 7, 13
- Track B (Mobile): 8, 9, 10, 11, 12, 15
- Track C (Admin): 14

## Notes

- Tasks 1 creates the migration file but does NOT apply it — that's done via Supabase dashboard or CI pipeline per project workflow.
- Task 5 requires Redis running locally (via docker-compose).
- Tasks 11 and 12 can only be fully tested on physical devices (Expo push tokens aren't generated in simulators).
- Task 13 depends on identifying the exact handler locations — these may need investigation if delivery/payment handlers have changed since this spec was written.
- **Auth migration (Supabase → Clerk + Neon):** The project migrated to Clerk for auth and Neon for Postgres. Key implications: (1) `requireAuth` middleware resolves Clerk token → internal UUID automatically via `users.clerk_id` column — `c.get('user').id` is the internal UUID used in all FKs. (2) No RLS on Neon — authorization is application-level. (3) Mobile apps use `@clerk/expo` with `useAuth().getToken()` for API calls. (4) Realtime is now Ably (`packages/realtime`), complementary to push notifications. (5) Driver app does NOT have ClerkProvider yet — needs adding before push integration.
- **Design doc correction:** The design document's `PUSH_APP_ROUTING` constant incorrectly shows `payment_received: 'customer'`. The correct routing is `payment_received: 'driver'` — payment received notifications inform the driver that their escrow has been released. If a customer refund notification is ever needed, a separate `payment_refunded` type should be added rather than overloading `payment_received`. Requirement 10.2 should be read as targeting "driver" tokens for `payment_received`.
- **resourceId convention:** The payload schema requires `resourceId` on all notifications (non-optional, min 1 char). For types that don't navigate to a specific resource screen, pass a meaningful entity ID for logging/analytics: `payment_received` uses the `deliveryId` (from escrow release job data), `carrier_verified` uses the `carrierId` (from route params). This avoids sentinel values and future-proofs for deeper deep links.
- **Broadcast scaling (batch-per-chunk):** Broadcasts use chunk jobs (`{ userIds: string[500], payload, segment }`) not 1 job per user. At 520K users this yields ~1,040 jobs instead of 520K. The worker resolves tokens for the full chunk in a single DB query and sends to Expo in batches of 100. Preference filtering (`notification_push`) happens entirely at token resolution time in the worker — broadcast jobs enqueue unconditionally by segment. The `getBroadcastEstimate` endpoint still filters by preference to show admins accurate recipient counts.
- **Broadcast segment → token filter (Req 10.4 clarification):** Req 10.4 ("deliver to all tokens regardless of app field") applies ONLY when `segment = 'all'`. For `segment = 'customers'`, only customer-app tokens are delivered to. For `segment = 'drivers'`, only driver-app tokens. This prevents a customer promo from appearing on a dual-user's driver app. The segment determines both user selection (who's in the audience) and token selection (which app receives it).
- **`delivery_cancelled` type added:** Separate from `delivery_status_change` because cancellations are higher urgency (money involved, refund pending), deserve distinct copy, and may need different preference handling later. Routes to `'customer'` app, high priority, deep links to `/delivery/:resourceId`. `booking_confirmed` was considered but deferred — no async carrier acceptance flow exists yet (booking is synchronous today).
- **City broadcast filter deferred:** The admin broadcast form ships without a city dropdown. No `city` column exists on the users table (only on deliveries), and SureWaka launches Lagos-only so "all customers" ≈ "Lagos customers" at launch. The `broadcastSchema` still accepts `city?: string` for forward-compatibility; the API ignores it until user profiles gain a city field in a future profile management pass.
- **Separate queues for transactional vs broadcast:** `push:notifications` handles time-sensitive individual pushes (delivery updates, payment, disputes). `push:broadcasts` handles chunk jobs. Same worker process, separate Worker instances. This prevents a 1,040-chunk broadcast from delaying a driver_arrived push, and gives independent observability per queue (depth, throughput, failure rate visible separately in health endpoint).

## Push Trigger Map (Task 13 reference)

### Delivery status transitions → push

| Transition | Push type | Recipient | App | Priority |
|---|---|---|---|---|
| `pending` → `accepted` | `delivery_assigned` | Driver | driver | normal |
| `*` → `arrived_pickup` | `driver_arrived` | Customer | customer | high |
| `*` → `picked_up` | `delivery_status_change` | Customer | customer | high |
| `*` → `en_route_dropoff` | `delivery_status_change` | Customer | customer | high |
| `*` → `arrived_dropoff` | `driver_arrived` | Customer | customer | high |
| `*` → `delivered` | `delivery_status_change` | Customer | customer | high |
| `*` → `cancelled` | `delivery_cancelled` | Customer | customer | high |

### Non-status-transition events → push

| Event | Push type | Recipient | App | Priority |
|---|---|---|---|---|
| Escrow released | `payment_received` | Driver | driver | normal |
| Dispute opened | `dispute_opened` | Customer + Driver (if assigned) | customer / driver | normal |
| Carrier verified | `carrier_verified` | Carrier admin | driver | normal |
| Admin broadcast | `broadcast` | Segment | per segment | normal |

### Transitions that do NOT fire a push

| Transition | Reason |
|---|---|
| `draft` → `pending` | Customer-initiated (booking confirm) — they already know |
| `pending` → `en_route_pickup` | Low-signal intermediate step after assignment |
| `*` → `failed` | Edge case, handled by ops dashboard and in-app notification |
| `*` → `returned` | Edge case, low volume, covered by ops dashboard |
