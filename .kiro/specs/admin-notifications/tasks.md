# Implementation Plan: Admin Notifications

## Overview

This plan implements the admin notifications feature for the SureWaka admin portal. It adds a polling-based notification system with a bell icon + unread badge in the header, a popover for quick review, a full notifications page with filtering, and a backend API for CRUD operations on notifications. Cleanup of old notifications is handled by a daily cron job.

The implementation follows existing patterns: Supabase migrations for DDL, Drizzle ORM schema sync, Zod validators in `@surewaka/shared`, Hono routes with `requireAuth` middleware, and React components with custom hooks for state management.

## Tasks

- [x] 1. Database schema and shared types
  - [x] 1.1 Apply Supabase migration for notifications table and enum
    - Create `notification_type` enum with values: `new_user_signup`, `delivery_issue`, `carrier_verification_request`, `carrier_verified`, `dispute_opened`, `driver_verification_request`, `system_alert`
    - Create `notifications` table with columns: `id` (UUID PK), `user_id` (UUID FK → users), `type` (notification_type), `title` (text), `message` (text), `resource_link` (text nullable), `is_read` (boolean default false), `created_at` (timestamptz), `updated_at` (timestamptz)
    - Add partial index `idx_notifications_user_unread` on (user_id, is_read) WHERE is_read = false
    - Add index `idx_notifications_user_created` on (user_id, created_at DESC)
    - Add partial index `idx_notifications_cleanup` on (created_at) WHERE created_at < now() - INTERVAL '90 days'
    - Add `updated_at` trigger function and trigger (`trg_notifications_updated_at`) to auto-update on row changes
    - Enable RLS on notifications table with policies: `notifications_select_own` (SELECT where auth.uid() = user_id), `notifications_update_own` (UPDATE where auth.uid() = user_id), `notifications_insert_service` (INSERT for service role), `notifications_delete_service` (DELETE for service role / cleanup cron)
    - _Requirements: 4.1, 5.1_

  - [x] 1.2 Update Drizzle schema in `packages/db/src/schema.ts`
    - Add `notificationTypeEnum` pgEnum with all 7 notification types
    - Add `notifications` table definition with all columns, foreign key to `users.id` with cascade delete, and defaults
    - _Requirements: 4.1_

  - [x] 1.3 Add notification types and validators to `packages/shared`
    - Add `NOTIFICATION_TYPES` const array with all 7 enum values
    - Add `NotificationType` type (union of enum values)
    - Add `NotificationData` type with id, type, title, message, resourceLink, isRead, createdAt
    - Add `PaginationMeta` type with page, pageSize, total, totalPages
    - Add `createNotificationSchema` Zod schema (userId: UUID | "all_admins", type: enum, title: 1-200 chars, message: 1-500 chars, resourceLink: optional relative URL)
    - Add `notificationQuerySchema` Zod schema (page, pageSize with max 50, optional type filter, optional isRead filter)
    - Export all types and schemas
    - _Requirements: 4.7, 5.1, 5.3_

- [x] 2. API service layer
  - [x] 2.1 Create `apps/api/src/services/notification-service.ts`
    - Implement `getNotifications(userId, options)` — paginated query with optional type/isRead filters, sorted by created_at DESC
    - Implement `getUnreadCount(userId)` — count where is_read = false for user
    - Implement `createNotification(input)` — validate with Zod schema, handle "all_admins" by querying users with `surewaka_admin` role and inserting individual records
    - Implement `markAsRead(userId, notificationId)` — set is_read = true, return 404 if not found or not owned by user
    - Implement `markAllAsRead(userId)` — update all unread notifications for user, return count updated
    - Implement `cleanupOldNotifications()` — delete notifications older than 90 days, log count
    - All functions return `{ data, error, meta }` shape
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.4, 5.6, 8.1, 8.2_

  - [x] 2.2 Write property tests for notification service
    - **Property 7: Unread Count Accuracy** — for any set of notifications with varying is_read values, getUnreadCount returns exactly the count where is_read = false
    - **Validates: Requirements 4.3**
    - **Property 4: Mark-All-Read Correctness** — for any mixed read/unread set, after markAllAsRead every notification has is_read = true and unread count = 0
    - **Validates: Requirements 2.7, 4.5**
    - **Property 6: Mark-As-Read Idempotence** — calling markAsRead on an already-read notification succeeds without error
    - **Validates: Requirements 3.3, 4.4**
    - **Property 10: Broadcast to All Admins** — for N admin users, creating with userId "all_admins" produces exactly N records with identical type, title, message, resourceLink
    - **Validates: Requirements 5.4, 5.6**
    - **Property 12: Retention Cleanup Correctness** — cleanup deletes all notifications older than 90 days and preserves all notifications 90 days old or newer
    - **Validates: Requirements 8.1, 8.2**

- [ ] 3. API route handlers
  - [x] 3.1 Create `apps/api/src/routes/notifications.ts`
    - `GET /` — parse query with `notificationQuerySchema`, call `getNotifications`, return paginated response
    - `GET /unread-count` — call `getUnreadCount`, return `{ data: { count }, error: null, meta: null }`
    - `POST /` — validate body with `createNotificationSchema`, call `createNotification`, return 201
    - `PATCH /:id/read` — validate UUID param, call `markAsRead`, return updated notification or 404
    - `POST /mark-all-read` — call `markAllAsRead`, return `{ data: { updated }, error: null, meta: null }`
    - All routes use `requireAuth` middleware
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 3.2 Register notification routes in `apps/api/src/index.ts`
    - Import and mount notification routes at `/api/v1/notifications`
    - _Requirements: 4.2_

  - [x] 3.3 Write property tests for validation and response shape
    - **Property 9: Notification Creation Validation** — valid payloads are accepted, invalid payloads (bad UUID, invalid type, title >200 chars, message >500 chars, non-relative URL) return 400 with VALIDATION_ERROR
    - **Validates: Requirements 5.3, 5.5**
    - **Property 8: Response Shape Invariant** — for any request (valid or invalid), response conforms to `{ data, error, meta }` where exactly one of data/error is non-null
    - **Validates: Requirements 4.7**

