# Technical Design Document

## Overview

Push notifications for SureWaka's mobile applications (customer and driver), enabling real-time delivery status updates, driver alerts, payment confirmations, and admin broadcast messages. The system uses Expo Push Notifications (abstracting FCM/APNs), a BullMQ push-worker for batched delivery, multi-device token management, deep linking to relevant screens, and an admin broadcast capability for targeted user segments.

**Key technology choices:**
- **Transport**: Expo Push Notifications (no separate Firebase project needed)
- **Queue**: BullMQ on Redis (consistent with existing email-worker pattern)
- **Server SDK**: `expo-server-sdk` for batch sending and receipt handling
- **Mobile**: `expo-notifications` (already in customer app.json, needs adding to driver)
- **Token storage**: Dedicated `push_tokens` table (multi-device, multi-app)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MOBILE CLIENTS                                      │
│  ┌──────────────────────┐         ┌──────────────────────┐                  │
│  │  Customer_App        │         │  Driver_App          │                  │
│  │  (expo-notifications)│         │  (expo-notifications)│                  │
│  │  ┌────────────────┐  │         │  ┌────────────────┐  │                  │
│  │  │Notification_Hook│  │         │  │Notification_Hook│  │                  │
│  │  │+ Deep_Link_Router│ │         │  │+ Deep_Link_Router│ │                  │
│  │  └────────────────┘  │         │  └────────────────┘  │                  │
│  └──────────┬───────────┘         └──────────┬───────────┘                  │
└─────────────┼────────────────────────────────┼──────────────────────────────┘
              │ POST/DELETE /api/v1/push-tokens │
              ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API SERVER (Hono)                                   │
│  ┌──────────────────┐   ┌──────────────────┐   ┌───────────────────────┐   │
│  │ push-tokens.ts   │   │ push-service.ts  │   │ admin/broadcast.ts   │   │
│  │ (CRUD routes)    │   │ (enqueue jobs)   │   │ (admin broadcast)    │   │
│  └────────┬─────────┘   └────────┬─────────┘   └───────────┬───────────┘   │
└───────────┼──────────────────────┼──────────────────────────┼───────────────┘
            │                      │                          │
            ▼                      ▼                          ▼
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│   Supabase PG      │   │     Redis          │   │     Redis          │
│   (push_tokens)    │   │  (push:queue)      │   │  (push:queue)      │
└────────────────────┘   └─────────┬──────────┘   └────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PUSH WORKER (BullMQ)                                  │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────────────┐       │
│  │ Job Consumer  │──│ Token Resolver │──│ Expo Push API Client     │       │
│  │ (concurrency:5)│  │ (DB query)     │  │ (batch ≤100, retry 3x)  │       │
│  └───────────────┘  └────────────────┘  └──────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. Mobile app registers Expo push token → API stores in `push_tokens` table
2. Business event occurs (delivery status change, payment, etc.) → API enqueues push job to Redis
3. Push Worker dequeues job → resolves user's active tokens → batches and sends via Expo Push API
4. Expo Push API routes to FCM/APNs → device receives notification
5. Mobile app handles tap → Deep Link Router navigates to correct screen


## Components and Interfaces

### 1. Push Token Registry (`apps/api/src/routes/push-tokens.ts`)

REST endpoints for token lifecycle management.

| Method | Path | Auth | Description | Requirements |
|--------|------|------|-------------|--------------|
| POST | `/api/v1/push-tokens` | requireAuth | Register/upsert push token | 1.2, 1.3, 1.4, 1.7 |
| DELETE | `/api/v1/push-tokens/:token` | requireAuth | Deactivate token (logout) | 2.1 |

**POST /api/v1/push-tokens** — Request body:
```typescript
{
  expoPushToken: string;  // "ExponentPushToken[xxxx]"
  deviceId: string;       // Device fingerprint
  platform: 'ios' | 'android';
  app: 'customer' | 'driver';
}
```

Logic:
1. Validate with `registerPushTokenSchema`
2. Upsert: `INSERT ... ON CONFLICT (expo_push_token) DO UPDATE`
3. Enforce max 10 tokens per user per app (deactivate oldest if exceeded)
4. Return `201` (created) or `200` (updated)

