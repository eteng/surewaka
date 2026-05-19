# Requirements Document

## Introduction

This feature adds a waitlist management view to the SureWaka admin dashboard, allowing the internal ops team to view, search, filter, and export waitlist submissions collected from the landing page. The waitlist captures potential users (senders, businesses, and drivers) who signed up before the platform launch.

## Glossary

- **Admin_Dashboard**: The SureWaka internal operations dashboard at `apps/admin/`, used by the ops team
- **Waitlist_API**: The Hono API endpoint(s) under `/api/v1/admin/waitlist` that serve waitlist data
- **Waitlist_Table**: The admin dashboard page displaying waitlist submissions in a tabular format
- **Waitlist_Signup**: A record in the `waitlist_signups` database table representing a single user who joined the waitlist
- **User_Type**: The category of a waitlist signup — one of `sender`, `business`, or `driver`
- **Source**: The origin page or campaign that led to the waitlist signup (e.g., `home`, `launch-campaign`)
- **Ops_User**: An authenticated SureWaka internal staff member with admin access
- **Pagination_Controls**: The set of UI elements (previous/next buttons, page number indicators, page size selector) that allow the Ops_User to navigate through paginated data
- **Page_Size_Selector**: A dropdown control allowing the Ops_User to choose how many records are displayed per page
- **Database_Index**: A database structure that improves the speed of data retrieval operations on a table at the cost of additional storage
- **Data_Table**: The shadcn/ui Data Table component pattern built on TanStack Table (@tanstack/react-table), providing headless table primitives for sorting, filtering, pagination, and column visibility

## Requirements

### Requirement 1: API Endpoint for Listing Waitlist Signups

**User Story:** As an ops team member, I want to fetch waitlist signups from the API, so that the admin dashboard can display them.

#### Acceptance Criteria

1. WHEN an authenticated Ops_User sends a GET request to `/api/v1/admin/waitlist`, THE Waitlist_API SHALL return a paginated list of Waitlist_Signup records ordered by creation date descending
2. THE Waitlist_API SHALL include pagination metadata containing total count, current page, page size, and total pages in the response `meta` field
3. WHEN the `page` or `pageSize` query parameters are provided, THE Waitlist_API SHALL paginate results accordingly with a default page size of 20 and a maximum page size of 100
4. IF an unauthenticated request is made to the waitlist endpoint, THEN THE Waitlist_API SHALL return a 401 Unauthorized response
5. IF a non-admin user makes a request to the waitlist endpoint, THEN THE Waitlist_API SHALL return a 403 Forbidden response

### Requirement 2: Search Waitlist Signups

**User Story:** As an ops team member, I want to search waitlist signups by name or email, so that I can quickly find specific submissions.

#### Acceptance Criteria

1. WHEN the `search` query parameter is provided, THE Waitlist_API SHALL filter results to include only Waitlist_Signup records where the full name or email contains the search term (case-insensitive)
2. WHEN the `search` query parameter is an empty string, THE Waitlist_API SHALL return all results without filtering
3. THE Waitlist_Table SHALL provide a search input field that triggers filtering as the Ops_User types, with a debounce delay of 300 milliseconds

### Requirement 3: Filter Waitlist Signups by User Type

**User Story:** As an ops team member, I want to filter waitlist signups by user type, so that I can view submissions from a specific audience segment.

#### Acceptance Criteria

1. WHEN the `userType` query parameter is provided with a valid value (sender, business, or driver), THE Waitlist_API SHALL return only Waitlist_Signup records matching that user type
2. WHEN the `userType` query parameter is not provided, THE Waitlist_API SHALL return Waitlist_Signup records of all user types
3. IF the `userType` query parameter contains an invalid value, THEN THE Waitlist_API SHALL return a 400 Bad Request response with a descriptive validation error
4. THE Waitlist_Table SHALL display filter controls allowing the Ops_User to select one user type or view all types

### Requirement 4: Filter Waitlist Signups by Source

**User Story:** As an ops team member, I want to filter waitlist signups by source, so that I can evaluate which channels are driving signups.

#### Acceptance Criteria

1. WHEN the `source` query parameter is provided, THE Waitlist_API SHALL return only Waitlist_Signup records matching that source value
2. WHEN the `source` query parameter is not provided, THE Waitlist_API SHALL return Waitlist_Signup records from all sources
3. THE Waitlist_Table SHALL display a source filter dropdown populated with distinct source values from the database

### Requirement 5: Display Waitlist Table in Admin Dashboard

**User Story:** As an ops team member, I want to see waitlist signups in a table on the admin dashboard, so that I can review who has signed up.

#### Acceptance Criteria

