# Requirements Document

## Introduction

Push notifications for SureWaka's mobile applications (customer and driver), enabling real-time delivery status updates, driver alerts, payment confirmations, and admin broadcast messages. The system uses Expo Push Notifications (abstracting FCM/APNs), a BullMQ push-worker for batched delivery, multi-device token management, deep linking to relevant screens, and an admin broadcast capability for targeted user segments. Web push is out of scope — mobile only.

## Glossary

- **Push_Service**: The backend service (`apps/api/src/services/push-service.ts`) responsible for creating push notification jobs and enqueueing them into the BullMQ push queue.
- **Push_Worker**: The BullMQ background worker (`workers/push-worker/`) that consumes push jobs from the queue, batches them, and delivers them to the Expo Push API.
- **Push_Token_Registry**: The API subsystem (`apps/api/src/routes/push-tokens.ts`) and database table (`push_tokens`) that stores and manages Expo push token registrations per user, device, and app.
- **Notification_Hook**: The shared React Native hook (`packages/mobile-shared/src/hooks/use-push-notifications.ts`) used by both mobile apps to request permissions, register tokens, and handle incoming notifications.
- **Expo_Push_API**: The external Expo Push Notification service that handles delivery to FCM (Android) and APNs (iOS).
- **Admin_Broadcast**: The admin dashboard feature that allows authenticated admins to compose and send targeted push notifications to user segments.
- **Deep_Link_Router**: The client-side logic that maps notification `data` payloads to specific in-app screens via URL scheme navigation.
- **Customer_App**: The Expo/React Native customer mobile application (`apps/mobile-customer`).
- **Driver_App**: The Expo/React Native driver mobile application (`apps/mobile-driver`).
- **Notification_Preference**: The `notification_push` boolean column on the users table controlling whether a user receives push notifications.

## Requirements

### Requirement 1: Push Token Registration

**User Story:** As a mobile app user, I want my device's push token to be registered with SureWaka, so that the platform can send me push notifications on this device.

#### Acceptance Criteria

1. WHEN the Customer_App or Driver_App is launched and the user is authenticated, THE Notification_Hook SHALL request push notification permissions from the operating system.
2. WHEN push notification permissions are granted, THE Notification_Hook SHALL retrieve the Expo push token from the device and send a registration request containing the token, user_id, device_id, platform, and app identifier to the Push_Token_Registry.
3. WHEN the Push_Token_Registry receives a token registration request containing a non-empty token string, a valid user_id, a non-empty device_id, a platform value of "ios" or "android", and an app value of "customer" or "driver", THE Push_Token_Registry SHALL store the token with the associated user_id, device_id, platform, app identifier, and is_active status set to true.
4. WHEN a token registration request contains a token that already exists for the same user_id and device_id, THE Push_Token_Registry SHALL update the existing record with the new token value rather than creating a duplicate.
5. WHEN push notification permissions are denied by the user, THE Notification_Hook SHALL allow the app to continue functioning without push notifications and SHALL NOT block navigation or display error screens.
6. IF a token registration request fails due to a network error, THEN THE Notification_Hook SHALL retry the registration up to 3 times with exponential backoff starting at a 1-second base interval.
7. IF a token registration request is missing required fields or contains invalid values for platform or app, THEN THE Push_Token_Registry SHALL reject the request and return an error response indicating the validation failure.

### Requirement 2: Push Token Lifecycle Management

**User Story:** As a platform operator, I want push tokens to be accurately maintained, so that notifications are only sent to valid, active devices.

#### Acceptance Criteria

1. WHEN a user logs out of the Customer_App or Driver_App, THE Notification_Hook SHALL call the Push_Token_Registry to deactivate the token for that device by setting is_active to false.
2. WHEN the Expo_Push_API returns a `DeviceNotRegistered` or `InvalidCredentials` error for a specific token, THE Push_Worker SHALL mark that token as inactive in the Push_Token_Registry within the same job execution.
3. THE Push_Token_Registry SHALL maintain separate active tokens for each device per user, up to a maximum of 10 active tokens per user per app, deactivating the least-recently-registered token when the limit is exceeded.
4. THE Push_Token_Registry SHALL only return active tokens (is_active = true) when queried for notification delivery.
5. WHEN a user re-logs into a device whose token was previously deactivated, THE Notification_Hook SHALL re-register the token and set is_active to true.
6. IF the deactivation request to the Push_Token_Registry fails due to a network error during logout, THEN THE Notification_Hook SHALL retry the deactivation up to 3 times with exponential backoff before allowing the logout to complete regardless of deactivation outcome.