**DELETE /api/v1/push-tokens/:token** — Sets `is_active = false` where token belongs to authed user. Idempotent.

### 2. Push Service (`apps/api/src/services/push-service.ts`)

Central service for enqueueing push notification jobs.

```typescript
interface PushServiceInterface {
  /**
   * Enqueue a push for a single user. Checks preference before enqueueing.
   * Requirements: 3.1, 3.9, 4.2, 4.3, 9.1, 9.5, 10.2-10.7
   */
  enqueuePush(
    userId: string,
    type: PushNotificationType,
    payload: PushNotificationPayload,
    targetAppOverride?: PushTargetApp
  ): Promise<boolean>;

  /**
   * Enqueue broadcast jobs in batches of 500.
   * Requirements: 7.2, 7.3
   */
  enqueueBroadcast(
    segment: 'all' | 'customers' | 'drivers',
    payload: PushNotificationPayload,
    city?: string
  ): Promise<{ enqueued: number; failed: number }>;

  /**
   * Get estimated recipient count for broadcast confirmation UI.
   * Requirements: 7.5
   */
  getBroadcastEstimate(
    segment: 'all' | 'customers' | 'drivers',
    city?: string
  ): Promise<number>;
}
```

`enqueuePush` flow:
1. Validate payload with `pushNotificationPayloadSchema`
2. Query user's `notification_push` preference — skip if false
3. Determine target app from `PUSH_APP_ROUTING` map (or override)
4. Determine priority (high for `delivery_status_change`, `driver_arrived`)
5. Add job to BullMQ queue with retry config

### 3. Push Worker (`workers/push-worker/`)

BullMQ worker consuming from `push:notifications` queue.

```
workers/push-worker/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # Worker startup + health server
    ├── processor.ts      # Job processing logic
    ├── expo-client.ts    # Expo Push API wrapper
    ├── token-resolver.ts # DB queries for user → tokens
    └── health.ts         # Health check HTTP endpoint (:4001)
```

**Dependencies:** `bullmq`, `expo-server-sdk`, `ioredis`, `@surewaka/db`, `@surewaka/shared`

**Job processor logic:**
```typescript
async function processJob(job: Job<PushJobData>): Promise<void> {
  const { userId, targetApp, payload, priority } = job.data;

  // 1. Resolve tokens (checks preference + active + app filter)
  const tokens = await resolveTokens(userId, targetApp);
  if (tokens.length === 0) return; // Req 3.7

  // 2. Build Expo messages
  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.expoPushToken,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: 'default',
    priority: priority === 'high' ? 'high' : 'normal',
  }));

  // 3. Chunk (max 100) and send
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    // Handle DeviceNotRegistered → deactivate token (Req 2.2)
    // Log batch metrics (Req 8.2)
  }
}
```

**Worker configuration:**
- Concurrency: configurable (env `PUSH_WORKER_CONCURRENCY`, default 5)
- Retry: 3 attempts, exponential backoff (1s, 2s, 4s)
- Dead-letter: failed jobs preserved with payload + error reason
- Health: HTTP endpoint at configurable port (default 4001)

### 4. Notification Hook (`packages/mobile-shared/src/hooks/use-push-notifications.ts`)

Shared React Native hook used by both mobile apps.

```typescript
type UsePushNotificationsReturn = {
  banner: { title: string; body: string; data: PushNotificationData } | null;
  dismissBanner: () => void;
  onBannerTap: () => void;
};

function usePushNotifications(options: { app: 'customer' | 'driver' }): UsePushNotificationsReturn;
```

**Responsibilities:**
- Configure foreground handler (suppress system alert, show banner)
- Register token on auth (request permissions → get token → POST to API)
- Listen for foreground notifications → show in-app banner (5s auto-dismiss)
- Listen for notification taps → delegate to Deep Link Router
- Handle cold-start notification (app was terminated)
- Expose `deactivatePushToken` for logout flow

### 5. Deep Link Router (`packages/mobile-shared/src/utils/deep-link-router.ts`)

Maps notification data to in-app navigation.

