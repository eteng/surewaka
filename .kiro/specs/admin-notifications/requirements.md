# Requirements Document

## Introduction

The Admin Notifications feature adds a real-time notification system to the SureWaka admin dashboard (`apps/admin`). It provides a bell icon button in the header (next to the user avatar) that displays an unread count badge and opens a dropdown/popover with recent notifications. Notifications cover key admin operations such as new user signups, delivery issues, carrier verification requests, and other events relevant to the internal ops team. The system includes backend support for creating, storing, retrieving, and marking notifications as read.

## Glossary

- **Notification_Bell**: The bell icon button rendered in the admin header that shows the unread notification count badge and triggers the notification popover
- **Notification_Popover**: The dropdown/popover panel that appears when the Notification_Bell is clicked, displaying a scrollable list of recent notifications
- **Notification_Service**: The API service responsible for creating, retrieving, updating, and managing notifications
- **Notification**: A single notification record containing a type, title, message, read status, and optional link to a related resource
- **Unread_Badge**: The visual indicator (numeric badge) overlaid on the Notification_Bell showing the count of unread notifications
- **Admin_Portal**: The `apps/admin` React Router v7 SPA used by SureWaka internal operations staff
- **Admin_User**: Any authenticated user of the Admin_Portal (ops team member)

## Requirements

### Requirement 1: Notification Bell with Unread Count Badge

**User Story:** As an admin user, I want to see a bell icon in the header with an unread count badge, so that I can immediately know when there are new notifications requiring my attention.

#### Acceptance Criteria

1. THE Notification_Bell SHALL be rendered in the admin header to the left of the user avatar button
2. THE Notification_Bell SHALL display the Bell icon from lucide-react at the same size as other header action icons
3. WHEN the unread notification count is greater than zero, THEN THE Unread_Badge SHALL display the numeric count overlaid on the Notification_Bell
4. WHEN the unread notification count exceeds 99, THEN THE Unread_Badge SHALL display "99+" instead of the exact number
5. WHEN the unread notification count is zero, THEN THE Unread_Badge SHALL be hidden
6. THE Notification_Bell SHALL fetch the unread count from the Notification_Service on initial page load
7. THE Notification_Bell SHALL use a button element with appropriate aria-label indicating the notification count for accessibility

### Requirement 2: Notification Popover Display

**User Story:** As an admin user, I want to click the bell icon and see a popover with my recent notifications, so that I can quickly review what needs my attention without navigating away from my current page.

#### Acceptance Criteria

1. WHEN the Admin_User clicks the Notification_Bell, THEN THE Notification_Popover SHALL open displaying the most recent notifications
2. THE Notification_Popover SHALL display up to 20 notifications in a scrollable list, sorted by creation date in descending order (newest first)
3. THE Notification_Popover SHALL display each notification with: an icon representing the notification type, a title, a relative timestamp (e.g., "5 min ago", "2 hours ago"), and a brief message
4. THE Notification_Popover SHALL visually distinguish unread notifications from read notifications using a background highlight or dot indicator
5. WHEN the Notification_Popover contains no notifications, THEN THE Notification_Popover SHALL display an empty state message indicating there are no notifications
6. THE Notification_Popover SHALL include a header with the text "Notifications" and a "Mark all as read" action button
7. WHEN the Admin_User clicks "Mark all as read", THEN THE Notification_Service SHALL mark all unread notifications for that user as read and THE Unread_Badge SHALL update to zero
8. THE Notification_Popover SHALL align to the end (right side) of the Notification_Bell and have a fixed maximum height with overflow scrolling

### Requirement 3: Notification Interaction and Navigation

**User Story:** As an admin user, I want to click on a notification to navigate to the relevant resource, so that I can take action on the notified event quickly.

#### Acceptance Criteria

1. WHEN a Notification has an associated resource link, THEN THE Notification_Popover SHALL render the notification item as a clickable element
2. WHEN the Admin_User clicks a notification with a resource link, THEN THE Admin_Portal SHALL navigate to the associated route and close the Notification_Popover
3. WHEN the Admin_User clicks a notification, THEN THE Notification_Service SHALL mark that notification as read
4. WHEN a Notification does not have an associated resource link, THEN THE Notification_Popover SHALL render the notification item as non-clickable informational text
5. THE Notification_Popover SHALL include a "View all" link at the bottom that navigates to a full notifications page at `/notifications`

### Requirement 4: Notification Storage and Retrieval API

**User Story:** As a platform developer, I want a notifications API that stores and retrieves notifications per user, so that the frontend can display relevant notifications to each admin user.