### Requirement 3: Push Notification Delivery

**User Story:** As a mobile app user, I want to receive timely push notifications about my deliveries and account activity, so that I stay informed without needing to open the app.

#### Acceptance Criteria

1. WHEN a push-triggering event occurs (delivery status change, driver arrival, payment received, dispute opened, delivery assigned, carrier verified), THE Push_Service SHALL create a push notification job containing the recipient user_id, notification title, body, notification type, and deep link data, and enqueue it in the BullMQ push queue.
2. WHEN the Push_Worker dequeues a push notification job, THE Push_Worker SHALL query the Push_Token_Registry for all active tokens belonging to the recipient user_id.
3. IF the recipient user has Notification_Preference set to false, THEN THE Push_Worker SHALL skip delivery for that user and mark the job as completed without sending.
4. WHEN the Push_Worker has collected tokens for delivery, THE Push_Worker SHALL batch tokens into groups of up to 100 and send each batch to the Expo_Push_API in a single request.
5. WHEN the Expo_Push_API returns a successful response for a batch, THE Push_Worker SHALL mark those notification jobs as delivered and record the delivery timestamp.
6. IF the Expo_Push_API returns a transient error (rate limit or server error), THEN THE Push_Worker SHALL retry the failed batch up to 3 times with exponential backoff starting at 1 second (delays: 1s, 2s, 4s) before marking it as failed.
7. IF the Push_Token_Registry returns zero active tokens for the recipient user_id, THEN THE Push_Worker SHALL mark the job as completed with a "no_active_tokens" status without calling the Expo_Push_API.
8. IF the Expo_Push_API returns a permanent error (invalid credentials, message too large, or invalid push token format), THEN THE Push_Worker SHALL mark the job as failed immediately without retrying and log the error reason.
9. WHEN a push-triggering event occurs, THE Push_Service SHALL enqueue the push notification job within 5 seconds of the triggering event.

### Requirement 4: Notification Preference Management

**User Story:** As a mobile app user, I want to control whether I receive push notifications, so that I can opt out if I find them disruptive.

#### Acceptance Criteria

1. THE users table SHALL have a `notification_push` boolean column with a default value of true, ensuring all new users are opted in to push notifications upon registration.
2. WHEN a user sends an authenticated request to update their Notification_Preference to false, THE Push_Service SHALL stop enqueueing new push notifications for that user from that point forward.
3. WHEN a user sends an authenticated request to update their Notification_Preference to true, THE Push_Service SHALL resume enqueueing push notifications for that user from that point forward.
4. IF a push notification job is already enqueued when a user updates their Notification_Preference to false, THEN THE Push_Worker SHALL check the user's current Notification_Preference at delivery time and skip sending if it is false.
5. WHEN the Push_Token_Registry is queried for a user's active tokens, THE Push_Token_Registry SHALL exclude users whose Notification_Preference is set to false from delivery-eligible results.
6. IF an unauthenticated request or a request from a different user attempts to update a user's Notification_Preference, THEN THE Push_Token_Registry SHALL reject the request and return an authorization error.

### Requirement 5: Deep Linking from Notifications

**User Story:** As a mobile app user, I want tapping a push notification to take me directly to the relevant screen, so that I can quickly act on the notification content.

#### Acceptance Criteria