1. THE Waitlist_Table SHALL be implemented using the shadcn/ui Data_Table pattern built on TanStack Table (`@tanstack/react-table`) for column definitions, sorting state, pagination state, and filtering state management
2. THE Waitlist_Table SHALL display the following columns for each Waitlist_Signup: full name, email, user type, source, and signup date
3. THE Waitlist_Table SHALL be accessible via the `/waitlist` route in the Admin_Dashboard
4. THE Admin_Dashboard sidebar SHALL include a "Waitlist" navigation link under an appropriate section
5. WHILE the Waitlist_Table is loading data, THE Waitlist_Table SHALL display a skeleton loading state
6. IF the Waitlist_API returns an error, THEN THE Waitlist_Table SHALL display an error message with a retry option
7. WHEN no Waitlist_Signup records match the current filters, THE Waitlist_Table SHALL display an empty state message indicating no results were found
8. THE Waitlist_Table SHALL use server-side pagination, sorting, and filtering (manual mode in TanStack Table) with state synced to URL query parameters via the Waitlist_API
9. THE Waitlist_Table SHALL support column visibility toggling, allowing the Ops_User to show or hide columns via a dropdown menu

### Requirement 6: Waitlist Summary Statistics

**User Story:** As an ops team member, I want to see summary statistics about waitlist signups, so that I can quickly understand the overall signup volume and distribution.

#### Acceptance Criteria

1. THE Waitlist_Table page SHALL display summary cards showing: total signups count, count per user type (sender, business, driver), and signups in the last 7 days
2. WHEN filters are applied, THE summary cards SHALL reflect the unfiltered totals to provide consistent context
3. WHEN the Waitlist_API receives a GET request to `/api/v1/admin/waitlist/stats`, THE Waitlist_API SHALL return aggregate counts for total signups, per-user-type breakdown, and recent signup count (last 7 days)

### Requirement 7: Export Waitlist Data

**User Story:** As an ops team member, I want to export waitlist signups to CSV, so that I can share the data with other teams or perform offline analysis.

#### Acceptance Criteria

1. THE Waitlist_Table SHALL provide an export button that downloads the current filtered dataset as a CSV file
2. WHEN the Ops_User clicks the export button, THE Admin_Dashboard SHALL generate a CSV file containing all columns (full name, email, user type, source, signup date) for the currently filtered results
3. THE exported CSV file SHALL be named with the format `waitlist-export-YYYY-MM-DD.csv`

### Requirement 8: Sort Waitlist Signups

**User Story:** As an ops team member, I want to sort the waitlist table by different columns, so that I can organize the data in a way that helps my analysis.

#### Acceptance Criteria

1. THE Waitlist_Table SHALL support sorting by full name, email, user type, and signup date columns
2. WHEN the Ops_User clicks a column header, THE Waitlist_Table SHALL toggle the sort direction between ascending and descending for that column
3. THE Waitlist_Table SHALL indicate the current sort column and direction visually with an arrow icon

### Requirement 9: UI Pagination Controls

**User Story:** As an ops team member, I want pagination controls on the waitlist table, so that I can navigate through large datasets efficiently without loading all records at once.

#### Acceptance Criteria

1. THE Waitlist_Table SHALL display Pagination_Controls below the table containing previous page button, next page button, and current page number indicator
2. WHEN the Ops_User clicks the next page button, THE Waitlist_Table SHALL load and display the next page of results from the Waitlist_API
3. WHEN the Ops_User clicks the previous page button, THE Waitlist_Table SHALL load and display the previous page of results from the Waitlist_API
4. WHILE the current page is the first page, THE Waitlist_Table SHALL disable the previous page button
5. WHILE the current page is the last page, THE Waitlist_Table SHALL disable the next page button
6. THE Pagination_Controls SHALL display the total number of results and the current range of displayed records (e.g., "Showing 21–40 of 156")
7. THE Waitlist_Table SHALL provide a Page_Size_Selector with options of 10, 20, 50, and 100 records per page
8. WHEN the Ops_User changes the page size via the Page_Size_Selector, THE Waitlist_Table SHALL reset to page 1 and reload data with the selected page size
9. WHEN search or filter parameters change, THE Waitlist_Table SHALL reset to page 1 and reload data with the updated parameters
10. THE Pagination_Controls SHALL display the total page count alongside the current page number (e.g., "Page 2 of 8")

### Requirement 10: Query Performance and Database Optimization

**User Story:** As an ops team member, I want the waitlist table to load quickly even as the dataset grows, so that I can work efficiently without waiting for slow queries.

#### Acceptance Criteria

1. THE Waitlist_API SHALL use Database_Index structures on the `created_at`, `user_type`, `source`, and `email` columns of the `waitlist_signups` table to support efficient filtering and sorting
2. THE Waitlist_API SHALL execute a single optimized COUNT query for total record count rather than loading all records to count them in application code
3. THE Waitlist_API SHALL retrieve paginated results and total count in no more than two database queries per request (one for data, one for count)
4. WHEN search, filter, and sort parameters are combined, THE Waitlist_API SHALL construct a single query with all conditions applied at the database level rather than filtering in application code
5. THE Waitlist_API SHALL use offset-based pagination with LIMIT and OFFSET clauses applied at the database level
6. WHEN the stats endpoint is called, THE Waitlist_API SHALL compute aggregate counts using SQL COUNT with GROUP BY rather than fetching all rows and counting in application code
7. THE Waitlist_API SHALL use a composite Database_Index on (`user_type`, `created_at`) to support the combined filter-and-sort access pattern
8. THE Waitlist_API SHALL respond to paginated list requests within 500 milliseconds under normal load for datasets up to 100,000 records