- [x] 4. Checkpoint — API layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Frontend notification hook
  - [x] 5.1 Create `apps/admin/app/hooks/use-notifications.ts`
    - Implement `useNotifications` hook returning: unreadCount, notifications, isLoading, error, meta, fetchNotifications, markAsRead, markAllAsRead, refetchUnreadCount
    - Implement 30-second polling interval for unread count
    - Implement tab visibility awareness (pause polling when hidden, resume + immediate fetch when visible)
    - Implement optimistic updates for markAsRead (decrement count, set isRead locally, revert on failure)
    - Implement optimistic updates for markAllAsRead (set count to 0, mark all read locally, revert on failure)
    - Support pagination and filter options for the full page
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 6. Frontend notification components
  - [x] 6.1 Create `apps/admin/app/components/notifications/notification-bell.tsx`
    - Render bell icon button (lucide-react `Bell`, h-5 w-5) with aria-label reflecting unread count
    - Show numeric badge when unread > 0 (display "99+" when > 99, hide when 0)
    - Toggle popover open/close on click
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 6.2 Create `apps/admin/app/components/notifications/notification-popover.tsx`
    - Use shadcn/ui Popover component, aligned to end (right side)
    - Header with "Notifications" title and "Mark all as read" button
    - Scrollable body (max-h-96) rendering NotificationItem list
    - Empty state message when no notifications
    - Footer with "View all" link to `/notifications`
    - Fetch latest notifications on open
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 6.3 Create `apps/admin/app/components/notifications/notification-item.tsx`
    - Render type icon (mapped from notification type to lucide icon)
    - Show title, relative timestamp (formatRelativeTime utility), and message
    - Unread indicator: left blue dot + highlighted background
    - Clickable if resourceLink is present (navigate + mark as read), non-interactive otherwise
    - Support `variant` prop for popover (truncated message) vs page (full message)
    - _Requirements: 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [x] 6.4 Create `formatRelativeTime` utility in `apps/admin/app/lib/format-relative-time.ts`
    - Convert ISO timestamp to relative string (e.g., "5 min ago", "2 hours ago", "3 days ago")
    - _Requirements: 2.3_

  - [x] 6.5 Write property tests for badge formatting and rendering
    - **Property 1: Badge Formatting Correctness** — for any non-negative integer: returns empty/hidden when 0, exact numeric string for 1-99, "99+" for >99
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.7**
    - **Property 5: Clickability Determined by Resource Link** — notification is clickable iff resourceLink is non-null
    - **Validates: Requirements 3.1, 3.4**
    - **Property 3: Notification Rendering Completeness** — for any valid notification object, rendered output contains type icon, title, relative timestamp, and message
    - **Validates: Requirements 2.3, 7.4**

- [x] 7. Checkpoint — Frontend components complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Full notifications page
  - [x] 8.1 Create `apps/admin/app/routes/notifications.tsx`
    - Paginated list (20 per page) with pagination controls
    - Filter bar: notification type dropdown + read/unread status toggle
    - "Mark all as read" bulk action button
    - Each item shows full message text (page variant)
    - Clicking a notification navigates to resource link and marks as read
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 8.2 Register `/notifications` route in `apps/admin/app/routes.ts`
    - Add route entry for the notifications page
    - _Requirements: 7.1_

  - [x] 8.3 Write property tests for filter correctness
    - **Property 11: Filter Correctness** — for any filter combination (type and/or isRead), every returned notification matches all applied criteria and no matching notification is excluded
    - **Validates: Requirements 7.3**
    - **Property 2: Notification List Sorting and Pagination** — returned list is sorted in strictly descending order by created_at, and item count ≤ pageSize
    - **Validates: Requirements 2.2, 4.2, 7.2**

- [x] 9. Header integration
  - [x] 9.1 Integrate NotificationBell into admin header
    - Add NotificationBell to the header actions area, positioned to the left of the existing user avatar button
    - Wrap bell + user avatar in a HeaderActions container if needed
    - _Requirements: 1.1_

- [ ] 10. Cleanup cron job
  - [x] 10.1 Create notification cleanup worker
    - Create cleanup function in `apps/api/src/services/notification-service.ts` (already in 2.1) or as a standalone script in `workers/cron/`
    - Delete all notifications where created_at < now() - 90 days
    - Log the number of deleted notifications
    - Configure to run daily at 02:00 UTC (via pg_cron, Fly.io cron, or GitHub Actions)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property-based tests use `fast-check` consistent with existing patterns in the codebase
- Each property test references a specific correctness property from the design document (12 total)
- The project uses Supabase migrations for DDL — task 1.1 applies the migration, task 1.2 keeps Drizzle schema in sync
- Polling interval is 30 seconds with tab visibility awareness to conserve resources
- Optimistic updates provide responsive UX with automatic revert on failure
- The "all_admins" broadcast creates individual records per admin user for independent read state
- Test files: `apps/api/src/__tests__/notification-*.property.test.ts` and `apps/admin/app/__tests__/notification-*.property.test.ts`