1. WHEN a push notification is tapped while the app is in the background or terminated, THE Deep_Link_Router SHALL navigate the user to the screen specified by the notification's deep link data within 3 seconds of the app becoming interactive.
2. WHEN a push notification is tapped while the app is in the foreground, THE Deep_Link_Router SHALL navigate the user to the screen specified by the notification's deep link data within 1 second.
3. WHEN a delivery_status_change notification is tapped, THE Deep_Link_Router SHALL navigate to the delivery detail screen at `/delivery/:id`.
4. WHEN a driver_arrived notification is tapped, THE Deep_Link_Router SHALL navigate to the live tracking screen at `/tracking/:id`.
5. WHEN a payment_received notification is tapped, THE Deep_Link_Router SHALL navigate to the wallet screen at `/wallet`.
6. WHEN a dispute_opened notification is tapped, THE Deep_Link_Router SHALL navigate to the dispute detail screen at `/delivery/:id/dispute`.
7. WHEN a delivery_assigned notification is tapped in the Driver_App, THE Deep_Link_Router SHALL navigate to the delivery accept screen at `/delivery/:id`.
8. WHEN a carrier_verified notification is tapped, THE Deep_Link_Router SHALL navigate to the dashboard screen at `/`.
9. WHEN a broadcast notification with a custom deep link URL is tapped, THE Deep_Link_Router SHALL navigate to the URL specified in the notification data only if the URL matches a registered internal route within the app; otherwise THE Deep_Link_Router SHALL navigate to the home screen.
10. IF the deep link target screen requires data that is unavailable (deleted delivery, invalid ID), THEN THE Deep_Link_Router SHALL navigate the user to the app's home screen and display a message indicating the referenced content is no longer available.
11. IF a push notification is tapped while the app is terminated and the user session has expired, THEN THE Deep_Link_Router SHALL store the intended deep link, present the authentication flow, and navigate to the stored deep link destination upon successful re-authentication.

### Requirement 6: Foreground Notification Handling

**User Story:** As a mobile app user, I want to be informed of new notifications while actively using the app, so that I do not miss important updates.

#### Acceptance Criteria

1. WHEN a push notification arrives while the app is in the foreground, THE Notification_Hook SHALL display the notification as an in-app banner showing the notification title and body, and auto-dismiss the banner after 5 seconds.
2. WHEN the user taps the in-app notification banner, THE Deep_Link_Router SHALL navigate to the screen specified by the notification's deep link data.
3. WHEN a push notification arrives while the app is in the foreground, THE Notification_Hook SHALL not play the default system notification sound.
4. WHEN a new push notification arrives while an in-app banner is already visible, THE Notification_Hook SHALL replace the current banner with the new notification and reset the auto-dismiss timer to 5 seconds.
5. WHEN the user swipes away the in-app notification banner or the banner auto-dismisses, THE Notification_Hook SHALL remove the banner without triggering navigation.

### Requirement 7: Admin Broadcast Notifications

**User Story:** As a SureWaka admin, I want to send push notifications to targeted user segments from the admin dashboard, so that I can communicate promotions, service updates, and alerts to specific groups of users.

#### Acceptance Criteria

1. WHEN an authenticated admin accesses the broadcast feature, THE Admin_Broadcast SHALL display a form with fields for title, body, target segment (all users, all customers, all drivers, specific city), and optional deep link URL.
2. WHEN an admin submits a valid broadcast form, THE Admin_Broadcast SHALL enqueue individual push notification jobs for each user in the target segment via the Push_Service.
3. WHEN a broadcast targets a segment with more than 1000 users, THE Push_Service SHALL enqueue jobs in paginated batches of 500 users per batch to avoid memory exhaustion.
4. THE Admin_Broadcast SHALL validate that both title and body fields are non-empty, that title does not exceed 100 characters, that body does not exceed 500 characters, and that any provided deep link URL is a valid URL not exceeding 2048 characters, before submission.
5. WHEN a broadcast is submitted, THE Admin_Broadcast SHALL display a confirmation summary showing the estimated recipient count and require explicit admin confirmation before final dispatch; if the admin cancels, no notification jobs SHALL be enqueued.
6. IF a user without the `surewaka_admin` role attempts to access the broadcast feature, THEN THE Admin_Broadcast SHALL deny access and display an error message indicating insufficient permissions.
7. IF the Push_Service fails to enqueue jobs for a batch during broadcast dispatch, THEN THE Admin_Broadcast SHALL halt further batches, report the number of jobs successfully enqueued versus failed, and allow the admin to retry the remaining segment.

