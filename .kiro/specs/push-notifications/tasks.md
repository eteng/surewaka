# Implementation Plan: Push Notifications

## Overview

This plan implements push notifications for SureWaka's mobile apps (customer and driver) using Expo Push Notifications, a BullMQ push-worker, multi-device token management, deep linking, and admin broadcast. Implementation proceeds from foundation (DB, types) through backend (API, worker) to mobile integration and admin UI.

## Tasks

- [ ] 1. Database migration — push_tokens table and users.notification_push column
  - Create migration file `supabase/migrations/<timestamp>_push_tokens.sql`
  - Add `push_tokens` table with columns: id (UUID PK), user_id (FK → users), expo_push_token (TEXT UNIQUE), device_id (TEXT), platform (TEXT CHECK ios/android), app (TEXT CHECK customer/driver), is_active (BOOLEAN DEFAULT true), created_at, updated_at
  - Add partial indexes: idx_push_tokens_user_active and idx_push_tokens_user_app_active
  - Enable RLS with policies: service_role_manage_push_tokens and users_manage_own_tokens
  - GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO authenticated
  - Add `notification_push BOOLEAN DEFAULT true NOT NULL` column to users table
  - Run `pnpm --filter @surewaka/db db:pull` to regenerate Drizzle schema
  - **Requirements:** 1.3, 2.3, 4.1, 10.1

- [ ] 2. Shared types, validators, and constants for push notifications
  - Add `PushNotificationType`, `PushTargetApp`, `PushNotificationPayload`, `PushJobData`, `PushTokenRecord` types to `packages/shared/src/types.ts`
  - Add `registerPushTokenSchema`, `pushNotificationPayloadSchema`, `broadcastSchema` to `packages/shared/src/validators.ts`
  - Add push constants to `packages/shared/src/constants.ts`: PUSH_NOTIFICATION_TYPES, PUSH_TARGET_APPS, HIGH_PRIORITY_PUSH_TYPES, PUSH_DEEP_LINK_MAP, PUSH_APP_ROUTING, MAX_PUSH_TOKENS_PER_USER_PER_APP, PUSH_BATCH_SIZE, PUSH_MAX_RETRIES, PUSH_RETRY_BASE_MS, PUSH_QUEUE_NAME, PUSH_BROADCAST_BATCH_SIZE
  - Export all new types, schemas, and constants from `packages/shared/src/index.ts`
  - Verify build passes with `pnpm --filter @surewaka/shared build`
  - **Requirements:** 9.1, 9.3, 9.5, 10.2-10.6

- [ ] 3. Push token API routes (register and deactivate)
  - Create `apps/api/src/routes/push-tokens.ts` with Hono router
  - Implement `POST /` — validate body with registerPushTokenSchema, extract user_id from JWT, upsert token with ON CONFLICT DO UPDATE
  - Implement token limit enforcement: count active tokens for (user_id, app), if >= 10 deactivate oldest
  - Implement `DELETE /:token` — set is_active = false WHERE expo_push_token = :token AND user_id = auth user (idempotent)
  - Register route in `apps/api/src/index.ts` at `/api/v1/push-tokens`
  - Verify API builds with `pnpm --filter @surewaka/api build`
  - **Requirements:** 1.2, 1.3, 1.4, 1.7, 2.1, 2.3

- [ ] 4. Push service — enqueue logic with preference checks and app routing
  - Create `apps/api/src/services/push-service.ts`
  - Implement `enqueuePush(userId, type, payload, targetAppOverride?)` — validate payload, check user notification_push preference, determine target app from PUSH_APP_ROUTING, determine priority, add job to BullMQ queue
  - Implement `enqueueBroadcast(segment, payload, city?)` — paginate through eligible users in batches of 500, enqueue individual push jobs
  - Implement `getBroadcastEstimate(segment, city?)` — query count of eligible users
  - Initialize BullMQ Queue connection using REDIS_URL environment variable
  - Verify build passes with `pnpm --filter @surewaka/api build`
  - **Requirements:** 3.1, 3.9, 4.2, 4.3, 7.2, 7.3, 7.5, 9.1, 9.3, 9.5, 10.2-10.7