```typescript
function navigateToDeepLink(data: PushNotificationData, router: Router): void;
```

**Route mapping:**
| type | Route | Notes |
|------|-------|-------|
| `delivery_status_change` | `/delivery/:resourceId` | Customer app |
| `driver_arrived` | `/tracking/:resourceId` | Customer app |
| `payment_received` | `/wallet` | Driver app |
| `dispute_opened` | `/delivery/:resourceId/dispute` | Both apps |
| `delivery_assigned` | `/delivery/:resourceId` | Driver app |
| `carrier_verified` | `/` | Driver app |
| `broadcast` | Custom `deepLink` if internal; else `/` | Both apps |

**Safety:** Validates broadcast deep links against registered internal routes before navigating. Falls back to home screen for invalid targets (Req 5.9, 5.10).

### 6. Notification Banner (`packages/mobile-shared/src/components/notification-banner.tsx`)

In-app banner component for foreground notifications.

- Slides in from top with animation
- Shows title + body (1 line title, 2 lines body)
- Tap → navigate to deep link (Req 6.2)
- Swipe up → dismiss (Req 6.5)
- Auto-dismiss after 5 seconds (Req 6.1)
- New notification replaces current banner and resets timer (Req 6.4)

### 7. Admin Broadcast UI (`apps/admin/app/routes/notifications.broadcast.tsx`)

React Router v7 route for admin push broadcast.

**Form fields:**
- Title (text, max 100 chars, with counter)
- Body (textarea, max 500 chars, with counter)
- Segment (radio: All Users / Customers / Drivers)
- City (dropdown, optional — from `SUPPORTED_CITIES`)
- Deep Link URL (text, optional, max 2048)

**Flow:** Form → Validate → Estimate recipients → Confirm modal → Dispatch → Success/Error

### 8. Integration Points

Where `enqueuePush` is called from existing handlers:

| File | Trigger | Push Type |
|------|---------|-----------|
| `routes/deliveries.ts` (status update) | Delivery transitions | `delivery_status_change` |
| `routes/deliveries.ts` (assignment) | Driver assigned | `delivery_assigned` |
| `routes/deliveries.ts` (location) | Driver at pickup/dropoff | `driver_arrived` |
| `services/payment-service.ts` (release) | Escrow released | `payment_received` |
| `routes/deliveries.ts` (dispute) | Dispute opened | `dispute_opened` |
| `routes/admin/carriers.ts` (verify) | Carrier approved | `carrier_verified` |
| `routes/admin/broadcast.ts` | Admin action | `broadcast` |


## Data Models

### New Table: `push_tokens`

```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  app TEXT NOT NULL CHECK (app IN ('customer', 'driver')),
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(expo_push_token)
);

CREATE INDEX idx_push_tokens_user_active
  ON push_tokens(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_push_tokens_user_app_active
  ON push_tokens(user_id, app, is_active) WHERE is_active = true;

-- RLS
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_manage_push_tokens" ON push_tokens
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "users_manage_own_tokens" ON push_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO authenticated;
```

### Users Table Alteration

```sql
ALTER TABLE users ADD COLUMN notification_push BOOLEAN DEFAULT true NOT NULL;
```

### Shared Types (`packages/shared/src/types.ts`)

```typescript
export type PushNotificationType =
  | 'delivery_status_change'
  | 'driver_arrived'
  | 'payment_received'
  | 'dispute_opened'
  | 'delivery_assigned'
  | 'carrier_verified'
  | 'broadcast';

export type PushTargetApp = 'customer' | 'driver';

export type PushNotificationPayload = {
  title: string;
  body: string;
  data: {
    type: PushNotificationType;
    resourceId: string;
    deepLink: string;
    metadata?: Record<string, unknown>;
  };
};

export type PushJobData = {
  userId: string;
  targetApp: PushTargetApp | 'all';
  payload: PushNotificationPayload;
  priority: 'high' | 'normal';
};

export type PushTokenRecord = {
  id: string;
  userId: string;
  expoPushToken: string;
  deviceId: string;
  platform: 'ios' | 'android';
  app: PushTargetApp;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
```

