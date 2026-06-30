# Requirements Document

## Introduction

The Admin Driver Listing feature provides SureWaka administrators with a comprehensive view of all registered drivers on the platform. This feature replaces the current placeholder empty state on the `/drivers` route with a fully functional data table supporting search, filtering, sorting, pagination, and CSV export. The listing displays driver-specific information including vehicle details, verification and availability status, performance metrics, and carrier affiliation. It follows the same architectural pattern established by the existing customer listing page.

## Glossary

- **Admin_Portal**: The SureWaka internal administration dashboard application (`apps/admin`)
- **Driver_Listing_Page**: The `/drivers` route within the Admin_Portal that displays a paginated table of all drivers
- **Driver_API**: The REST API endpoint at `/api/v1/admin/drivers` that returns driver data with filtering, sorting, and pagination
- **Driver_Table**: The TanStack Table-based data table component rendering driver records
- **Driver_Toolbar**: The toolbar component containing search input and filter controls
- **Driver_Pagination**: The pagination component controlling page navigation and page size
- **Driver_Record**: A single row in the listing representing one driver, combining data from the `drivers`, `users`, and optionally `carrier_members` tables
- **Vehicle_Type**: One of `motorcycle`, `car`, `van`, or `truck` as defined in the `vehicle_type` database enum
- **Carrier_Affiliation**: The carrier a driver belongs to, determined via the `carrier_members` table where the member is active
- **Performance_Metrics**: Aggregate data about a driver including total completed deliveries and average rating

## Requirements

### Requirement 1: Driver Listing API Endpoint

**User Story:** As an admin, I want a backend API endpoint that returns driver data with filtering and pagination, so that the frontend can render a performant listing.

#### Acceptance Criteria

1. THE Driver_API SHALL return a paginated list of Driver_Records in the response shape `{ data, error, meta }`
2. THE Driver_API SHALL join drivers with users to include `name`, `phone`, and `email` fields on each Driver_Record
3. THE Driver_API SHALL include carrier affiliation data (carrier name) by joining through `carrier_members` where `is_active` is true
4. THE Driver_API SHALL include a `totalDeliveries` count for each driver derived from the `deliveries` table where status is `delivered`
5. WHEN a `search` query parameter is provided, THE Driver_API SHALL filter results by matching against driver name or phone number (case-insensitive partial match)
6. WHEN a `vehicleType` query parameter is provided, THE Driver_API SHALL filter results to only drivers with that vehicle type
7. WHEN a `verified` query parameter is provided, THE Driver_API SHALL filter results to only drivers matching that verification status
8. WHEN an `available` query parameter is provided, THE Driver_API SHALL filter results to only drivers matching that availability status
9. WHEN a `carrierId` query parameter is provided, THE Driver_API SHALL filter results to only drivers affiliated with that carrier
10. WHEN an `affiliation` query parameter of `independent` is provided, THE Driver_API SHALL filter results to only drivers with no active carrier membership
11. WHEN an `affiliation` query parameter of `carrier` is provided, THE Driver_API SHALL filter results to only drivers with an active carrier membership
12. THE Driver_API SHALL support sorting by `createdAt`, `rating`, `name`, and `totalDeliveries` columns in ascending or descending order
13. THE Driver_API SHALL return pagination metadata including `page`, `pageSize`, `total`, and `totalPages`
14. THE Driver_API SHALL validate query parameters using a Zod schema and return a 400 response with validation errors for invalid input
15. THE Driver_API SHALL require authentication and the `surewaka_admin` role

### Requirement 2: Driver Listing Data Table

**User Story:** As an admin, I want to see a table of all drivers with relevant information, so that I can quickly assess driver status and find specific drivers.

#### Acceptance Criteria

1. THE Driver_Table SHALL display the following columns: Name (with avatar), Phone, Vehicle Type, Verified status, Available status, Rating, Total Deliveries, Carrier, and Joined date
2. WHEN a column header is clicked, THE Driver_Table SHALL toggle server-side sorting between ascending and descending for that column
3. THE Driver_Table SHALL indicate the currently active sort column and direction with a visual arrow indicator
4. WHEN a driver row is clicked, THE Driver_Table SHALL navigate to `/drivers/{driverId}` for that driver's detail view
5. WHILE data is loading, THE Driver_Table SHALL display skeleton rows matching the shape of the expected table content
6. WHEN no drivers match the current filters, THE Driver_Table SHALL display an empty state with a descriptive message and icon
7. IF the API returns an error, THEN THE Driver_Table SHALL display an error message with a Retry button that re-triggers the data fetch

### Requirement 3: Driver Search and Filters

**User Story:** As an admin, I want to search and filter the driver list, so that I can quickly find specific drivers or view subsets of drivers.

#### Acceptance Criteria