- [ ] 5. Push worker — package setup and BullMQ consumer
  - Create `workers/push-worker/package.json` with dependencies: bullmq, expo-server-sdk, ioredis, @surewaka/db, @surewaka/shared
  - Create `workers/push-worker/tsconfig.json` extending root config
  - Create `workers/push-worker/src/index.ts` — initialize Worker with configurable concurrency (env PUSH_WORKER_CONCURRENCY, default 5), handle Redis connection events with reconnect backoff (max 10 attempts then exit non-zero)
  - Create `workers/push-worker/src/expo-client.ts` — export singleton Expo instance
  - Add @surewaka/worker-push to root pnpm-workspace.yaml and turbo.json
  - Verify worker builds with `pnpm --filter @surewaka/worker-push build`
  - **Requirements:** 8.3, 8.4, 8.6

- [ ] 6. Push worker — token resolver and job processor
  - Create `workers/push-worker/src/token-resolver.ts` — implement resolveTokens(userId, targetApp) with preference check and app filter
  - Create `workers/push-worker/src/processor.ts` — resolve tokens → build ExpoPushMessages → chunk (max 100) → send via Expo API → process tickets (deactivate DeviceNotRegistered/InvalidCredentials tokens) → log batch metrics
  - Handle permanent Expo errors by marking job failed without retry
  - Handle transient errors via BullMQ retry mechanism
  - Wire processor into Worker instance in index.ts
  - Verify worker builds with `pnpm --filter @surewaka/worker-push build`
  - **Requirements:** 2.2, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.4, 4.5, 8.1, 8.2

- [ ] 7. Push worker — health check endpoint
  - Create `workers/push-worker/src/health.ts` — minimal HTTP server (port from env PUSH_WORKER_HEALTH_PORT, default 4001)
  - Implement GET /health returning queue depth, jobs processed per minute (rolling 5-min window), failure rate
  - Start health server in index.ts after worker initialization
  - **Requirements:** 8.5

- [ ] 8. Deep link router utility
  - Create `packages/mobile-shared/src/utils/deep-link-router.ts`
  - Implement navigateToDeepLink(data, router) — map notification type + resourceId to route using PUSH_DEEP_LINK_MAP
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
  - Implement permission request on mount when user is authenticated
  - Implement token registration with retry (3x exponential backoff from 1s)
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
  - Add expo-notifications plugin to apps/mobile-driver/app.json with icon and brand color
  - Install expo-notifications and expo-device dependencies in driver app
  - Add usePushNotifications({ app: 'driver' }) in _layout.tsx
  - Render NotificationBanner conditionally when banner state is non-null
  - Add EXPO_PUBLIC_EAS_PROJECT_ID and EXPO_PUBLIC_API_URL to driver app env config
  - Verify app compiles with `pnpm --filter @surewaka/mobile-driver exec tsc --noEmit`
  - **Requirements:** 1.1, 2.1, 6.1, 6.2

- [ ] 13. Wire push triggers into delivery and payment handlers
  - Add enqueuePush calls in delivery status update handler for transitions (picked_up, en_route_dropoff, delivered) → notify customer
  - Add enqueuePush in driver assignment handler → notify driver with delivery_assigned
  - Add enqueuePush in driver location update for arrival events → notify customer with driver_arrived
  - Add enqueuePush in escrow release handler → notify driver with payment_received
  - Add enqueuePush in dispute creation → notify sender (customer app) and driver (driver app)
  - Add enqueuePush in carrier verification → notify carrier admin with carrier_verified
  - Verify API builds with `pnpm --filter @surewaka/api build`
  - **Requirements:** 3.1, 3.9, 10.2, 10.3, 10.5, 10.6

- [ ] 14. Admin broadcast API route and UI
  - Create `apps/api/src/routes/admin/broadcast.ts` — POST /api/v1/admin/broadcast and GET /api/v1/admin/broadcast/estimate
  - Validate with broadcastSchema, check surewaka_admin role, call enqueueBroadcast
  - Register route in apps/api/src/index.ts
  - Create `apps/admin/app/routes/notifications.broadcast.tsx` — form with title, body, segment, city, deep link URL
  - Implement character counters, estimate button, confirmation modal, dispatch with error handling
  - Gate access to surewaka_admin role
  - **Requirements:** 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7

- [ ] 15. Deep link deferred navigation for expired sessions
  - Store intended deep link in AsyncStorage when notification is tapped and session is expired
  - Check for stored deep link after successful re-authentication and navigate
  - Clear stored deep link after navigation or after 5 minute timeout
  - **Requirements:** 5.11

- [ ] 16. Notification preference toggle in mobile profile settings
  - Add notification_push toggle to profile settings screen in customer and driver apps
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