### Shared Validators (`packages/shared/src/validators.ts`)

```typescript
export const PUSH_NOTIFICATION_TYPES = [
  'delivery_status_change', 'driver_arrived', 'payment_received',
  'dispute_opened', 'delivery_assigned', 'carrier_verified', 'broadcast',
] as const;

export const registerPushTokenSchema = z.object({
  expoPushToken: z.string().min(1).startsWith('ExponentPushToken['),
  deviceId: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  app: z.enum(['customer', 'driver']),
});

export const pushNotificationPayloadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  data: z.object({
    type: z.enum(PUSH_NOTIFICATION_TYPES),
    resourceId: z.string().min(1),
    deepLink: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const broadcastSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  segment: z.enum(['all', 'customers', 'drivers']),
  city: z.string().optional(),
  deepLink: z.string().url().max(2048).optional(),
});
```

### Shared Constants (`packages/shared/src/constants.ts`)

```typescript
export const PUSH_NOTIFICATION_TYPES = [
  'delivery_status_change', 'driver_arrived', 'payment_received',
  'dispute_opened', 'delivery_assigned', 'carrier_verified', 'broadcast',
] as const;

export const PUSH_TARGET_APPS = ['customer', 'driver'] as const;

export const HIGH_PRIORITY_PUSH_TYPES: PushNotificationType[] = [
  'delivery_status_change', 'driver_arrived',
];

export const PUSH_DEEP_LINK_MAP: Record<PushNotificationType, string> = {
  delivery_status_change: '/delivery/:resourceId',
  driver_arrived: '/tracking/:resourceId',
  payment_received: '/wallet',
  dispute_opened: '/delivery/:resourceId/dispute',
  delivery_assigned: '/delivery/:resourceId',
  carrier_verified: '/',
  broadcast: '/:deepLink',
};

export const PUSH_APP_ROUTING: Record<PushNotificationType, PushTargetApp | 'all'> = {
  delivery_status_change: 'customer',
  driver_arrived: 'customer',
  payment_received: 'customer',
  dispute_opened: 'customer', // overridden contextually for driver
  delivery_assigned: 'driver',
  carrier_verified: 'driver',
  broadcast: 'all',
};

export const MAX_PUSH_TOKENS_PER_USER_PER_APP = 10;
export const PUSH_BATCH_SIZE = 100;
export const PUSH_MAX_RETRIES = 3;
export const PUSH_RETRY_BASE_MS = 1000;
export const PUSH_QUEUE_NAME = 'push:notifications';
export const PUSH_BROADCAST_BATCH_SIZE = 500;
```

### BullMQ Job Schema

```typescript
// Job added to queue via pushQueue.add('push', jobData)
type PushJobData = {
  userId: string;                    // Target user
  targetApp: 'customer' | 'driver' | 'all'; // Which app tokens to resolve
  payload: {
    title: string;                   // Notification title (≤100 chars)
    body: string;                    // Notification body (≤500 chars)
    data: {
      type: PushNotificationType;    // Event type
      resourceId: string;            // Entity ID (delivery, wallet, etc.)
      deepLink: string;              // Navigation target
      metadata?: Record<string, unknown>; // Optional extra data (≤4KB)
    };
  };
  priority: 'high' | 'normal';      // Maps to Expo/APNs priority
};

// BullMQ job options
{
  priority: 1 | 5,              // 1 = high, 5 = normal
  attempts: 3,                   // Max retries
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,        // Keep last 1000 completed
  removeOnFail: false,           // Preserve in DLQ
}
```


## Correctness Properties

### Property 1: Token Uniqueness

A given `expo_push_token` string exists at most once in the `push_tokens` table (enforced by UNIQUE constraint). Re-registration from a different user reassigns the token.

**Validates: Requirements 1.3, 1.4**

### Property 2: Preference Consistency

If `users.notification_push = false` for a user, no push notification shall be delivered to that user. This is enforced at two levels: (a) `enqueuePush` checks before enqueueing, (b) `resolveTokens` re-checks at delivery time for jobs already in-flight.

**Validates: Requirements 4.2, 4.4, 4.5**