1. THE Driver_Toolbar SHALL provide a text search input that filters drivers by name or phone number
2. WHEN the search input value changes, THE Driver_Toolbar SHALL debounce the search for 300 milliseconds before triggering a new API request
3. THE Driver_Toolbar SHALL provide a vehicle type filter dropdown with options: All, Motorcycle, Car, Van, Truck
4. THE Driver_Toolbar SHALL provide a verification status filter with options: All, Verified, Unverified
5. THE Driver_Toolbar SHALL provide an availability status filter with options: All, Available, Unavailable
6. THE Driver_Toolbar SHALL provide an affiliation filter with options: All, Independent, Carrier-affiliated
7. WHEN any filter value changes, THE Driver_Listing_Page SHALL reset the current page to 1 and fetch updated results
8. THE Driver_Toolbar SHALL persist filter and search values in the URL query string so that page state is shareable and survives browser refresh

### Requirement 4: Driver Listing Pagination

**User Story:** As an admin, I want to paginate through the driver list, so that I can navigate large datasets efficiently.

#### Acceptance Criteria

1. THE Driver_Pagination SHALL display the current page, total pages, and total driver count
2. THE Driver_Pagination SHALL provide Next and Previous page navigation buttons
3. THE Driver_Pagination SHALL provide a page size selector with options: 10, 20, 50, 100
4. WHEN the page size changes, THE Driver_Pagination SHALL reset the current page to 1
5. WHILE on the first page, THE Driver_Pagination SHALL disable the Previous button
6. WHILE on the last page, THE Driver_Pagination SHALL disable the Next button

### Requirement 5: Driver Listing CSV Export

**User Story:** As an admin, I want to export the current driver list to CSV, so that I can share data with stakeholders or perform offline analysis.

#### Acceptance Criteria

1. THE Driver_Toolbar SHALL provide an Export CSV button
2. WHEN the Export CSV button is clicked, THE Driver_Listing_Page SHALL fetch all drivers matching the current filters (up to 10,000 records) and generate a CSV file
3. THE CSV file SHALL include columns: Name, Phone, Email, Vehicle Type, License Plate, Vehicle Model, Verified, Available, Rating, Total Deliveries, Carrier, Joined
4. THE CSV file SHALL be named `surewaka-drivers-{YYYY-MM-DD}.csv` using the current date
5. WHILE the export is in progress, THE Driver_Toolbar SHALL disable the Export CSV button and display a loading indicator

### Requirement 6: Driver Listing Query Parameter Schema

**User Story:** As a developer, I want a shared Zod validation schema for driver listing query parameters, so that both frontend and backend can validate consistently.

#### Acceptance Criteria

1. THE `@surewaka/shared` package SHALL export a `driverListQuerySchema` Zod schema that validates all supported query parameters
2. THE `driverListQuerySchema` SHALL validate `page` as a positive integer defaulting to 1
3. THE `driverListQuerySchema` SHALL validate `pageSize` as an integer between 1 and 100 defaulting to 20
4. THE `driverListQuerySchema` SHALL validate `search` as an optional string with a maximum length of 200 characters
5. THE `driverListQuerySchema` SHALL validate `vehicleType` as an optional enum of `motorcycle`, `car`, `van`, or `truck`
6. THE `driverListQuerySchema` SHALL validate `verified` as an optional enum of `true` or `false`
7. THE `driverListQuerySchema` SHALL validate `available` as an optional enum of `true` or `false`
8. THE `driverListQuerySchema` SHALL validate `carrierId` as an optional UUID string
9. THE `driverListQuerySchema` SHALL validate `affiliation` as an optional enum of `independent` or `carrier`
10. THE `driverListQuerySchema` SHALL validate `sortBy` as an optional enum of `createdAt`, `rating`, `name`, or `totalDeliveries` defaulting to `createdAt`
11. THE `driverListQuerySchema` SHALL validate `sortDir` as an optional enum of `asc` or `desc` defaulting to `desc`

### Requirement 7: Driver List Item Type

**User Story:** As a developer, I want a shared TypeScript type for driver list items, so that the API response and frontend rendering use a consistent contract.

#### Acceptance Criteria

1. THE `@surewaka/shared` package SHALL export a `DriverListItem` type representing a single driver in the listing
2. THE `DriverListItem` type SHALL include: `id` (string), `name` (string), `phone` (string), `email` (string or null), `avatarUrl` (string or null), `vehicleType` (Vehicle_Type), `licensePlate` (string), `vehicleModel` (string), `verified` (boolean), `available` (boolean), `rating` (number), `totalDeliveries` (number), `carrierName` (string or null), `carrierId` (string or null), `createdAt` (string)

### Requirement 8: Access Control

**User Story:** As a platform operator, I want the driver listing restricted to administrators, so that sensitive driver data is protected.

#### Acceptance Criteria

1. THE Driver_API SHALL reject unauthenticated requests with a 401 status code
2. THE Driver_API SHALL reject requests from users without the `surewaka_admin` role with a 403 status code
3. THE Driver_Listing_Page SHALL render an "Access Denied" fallback message for non-admin users using the `RoleGate` component