#### Acceptance Criteria

1. THE Notification_Service SHALL store notifications in a `notifications` database table with columns: id (UUID), user_id (UUID, references users), type (notification_type enum), title (text), message (text), resource_link (text, nullable), is_read (boolean, default false), created_at (timestamp), and updated_at (timestamp)
2. THE Notification_Service SHALL expose a GET endpoint at `/api/v1/notifications` that returns paginated notifications for the authenticated user, sorted by created_at descending
3. THE Notification_Service SHALL expose a GET endpoint at `/api/v1/notifications/unread-count` that returns the count of unread notifications for the authenticated user
4. THE Notification_Service SHALL expose a PATCH endpoint at `/api/v1/notifications/:id/read` that marks a single notification as read
5. THE Notification_Service SHALL expose a POST endpoint at `/api/v1/notifications/mark-all-read` that marks all unread notifications for the authenticated user as read
6. THE Notification_Service SHALL require authentication via the existing `requireAuth` middleware on all notification endpoints
7. THE Notification_Service SHALL return responses in the standard shape: `{ data, error, meta }` with pagination metadata in the `meta` field

### Requirement 5: Notification Types and Creation

**User Story:** As a platform developer, I want to create notifications for key admin events, so that the ops team is informed about actions requiring their attention.

#### Acceptance Criteria

1. THE Notification_Service SHALL support the following notification types: `new_user_signup`, `delivery_issue`, `carrier_verification_request`, `carrier_verified`, `dispute_opened`, `driver_verification_request`, and `system_alert`
2. THE Notification_Service SHALL expose an internal POST endpoint at `/api/v1/notifications` for creating notifications, restricted to service-level or admin callers
3. WHEN a notification is created, THEN THE Notification_Service SHALL validate the request using a Zod schema requiring: user_id (UUID), type (valid notification_type enum), title (1-200 chars), message (1-500 chars), and optional resource_link (valid relative URL path)
4. THE Notification_Service SHALL support creating a notification for all admin users simultaneously by accepting a special `user_id` value of `"all_admins"`
5. IF the notification type is not a valid enum value, THEN THE Notification_Service SHALL return HTTP 400 with error code `VALIDATION_ERROR`
6. WHEN a notification is created with `user_id` of `"all_admins"`, THEN THE Notification_Service SHALL create individual notification records for each user holding the `surewaka_admin` role

### Requirement 6: Notification Polling and Freshness

**User Story:** As an admin user, I want my notification count to stay up to date while I'm using the dashboard, so that I don't miss time-sensitive events.

#### Acceptance Criteria

1. THE Notification_Bell SHALL poll the unread count endpoint every 30 seconds while the Admin_Portal tab is active
2. WHEN the browser tab becomes inactive (hidden), THEN THE Notification_Bell SHALL pause polling to conserve resources
3. WHEN the browser tab becomes active again (visible), THEN THE Notification_Bell SHALL immediately fetch the latest unread count and resume polling
4. WHEN the Notification_Popover is opened, THEN THE Admin_Portal SHALL fetch the latest notification list from the Notification_Service
5. WHEN a notification is marked as read (individually or via "Mark all as read"), THEN THE Unread_Badge SHALL update optimistically before the server response confirms

### Requirement 7: Full Notifications Page

**User Story:** As an admin user, I want a dedicated notifications page where I can see all my notifications with filtering options, so that I can review my complete notification history.

#### Acceptance Criteria

1. THE Admin_Portal SHALL provide a notifications page at the route `/notifications`
2. THE notifications page SHALL display all notifications for the authenticated user in a paginated list with 20 items per page
3. THE notifications page SHALL support filtering by notification type and read/unread status
4. THE notifications page SHALL display each notification with: type icon, title, full message, relative timestamp, and read status indicator
5. WHEN the Admin_User clicks a notification on the full page, THEN THE Admin_Portal SHALL navigate to the associated resource link and mark the notification as read
6. THE notifications page SHALL include a "Mark all as read" bulk action button

### Requirement 8: Notification Retention and Cleanup

**User Story:** As a platform architect, I want notifications to be automatically cleaned up after a retention period, so that the database does not grow unbounded.

#### Acceptance Criteria

1. THE Notification_Service SHALL retain notifications for a maximum of 90 days from their creation date
2. WHEN a notification is older than 90 days, THEN THE Notification_Service SHALL delete the notification record during the next cleanup cycle
3. THE Notification_Service SHALL execute cleanup as a scheduled task (cron job) running once daily
4. THE Notification_Service SHALL log the number of deleted notifications after each cleanup cycle execution