### Property 3: App Routing Correctness

For any notification type T in `PUSH_APP_ROUTING`, tokens resolved for delivery must match the target app value. Broadcast (target `'all'`) is the only type that delivers to both app token sets.

**Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6**

### Property 4: Payload Round-Trip

`JSON.parse(JSON.stringify(payload))` deep-equals `payload` for all valid `PushNotificationPayload` instances. This guarantees Redis serialization doesn't corrupt data.

**Validates: Requirements 9.4**

### Property 5: Token Limit Invariant

For any (user_id, app) pair, the count of active tokens (`is_active = true`) never exceeds `MAX_PUSH_TOKENS_PER_USER_PER_APP` (10). Oldest tokens are deactivated on overflow.

**Validates: Requirements 2.3**

### Property 6: Idempotent Deactivation

Calling `DELETE /api/v1/push-tokens/:token` multiple times produces the same result (token is inactive). No error on re-deactivation.

**Validates: Requirements 2.1**

### Property 7: Dead-Letter Preservation

Every job that fails after 3 attempts remains in the BullMQ dead-letter queue with its original payload, failure reason, and timestamps. No data loss on permanent failure.

**Validates: Requirements 8.1**

## Error Handling

| Scenario | Component | Handling | Requirements |
|----------|-----------|----------|--------------|
| Expo `DeviceNotRegistered` | Push Worker | Deactivate token, don't retry job for that token | 2.2 |
| Expo `InvalidCredentials` | Push Worker | Deactivate token, log error | 2.2 |
| Expo rate limit (429) | Push Worker | Retry with backoff (1s, 2s, 4s) | 3.6 |
| Expo 5xx server error | Push Worker | Retry with backoff | 3.6 |
| Expo `MessageTooBig` | Push Worker | Mark job failed, no retry | 3.8 |
| No active tokens for user | Push Worker | Complete job with "no_active_tokens" status | 3.7 |
| User preference = false | Push Worker | Skip delivery, complete job | 3.3, 4.4 |
| Redis connection lost | Push Worker | Reconnect with backoff (max 10 attempts, then exit) | 8.4, 8.6 |
| Invalid payload at enqueue | Push Service | Reject before enqueueing, return validation error | 9.5 |
| Token registration network failure | Notification Hook | Retry 3x with exponential backoff | 1.6 |
| Token deactivation failure on logout | Notification Hook | Retry 3x, then allow logout to proceed | 2.6 |
| Permission denied by OS | Notification Hook | Continue without push, no error UI | 1.5 |
| Deep link target unavailable | Deep Link Router | Navigate to home, show informational toast | 5.10 |
| Broadcast batch enqueue failure | Admin Broadcast | Halt, report progress, allow retry | 7.7 |
| Unauthorized broadcast attempt | Admin Broadcast | Deny access with error message | 7.6 |

## Testing Strategy

### Unit Tests

| Component | Test Focus | Location |
|-----------|-----------|----------|
| `push-service.ts` | Payload validation, preference check, routing logic, batch calculation | `apps/api/src/services/__tests__/push-service.test.ts` |
| `token-resolver.ts` | Active token filtering, app-based filtering, preference exclusion | `workers/push-worker/src/__tests__/token-resolver.test.ts` |
| `processor.ts` | Job processing flow, error handling, token deactivation | `workers/push-worker/src/__tests__/processor.test.ts` |
| `deep-link-router.ts` | Route mapping, internal URL validation, fallback behavior | `packages/mobile-shared/src/__tests__/deep-link-router.test.ts` |
| Validators | Schema validation edge cases | `packages/shared/src/__tests__/push-validators.test.ts` |

### Integration Tests

| Scenario | What's Tested |
|----------|--------------|
| Token registration → delivery | Full flow: register token, trigger event, verify Expo API called with correct token |
| Preference opt-out | Update preference, trigger event, verify no Expo call made |
| Token deactivation on DeviceNotRegistered | Send to invalid token, verify token marked inactive in DB |
| Broadcast dispatch | Admin submits broadcast, verify correct number of jobs enqueued per segment |
| Multi-device delivery | Register 3 tokens for 1 user, verify all receive the push |
| App routing isolation | User has both apps, verify customer event only hits customer tokens |