### Requirement 8: Push Worker Reliability and Observability

**User Story:** As a platform operator, I want the push notification system to be reliable and observable, so that delivery failures are detected and resolved quickly.

#### Acceptance Criteria

1. WHEN the Push_Worker fails to process a job after 3 retry attempts, THE Push_Worker SHALL move the job to a dead-letter queue, preserving the original job payload, failure reason, and timestamp of each failed attempt for manual inspection.
2. THE Push_Worker SHALL log each batch delivery attempt with the batch size, success count, failure count, and Expo_Push_API response time in milliseconds.
3. WHEN the Push_Worker starts, THE Push_Worker SHALL process jobs concurrently with a configurable concurrency limit between 1 and 50 (default: 5 concurrent jobs).
4. IF the Redis connection is lost, THEN THE Push_Worker SHALL attempt to reconnect with exponential backoff starting at 1 second and capped at 30 seconds, for a maximum of 10 attempts, and SHALL not acknowledge in-progress jobs so that they remain available for processing upon reconnection.
5. THE Push_Worker SHALL expose health check metrics including queue depth, jobs processed per minute, and failure rate calculated over a rolling 5-minute window.
6. IF the Push_Worker fails to reconnect to Redis after 10 attempts, THEN THE Push_Worker SHALL log an error indicating the connection failure and terminate the process with a non-zero exit code to allow the process supervisor to restart it.

### Requirement 9: Notification Payload Structure

**User Story:** As a developer, I want a consistent notification payload structure, so that all parts of the system can create and consume push notifications predictably.

#### Acceptance Criteria

1. THE Push_Service SHALL construct every push notification payload with the following fields: title (string, required, maximum 100 characters), body (string, required, maximum 500 characters), data (object containing: type (string, required, one of: delivery_status_change, driver_arrived, payment_received, dispute_opened, delivery_assigned, carrier_verified, broadcast), resourceId (string, required), deepLink (string, required), and optional metadata (object, maximum 4 KB when serialized)).
2. WHEN the push notification payload is serialized for the Expo_Push_API, THE Push_Service SHALL include the `to` field (Expo push token), `title`, `body`, `data`, and `sound` (set to "default").
3. THE Push_Service SHALL set the notification priority to "high" for delivery_status_change and driver_arrived notification types, and "normal" for all other notification types.
4. THE Push_Service SHALL ensure that serializing and then deserializing any valid push notification payload produces a deeply equal object with all field names, values, and types preserved.
5. IF a push notification payload is missing any required field or any field exceeds its maximum length, THEN THE Push_Service SHALL reject the payload without enqueueing and return an error indicating which fields failed validation.

### Requirement 10: Multi-App Token Isolation

**User Story:** As a user who has both the customer and driver apps installed, I want notifications routed to the correct app, so that I receive delivery tracking updates in the customer app and delivery assignment alerts in the driver app.

#### Acceptance Criteria

1. THE Push_Token_Registry SHALL store an `app` field (value: "customer" or "driver") for each registered token to distinguish which app the token belongs to.
2. WHEN a delivery_status_change, driver_arrived, or payment_received notification targets a user, THE Push_Service SHALL enqueue the job for delivery only to tokens registered under the "customer" app.
3. WHEN a delivery_assigned or carrier_verified notification targets a driver, THE Push_Service SHALL enqueue the job for delivery only to tokens registered under the "driver" app.
4. WHEN a broadcast notification targets a user, THE Push_Service SHALL deliver the broadcast to all active tokens registered for that user regardless of app field value.
5. IF a dispute_opened notification targets the sender of the delivery, THEN THE Push_Service SHALL enqueue the job for delivery only to tokens registered under the "customer" app.
6. IF a dispute_opened notification targets the assigned driver of the delivery, THEN THE Push_Service SHALL enqueue the job for delivery only to tokens registered under the "driver" app.
7. IF the Push_Service cannot determine a target app for a notification type not listed in criteria 2, 3, 5, or 6, THEN THE Push_Service SHALL deliver to all active tokens for the recipient user and log a warning indicating the unmapped notification type.
