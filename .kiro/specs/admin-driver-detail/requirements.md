# Requirements Document

## Introduction

The Admin Driver Detail feature provides a comprehensive read-only detail page for individual drivers at `/drivers/:driverId` within the SureWaka admin dashboard. The page uses a tabbed layout (Overview, Deliveries, Carrier) to display personal information, vehicle details, verification and availability status, performance metrics, recent delivery history, and carrier affiliation. A new API endpoint returns the full driver detail, and the page follows established patterns from the existing user detail page (`users.$userId.tsx`), including back navigation, error boundary, loading skeleton, and sectional card layout.

## Glossary

- **Admin_Portal**: The SureWaka internal administration dashboard application (`apps/admin`)
- **Driver_Detail_Page**: The `/drivers/:driverId` route within the Admin_Portal that displays comprehensive information about a single driver
- **Driver_Detail_API**: The REST API endpoint at `GET /api/v1/admin/drivers/:id` that returns full driver detail data
- **Driver_Detail_Type**: The `DriverDetail` TypeScript type exported from `@surewaka/shared` representing the full driver detail response shape
- **Overview_Tab**: The default tab on the Driver_Detail_Page displaying personal info, vehicle details, status badges, and performance metrics
- **Deliveries_Tab**: The tab on the Driver_Detail_Page showing the 10 most recent deliveries for the driver
- **Carrier_Tab**: The tab on the Driver_Detail_Page showing carrier affiliation or independent status
- **Vehicle_Type**: One of `motorcycle`, `car`, `van`, or `truck` as defined in the `vehicle_type` database enum
- **RoleGate**: A frontend component that conditionally renders content based on the authenticated user's role, displaying an "Access Denied" fallback for unauthorized users

## Requirements

### Requirement 1: Driver Detail API Endpoint

**User Story:** As an admin, I want a backend API endpoint that returns complete information about a specific driver, so that the frontend can render a detailed driver profile page.

#### Acceptance Criteria

1. THE Driver_Detail_API SHALL return a single driver's full detail in the response shape `{ data, error, meta }`
2. THE Driver_Detail_API SHALL join the `drivers` table with the `users` table (INNER JOIN) to include `name`, `phone`, `email`, and `avatarUrl` fields
3. THE Driver_Detail_API SHALL LEFT JOIN the `carrier_members` table (where `is_active` is true) and the `carriers` table to include carrier affiliation data (carrier name, carrier id, role within carrier, and carrier join date)
4. THE Driver_Detail_API SHALL include a `totalDeliveries` count derived from the `deliveries` table where `status` is `delivered`
5. THE Driver_Detail_API SHALL include the driver's average `rating` from the `drivers` table
6. THE Driver_Detail_API SHALL include the 10 most recent deliveries for the driver as a nested array, each containing delivery id, status, pickup address, dropoff address, date, and price
7. WHEN the `:id` path parameter matches a valid driver record, THE Driver_Detail_API SHALL return a 200 response with the full driver detail object
8. IF the `:id` path parameter does not match any driver record, THEN THE Driver_Detail_API SHALL return a 404 response with an error object containing code `NOT_FOUND`
9. IF the `:id` path parameter is not a valid UUID, THEN THE Driver_Detail_API SHALL return a 400 response with an error object containing code `VALIDATION_ERROR`
10. THE Driver_Detail_API SHALL require authentication and the `surewaka_admin` role

### Requirement 2: Driver Detail Shared Type

**User Story:** As a developer, I want a shared TypeScript type for the driver detail response, so that the API and frontend use a consistent data contract.

#### Acceptance Criteria

1. THE `@surewaka/shared` package SHALL export a `DriverDetail` type representing the full driver detail response
2. THE `DriverDetail` type SHALL include personal info fields: `id` (string), `name` (string), `phone` (string), `email` (string or null), `avatarUrl` (string or null)
3. THE `DriverDetail` type SHALL include vehicle fields: `vehicleType` (Vehicle_Type), `vehicleModel` (string), `licensePlate` (string)
4. THE `DriverDetail` type SHALL include status fields: `verified` (boolean), `available` (boolean)
5. THE `DriverDetail` type SHALL include performance fields: `rating` (number), `totalDeliveries` (number)
6. THE `DriverDetail` type SHALL include a `createdAt` field (string in ISO format) representing the driver's join date
7. THE `DriverDetail` type SHALL include carrier affiliation fields: `carrierName` (string or null), `carrierId` (string or null), `carrierRole` (string or null), `carrierJoinedAt` (string or null)
8. THE `DriverDetail` type SHALL include a `recentDeliveries` array where each item contains: `id` (string), `status` (string), `pickupAddress` (string), `dropoffAddress` (string), `date` (string), `price` (number)

### Requirement 3: Driver Detail Page Layout and Navigation