### Property-Based Tests

- **Payload round-trip**: For any randomly generated valid payload, `JSON.parse(JSON.stringify(payload))` deep-equals the original.
- **Token limit**: After N registrations for the same (user, app), active count never exceeds 10.

### Manual/E2E Tests

- Physical device: verify actual push delivery on iOS and Android
- Deep linking: tap notification in background/killed state → correct screen
- Foreground banner: receive notification while app is open → banner appears and dismisses
- Admin broadcast: send to "all customers" → verify delivery on test device

## Security Considerations

1. **Token registration** — authenticated endpoint, user_id from JWT (not request body)
2. **Token deactivation** — users can only deactivate their own tokens (WHERE user_id = auth.uid())
3. **Admin broadcast** — role-gated to `surewaka_admin` only
4. **RLS** — service role for worker DB access, users manage own rows only
5. **Deep link validation** — broadcast deep links validated against internal routes
6. **Payload size limits** — title ≤100, body ≤500, metadata ≤4KB

## Environment Variables

```bash
# Push Worker (added to .env.example)
REDIS_URL=redis://localhost:6379
PUSH_WORKER_CONCURRENCY=5
PUSH_WORKER_HEALTH_PORT=4001

# Mobile Apps (EXPO_PUBLIC_ prefix for client access)
EXPO_PUBLIC_EAS_PROJECT_ID=92aac293-ebd9-41a4-ba22-9694655e91bb
```

## File Summary

| New File | Package | Purpose | Requirements |
|----------|---------|---------|-------------|
| `supabase/migrations/XXX_push_tokens.sql` | infra | DB migration | 1.3, 2.3, 4.1, 10.1 |
| `packages/shared/src/types.ts` (additions) | shared | Push types | 9.1 |
| `packages/shared/src/validators.ts` (additions) | shared | Zod schemas | 1.7, 7.4, 9.5 |
| `packages/shared/src/constants.ts` (additions) | shared | Push constants | 9.3, 10.2-10.6 |
| `apps/api/src/routes/push-tokens.ts` | api | Token CRUD | 1.2-1.4, 2.1 |
| `apps/api/src/routes/admin/broadcast.ts` | api | Admin broadcast | 7.1-7.7 |
| `apps/api/src/services/push-service.ts` | api | Enqueue logic | 3.1, 3.9, 4.2-4.3, 9.1-9.5 |
| `apps/api/src/index.ts` (edit) | api | Route registration | — |
| `workers/push-worker/package.json` | worker | Package config | — |
| `workers/push-worker/src/index.ts` | worker | Entry point | 8.3, 8.4, 8.6 |
| `workers/push-worker/src/processor.ts` | worker | Job processing | 3.2-3.8, 8.1-8.2 |
| `workers/push-worker/src/expo-client.ts` | worker | Expo SDK wrapper | 3.4-3.6 |
| `workers/push-worker/src/token-resolver.ts` | worker | Token queries | 2.4, 4.4-4.5, 10.2-10.7 |
| `workers/push-worker/src/health.ts` | worker | Health endpoint | 8.5 |
| `packages/mobile-shared/src/hooks/use-push-notifications.ts` | mobile-shared | Push hook | 1.1-1.6, 2.1, 2.5-2.6, 5.1-5.11, 6.1-6.5 |
| `packages/mobile-shared/src/components/notification-banner.tsx` | mobile-shared | Banner UI | 6.1, 6.2, 6.5 |
| `packages/mobile-shared/src/utils/deep-link-router.ts` | mobile-shared | Deep linking | 5.3-5.11 |
| `apps/mobile-customer/app/_layout.tsx` (edit) | mobile-customer | Hook integration | 1.1 |
| `apps/mobile-driver/app/_layout.tsx` (edit) | mobile-driver | Hook integration | 1.1 |
| `apps/mobile-driver/app.json` (edit) | mobile-driver | Plugin config | — |
| `apps/admin/app/routes/notifications.broadcast.tsx` | admin | Broadcast UI | 7.1, 7.4-7.7 |
