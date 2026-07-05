# Requirements Document

## Introduction

The Admin Deliveries feature provides SureWaka administrators with a comprehensive view of all delivery orders across the platform. The page replaces the current placeholder with a fully functional data table, contextual map visualization of delivery routes, and seed data for development and testing. The feature also addresses the naming clarity between "Deliveries" and "Orders" to ensure consistent, non-misleading terminology throughout the admin dashboard.

## Glossary

- **Admin_Dashboard**: The internal SureWaka admin application at `apps/admin` used by operations staff to manage platform activity
- **Deliveries_Page**: The route at `/deliveries` in the Admin_Dashboard that displays all delivery records
- **Delivery_Record**: A row in the `deliveries` database table representing a shipment request from a customer
- **Delivery_Status**: One of: draft, pending, accepted, en_route_pickup, arrived_pickup, picked_up, en_route_dropoff, arrived_dropoff, delivered, cancelled, failed, returned
- **Delivery_Map**: A visual map component displaying pickup and dropoff locations for one or more Delivery_Records
- **Admin_API**: The Hono-based REST API endpoints under `/api/v1/admin/` that serve admin-specific data
- **Seed_Script**: A development script that populates the deliveries table with realistic sample data for testing
- **Data_Table**: A tabular UI component with sorting, filtering, pagination, and search capabilities
- **Route_Line**: A visual line drawn on the Delivery_Map between pickup and dropoff coordinates
- **Realtime_Provider**: The Ably-backed pub/sub abstraction in `packages/realtime` used for live event delivery between server and clients
- **Delivery_Channel**: An Ably channel with the pattern `delivery:${deliveryId}` that broadcasts Delivery_Status change events
- **Driver_Location_Channel**: An Ably channel with the pattern `driver-location:${driverId}` that broadcasts high-frequency driver GPS coordinate updates
- **Status_Update_Event**: A realtime event named `status-update` published to a Delivery_Channel when a Delivery_Record transitions between statuses
- **Location_Update_Event**: A realtime event named `location-update` published to a Driver_Location_Channel containing the driver's current latitude and longitude
- **Lifecycle_Tab**: A tab on the Deliveries_Page that filters Delivery_Records by a specific lifecycle phase: All, Requests, Active, or Completed
- **Requests_Phase**: The pre-pickup demand phase encompassing Delivery_Records with a Delivery_Status of "draft", "pending", or "accepted" — deliveries awaiting driver assignment or pickup initiation
- **Active_Phase**: The transport/tracking phase encompassing Delivery_Records with a Delivery_Status of "en_route_pickup", "arrived_pickup", "picked_up", "en_route_dropoff", or "arrived_dropoff" — deliveries currently being fulfilled
- **Completed_Phase**: The terminal/historical phase encompassing Delivery_Records with a Delivery_Status of "delivered", "cancelled", "failed", or "returned" — deliveries that have reached a final state
- **Tab_Count_Badge**: A numeric indicator displayed alongside a Lifecycle_Tab label showing the current count of Delivery_Records in that tab's lifecycle phase

## Requirements

### Requirement 1: Delivery Listing with Data Table

**User Story:** As an admin, I want to see all deliveries in a sortable, filterable table, so that I can monitor platform delivery activity at a glance.

#### Acceptance Criteria

1. WHEN the admin navigates to the Deliveries_Page, THE Admin_API SHALL return a paginated list of all Delivery_Records ordered by creation date descending, with a default page size of 20 and a maximum page size of 100
2. THE Data_Table SHALL display the following columns: tracking reference, customer name, pickup city, dropoff city, status, package category, price, and creation date
3. WHEN the admin clicks a sortable column header (tracking reference, customer name, status, price, or creation date), THE Data_Table SHALL sort records by that column, toggling between ascending and descending order on consecutive clicks
4. WHEN the admin enters at least 2 characters in the search field, THE Data_Table SHALL filter Delivery_Records by customer name, pickup address, or dropoff address within 300 milliseconds of the last keystroke; the search field SHALL allow typing at any length but SHALL NOT trigger filtering until the input contains at least 2 characters
5. WHEN the admin selects a status filter, THE Data_Table SHALL display only Delivery_Records matching the selected Delivery_Status values
6. THE Data_Table SHALL display pagination controls showing current page, total pages, and a records-per-page selector with options of 10, 20, 50, and 100
7. IF the Admin_API returns an error, THEN THE Deliveries_Page SHALL always display an error message indicating the failure reason with a retry button that re-fetches the current page; errors SHALL NOT be handled silently
8. IF the applied filters and search return no matching Delivery_Records, THEN THE Data_Table SHALL display an empty state message indicating no results were found and suggesting the admin adjust filters

### Requirement 2: Delivery Detail View

**User Story:** As an admin, I want to view complete details of a specific delivery, so that I can investigate issues or answer customer inquiries.