**User Story:** As an admin, I want a well-structured driver detail page with tabbed navigation, so that I can view different aspects of a driver's profile in an organized manner.

#### Acceptance Criteria

1. THE Driver_Detail_Page SHALL be accessible at the route `/drivers/:driverId` within the admin layout
2. THE Driver_Detail_Page SHALL display a back button that navigates to the `/drivers` listing page
3. THE Driver_Detail_Page SHALL display the driver's name as the page title
4. THE Driver_Detail_Page SHALL provide a tabbed interface with three tabs: Overview, Deliveries, and Carrier
5. WHEN the page loads, THE Driver_Detail_Page SHALL display the Overview_Tab as the default active tab
6. WHEN a tab is clicked, THE Driver_Detail_Page SHALL switch the visible content to the selected tab without a page reload
7. THE Driver_Detail_Page SHALL use sectional card components consistent with the existing user detail page pattern

### Requirement 4: Overview Tab

**User Story:** As an admin, I want to see a driver's personal information, vehicle details, status, and performance at a glance, so that I can quickly assess the driver's profile.

#### Acceptance Criteria

1. THE Overview_Tab SHALL display the driver's avatar (or a placeholder if no avatar is set), full name, phone number, and email address
2. THE Overview_Tab SHALL display the driver's vehicle type, vehicle model, and license plate number
3. THE Overview_Tab SHALL display a verification status badge indicating whether the driver is verified or unverified
4. THE Overview_Tab SHALL display an availability status badge indicating whether the driver is currently available or unavailable
5. THE Overview_Tab SHALL display the driver's average rating as a numeric value
6. THE Overview_Tab SHALL display the driver's total completed deliveries count
7. THE Overview_Tab SHALL display the date the driver joined the platform in a human-readable format

### Requirement 5: Deliveries Tab

**User Story:** As an admin, I want to view a driver's recent delivery history, so that I can review their activity on the platform.

#### Acceptance Criteria

1. THE Deliveries_Tab SHALL display a table showing the 10 most recent deliveries for the driver
2. THE Deliveries_Tab table SHALL include columns: Status, Pickup Address, Dropoff Address, Date, and Price
3. THE Deliveries_Tab SHALL display each delivery's status with a visual indicator (badge or colored text) appropriate to the status value
4. WHEN the driver has no delivery records, THE Deliveries_Tab SHALL display an empty state message indicating no deliveries have been completed
5. THE Deliveries_Tab SHALL display delivery dates in a human-readable format
6. THE Deliveries_Tab SHALL display prices in Nigerian Naira format

### Requirement 6: Carrier Tab

**User Story:** As an admin, I want to see a driver's carrier affiliation details, so that I can understand their organizational relationship on the platform.

#### Acceptance Criteria

1. WHEN the driver is affiliated with a carrier, THE Carrier_Tab SHALL display the carrier name, the driver's role within the carrier, and the date the driver joined the carrier
2. WHEN the driver has no active carrier membership, THE Carrier_Tab SHALL display an "Independent" label indicating the driver operates independently
3. WHEN a carrier name is displayed, THE Carrier_Tab SHALL present the carrier name as readable text (not as a clickable link)

### Requirement 7: Loading and Error States

**User Story:** As an admin, I want clear feedback when the page is loading or encounters errors, so that I understand the current state of the application.

#### Acceptance Criteria

1. WHILE the driver detail data is loading, THE Driver_Detail_Page SHALL display a skeleton loader matching the layout of the tabbed content area
2. IF the API returns a 404 error, THEN THE Driver_Detail_Page SHALL display a "Driver not found" message with a link back to the driver listing
3. IF the API returns a network or server error, THEN THE Driver_Detail_Page SHALL display an error message with a Retry button that re-triggers the data fetch
4. THE Driver_Detail_Page SHALL wrap its content in an error boundary that catches unexpected rendering errors and displays a user-friendly fallback

### Requirement 8: Access Control

**User Story:** As a platform operator, I want the driver detail page restricted to administrators, so that sensitive driver data is protected.

#### Acceptance Criteria

1. THE Driver_Detail_API SHALL reject unauthenticated requests with a 401 status code
2. THE Driver_Detail_API SHALL reject requests from users without the `surewaka_admin` role with a 403 status code
3. THE Driver_Detail_Page SHALL render an "Access Denied" fallback message for non-admin users using the RoleGate component

### Requirement 9: Route Registration

**User Story:** As a developer, I want the driver detail route properly registered in the admin app's route configuration, so that navigation and URL matching work correctly.

#### Acceptance Criteria

1. THE Admin_Portal route configuration SHALL include a route entry `route('drivers/:driverId', 'routes/drivers.$driverId.tsx')` within the authenticated layout
2. THE Driver_Detail_Page route file SHALL be located at `apps/admin/app/routes/drivers.$driverId.tsx`