#### Acceptance Criteria

1. WHEN the admin clicks a row in the Data_Table, THE Deliveries_Page SHALL navigate to a detail view for that Delivery_Record
2. THE detail view SHALL display the following Delivery_Record information organized by section: customer section (customer name, sender phone), recipient section (recipient name, recipient phone), driver section (driver name), carrier section (carrier name), pickup section (pickup address, pickup city), dropoff section (dropoff address, dropoff city), package section (package description, package weight, package category, delivery notes), pricing section (price, amount paid, payment status), and status section (current Delivery_Status, created date, last updated date)
3. THE detail view SHALL display the Delivery_Map showing the pickup location marker, dropoff location marker, and a Route_Line connecting them
4. IF the Delivery_Record has no assigned driver, THEN THE detail view SHALL display "Unassigned" in the driver section
5. IF the Delivery_Record has no assigned carrier, THEN THE detail view SHALL display "Unassigned" in the carrier section
6. IF the admin navigates to a detail view for a Delivery_Record that does not exist, THEN THE Deliveries_Page SHALL display the detail view layout with an error message indicating the delivery was not found and a link to return to the delivery list; both elements SHALL be displayed together

### Requirement 3: Map Visualization

**User Story:** As an admin, I want to see delivery locations on a map, so that I can understand geographic distribution and route patterns.

#### Acceptance Criteria

1. WHEN the admin activates the map view on the Deliveries_Page, THE Delivery_Map SHALL render pickup and dropoff markers for all visible Delivery_Records within 2 seconds of activation
2. THE Delivery_Map SHALL use two visually distinguishable marker colors — one assigned to pickup locations and a different one assigned to dropoff locations — and display a legend identifying each color
3. WHEN the admin clicks a marker on the Delivery_Map, THE Delivery_Map SHALL display a popup with the Delivery_Record summary (customer name, status, address) and dismiss any previously open popup
4. WHEN markers are added, removed, or filtered on the Delivery_Map, THE Delivery_Map SHALL adjust the viewport bounds to contain all currently visible markers within 500 milliseconds
5. WHEN the admin hovers over a row in the Data_Table, THE Delivery_Map SHALL visually distinguish the corresponding pickup and dropoff markers by increasing their size or adding a visible border ring, and WHEN the admin moves the cursor away from the row, THE Delivery_Map SHALL return the markers to their default appearance
6. IF a Delivery_Record has missing or invalid coordinates (including out-of-range values) for pickup or dropoff, THEN THE Delivery_Map SHALL omit that marker and display a count of records with unavailable locations; both missing coordinate fields and invalid coordinate values SHALL be counted as unavailable
7. IF no Delivery_Records with valid coordinates are visible, THEN THE Delivery_Map SHALL display a default viewport centered on the service area with a message indicating no locations are available to display

### Requirement 4: Naming Clarity and Label Consistency

**User Story:** As an admin, I want consistent and clear terminology across the dashboard, so that I am not confused by misleading labels.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL use the term "Deliveries" as the primary navigation label for the shipment management section in the sidebar
2. THE Deliveries_Page header SHALL display "Deliveries" as the page heading with the subtitle "Monitor and manage all delivery orders across the platform"
3. THE Admin_Dashboard sidebar SHALL display "Deliveries" under the "Operations" group, and the breadcrumb SHALL render the path "Operations > Deliveries" when the Deliveries page is active
4. WHEN displaying individual record references in table rows, detail page headings, modal titles, and toast notifications, THE Admin_Dashboard SHALL use "delivery" (singular) rather than "order", "shipment", or "parcel" to maintain consistent domain language
5. THE Admin_Dashboard SHALL display the browser tab title as "SureWaka Admin - Deliveries" when the Deliveries page is active
6. THE Admin_Dashboard SHALL NOT use the terms "order", "shipment", or "parcel" in any user-visible label, heading, or navigation element when referring to delivery records

### Requirement 5: Seed Data Script

**User Story:** As a developer, I want sample delivery data in the database, so that I can develop and test the Deliveries_Page without waiting for real user activity.

#### Acceptance Criteria

1. THE Seed_Script SHALL generate at least 50 Delivery_Records with street-level Nigerian addresses (including street name and area/neighbourhood) spanning Lagos, Abuja, and Port Harcourt
2. THE Seed_Script SHALL distribute Delivery_Records across all 12 Delivery_Status values (draft, pending, accepted, en_route_pickup, arrived_pickup, picked_up, en_route_dropoff, arrived_dropoff, delivered, cancelled, failed, returned) with at least 2 records per status
3. THE Seed_Script SHALL assign valid coordinates (latitude and longitude) for all pickup and dropoff locations within Nigerian geographic bounds (latitude 4.0–14.0, longitude 2.5–14.5)
4. THE Seed_Script SHALL populate package categories across all five defined types: document, parcel, fragile, heavy, food
5. THE Seed_Script SHALL associate Delivery_Records with existing user records in the database or create temporary test users if none exist, creating at least 3 distinct customer users to simulate multiple senders
6. THE Seed_Script SHALL be idempotent: running the script multiple times SHALL NOT create duplicate seed records, using a deterministic identifier or marker to detect previously-seeded data
7. THE Seed_Script SHALL populate all required delivery fields including recipient_name, recipient_phone (valid Nigerian format starting with +234), package_description (1–200 characters), package_weight (0.1–500.0 kg), and price (100–50000 Naira)
8. WHEN a Delivery_Record has a status beyond "accepted" (en_route_pickup through returned), THE Seed_Script SHALL assign a valid driver_id referencing an existing or newly-created test driver record
9. THE Seed_Script SHALL distribute created_at timestamps across the past 30 days so that date-based filtering and sorting can be tested

### Requirement 6: Admin Deliveries API Endpoints

**User Story:** As a frontend developer, I want dedicated admin API endpoints for deliveries, so that the Deliveries_Page can fetch data with admin-level access and filtering.

#### Acceptance Criteria

1. THE Admin_API SHALL expose a `GET /api/v1/admin/deliveries` endpoint that returns paginated Delivery_Records with metadata containing total record count, current page, pageSize, and totalPages
2. THE Admin_API endpoint SHALL accept query parameters for: page (integer, minimum 1, default 1), pageSize (integer, minimum 1, maximum 100, default 20), search (string, maximum 200 characters, matched against customer name, customer phone, recipient name, recipient phone, pickup address, and dropoff address), status (one of: draft, pending, accepted, en_route_pickup, arrived_pickup, picked_up, en_route_dropoff, arrived_dropoff, delivered, cancelled, failed, returned), sortBy (one of: createdAt, status, customerName, price; default createdAt), and sortDir (one of: asc, desc; default desc)
3. THE Admin_API endpoint SHALL join customer and driver information so the response includes customer name, customer phone, and driver name for each Delivery_Record
4. THE Admin_API SHALL expose a `GET /api/v1/admin/deliveries/:id` endpoint that SHALL always return a single Delivery_Record with full related entity data including customer details, driver details, and carrier details; incomplete responses are not acceptable
5. IF the `:id` parameter is not a valid UUID or no Delivery_Record exists for the given ID, THEN THE Admin_API SHALL return a 404 status code with an error response indicating the delivery was not found
6. WHEN an unauthenticated request is made, THE Admin_API SHALL return a 401 status code
7. WHEN a non-admin user makes a request, THE Admin_API SHALL return a 403 status code
8. IF query parameters fail validation, THEN THE Admin_API SHALL return a 400 status code with an error response indicating which parameters are invalid

### Requirement 7: Loading and Empty States

**User Story:** As an admin, I want clear visual feedback when data is loading or when no deliveries exist, so that I understand the system state.

#### Acceptance Criteria

1. WHILE the Deliveries_Page is fetching data, THE Data_Table SHALL display a skeleton loader with between 5 and 10 placeholder rows matching the table column layout
2. WHEN the Admin_API returns zero Delivery_Records and no filters are active, THE Deliveries_Page SHALL immediately transition from the skeleton loader to an empty state with an icon, a heading indicating no deliveries exist, and body text describing next steps; no intermediate loading phase SHALL be displayed
3. WHEN the Admin_API returns zero Delivery_Records and one or more filters are active, THE Deliveries_Page SHALL display a "No matching deliveries" message with a "Clear filters" button that, when activated, removes all active filters and re-fetches the unfiltered delivery list


### Requirement 8: Real-Time Delivery Tracking

**User Story:** As an admin, I want to see live delivery status changes and driver locations on the map without refreshing, so that I can monitor active deliveries in real time.

#### Acceptance Criteria

1. WHEN the admin opens a delivery detail view for a Delivery_Record with an assigned driver, THE Deliveries_Page SHALL subscribe to the Delivery_Channel (`delivery:${deliveryId}`) and the Driver_Location_Channel (`driver-location:${driverId}`) using the Realtime_Provider
2. WHEN a Status_Update_Event is received on the Delivery_Channel, THE detail view SHALL update the displayed Delivery_Status within 1 second without requiring a page refresh
3. WHEN a Location_Update_Event is received on the Driver_Location_Channel, THE Delivery_Map SHALL update the driver's position marker to the new coordinates within 500 milliseconds and animate the transition from the previous position over a duration of 300 milliseconds
4. WHILE the admin is viewing the delivery detail view, THE Delivery_Map SHALL display a driver marker that uses a distinct icon and color from the pickup and dropoff markers, showing the driver's current location
5. WHEN the admin navigates away from the delivery detail view, THE Deliveries_Page SHALL unsubscribe from the Delivery_Channel and Driver_Location_Channel to release realtime connections
6. IF the Realtime_Provider connection is lost, THEN THE Deliveries_Page SHALL display a non-dismissible banner indicating that live updates are unavailable and attempt to reconnect automatically every 5 seconds for a maximum of 30 attempts; IF all 30 attempts are exhausted, THEN THE banner SHALL change to indicate that reconnection has failed and offer a manual reconnect button
7. WHEN the Realtime_Provider reconnects after a disconnection, THE Deliveries_Page SHALL re-fetch the current Delivery_Record state from the Admin_API and re-subscribe to the relevant channels
8. IF the Delivery_Record has no assigned driver, THEN THE Deliveries_Page SHALL subscribe only to the Delivery_Channel and omit the driver location marker from the Delivery_Map
9. IF the Admin_API re-fetch after reconnection fails, THEN THE Deliveries_Page SHALL retain the last known data, display an error message indicating the refresh failed, and allow the admin to trigger a manual retry
10. WHEN a Status_Update_Event indicating a terminal status (delivered, cancelled, or failed) is received on the Delivery_Channel, THE Deliveries_Page SHALL unsubscribe from both the Delivery_Channel and the Driver_Location_Channel and remove the driver marker from the Delivery_Map

### Requirement 9: Tabbed Lifecycle Views

**User Story:** As an admin, I want the Deliveries page organized into lifecycle tabs (All, Requests, Active, Completed), so that I can focus on deliveries at a specific stage without manual filtering.

#### Acceptance Criteria

1. THE Deliveries_Page SHALL display a tab bar with four Lifecycle_Tabs in the following order: "All", "Requests", "Active", and "Completed", with the "All" tab selected by default
2. WHEN the admin selects the "All" Lifecycle_Tab, THE Data_Table SHALL display all Delivery_Records regardless of status, retaining the full filter, sort, and search capabilities defined in Requirement 1
3. WHEN the admin selects the "Requests" Lifecycle_Tab, THE Data_Table SHALL display only Delivery_Records in the Requests_Phase (draft, pending, or accepted), ordered by creation date ascending so the oldest unmatched requests appear first
4. WHEN the admin selects the "Active" Lifecycle_Tab, THE Data_Table SHALL display only Delivery_Records in the Active_Phase (en_route_pickup, arrived_pickup, picked_up, en_route_dropoff, or arrived_dropoff), ordered by last status change descending
5. WHEN the admin selects the "Completed" Lifecycle_Tab, THE Data_Table SHALL display only Delivery_Records in the Completed_Phase (delivered, cancelled, failed, or returned), ordered by creation date descending
6. THE Deliveries_Page SHALL display a Tab_Count_Badge on each Lifecycle_Tab showing the total number of Delivery_Records in that tab's lifecycle phase, and the "All" tab badge SHALL show the total count across all statuses
7. WHEN a Status_Update_Event is received indicating a Delivery_Record has transitioned into the Requests_Phase, THE "Requests" Lifecycle_Tab SHALL add the record to its list and update its Tab_Count_Badge within 2 seconds without requiring a page refresh
8. WHEN a Status_Update_Event is received indicating a Delivery_Record has transitioned out of the Requests_Phase, THE "Requests" Lifecycle_Tab SHALL remove the record from its list and update its Tab_Count_Badge within 2 seconds without requiring a page refresh
9. WHEN a Status_Update_Event is received indicating a Delivery_Record has transitioned into or out of the Active_Phase, THE "Active" Lifecycle_Tab SHALL add or remove the record accordingly and update its Tab_Count_Badge within 2 seconds without requiring a page refresh
10. WHEN the admin switches between Lifecycle_Tabs while a search query is active, THE Data_Table SHALL preserve the search text and apply it within the new tab's lifecycle filter
11. WHEN the admin switches between Lifecycle_Tabs while a status filter is active on the "All" tab, THE Data_Table SHALL reset the status filter because the lifecycle phase provides an implicit status constraint
12. THE "Requests" Lifecycle_Tab SHALL visually distinguish between "draft", "pending", and "accepted" Delivery_Records using distinct status badges or color coding
13. THE Data_Table in the "Requests" Lifecycle_Tab SHALL display the following columns: tracking reference, customer name, pickup city, dropoff city, status, time elapsed since creation (updated every 60 seconds in the format "Xh Ym" for durations under 24 hours or "Xd Yh" for durations of 24 hours or more), and package category
14. IF the selected Lifecycle_Tab contains zero Delivery_Records, THEN THE Data_Table SHALL display only the empty state message appropriate to the currently selected phase: "No pending requests" for Requests, "No active deliveries" for Active, and "No completed deliveries" for Completed; messages for other tabs SHALL NOT be shown
