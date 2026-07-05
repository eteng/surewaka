# Requirements Document

## Introduction

The Admin Customer Detail feature provides a comprehensive read-only detail page for individual customers at `/customers/:customerId` within the SureWaka admin dashboard. The page displays a profile header with avatar, contact information, tier and verification badges, followed by stat cards (deliveries, spend, health score, last active), and a tabbed content area with paginated delivery history and customer info. Two new API endpoints return customer profile data and paginated delivery history. The page follows established patterns from the existing driver detail page (`drivers.$driverId.tsx`), including back navigation, error boundary, loading skeleton, and responsive card layout.

## Glossary

- **Admin_Portal**: The SureWaka internal administration dashboard application (`apps/admin`)
- **Customer_Detail_Page**: The `/customers/:customerId` route within the Admin_Portal that displays comprehensive information about a single customer
- **Customer_Detail_API**: The REST API endpoint at `GET /api/v1/admin/customers/:id` that returns full customer detail data
- **Customer_Deliveries_API**: The REST API endpoint at `GET /api/v1/admin/customers/:id/deliveries` that returns paginated delivery history
- **CustomerDetail_Type**: The `CustomerDetail` TypeScript type exported from `@surewaka/shared` representing the full customer detail response shape
- **CustomerDeliveryItem_Type**: The `CustomerDeliveryItem` TypeScript type exported from `@surewaka/shared` representing a single delivery row
- **Profile_Header**: The top section of the Customer_Detail_Page displaying avatar, name, badges, and contact information
- **Stat_Cards**: Four metric cards showing total deliveries, total spent, health score, and last active
- **Delivery_History_Tab**: The default tab showing paginated delivery records for the customer
- **Customer_Info_Tab**: A secondary tab showing notification preferences, gender, and account details
- **Health_Score**: An integer 0-100 computed by the nightly cron, indicating customer engagement health (RFM-based)
- **Customer_Tier**: One of `power`, `regular`, `new`, or `dormant` as defined in the `customer_tier` database enum
- **RoleGate**: A frontend component that conditionally renders content based on the authenticated user's role

## Requirements

### Requirement 1: Customer Detail API Endpoint

**User Story:** As an admin, I want a backend API endpoint that returns complete information about a specific customer including their segment data, so that the frontend can render a detailed customer profile page.

#### Acceptance Criteria

1. THE Customer_Detail_API SHALL return a single customer's full detail in the response shape `{ data: CustomerDetail, error: null, meta: null }` with status 200
2. THE Customer_Detail_API SHALL join the `users` table with the `customer_segments` table (LEFT JOIN on user_id) to include tier, totalDeliveries, totalSpent, lastDeliveryAt, primaryCity, and healthScore fields
3. THE Customer_Detail_API SHALL only return users where `role = 'customer'`; requests for non-customer user IDs SHALL return status 404 with error code `NOT_FOUND`
4. THE Customer_Detail_API SHALL default segment fields to null/zero when no `customer_segments` row exists: tier=null, totalDeliveries=0, totalSpent=0, lastDeliveryAt=null, primaryCity=null, healthScore=0
5. THE Customer_Detail_API SHALL validate the `:id` path parameter as a valid UUID v4 and return status 400 with error code `VALIDATION_ERROR` for invalid formats
6. THE Customer_Detail_API SHALL return status 404 with error code `NOT_FOUND` and message "Customer not found" when no matching customer exists
7. THE Customer_Detail_API SHALL require a valid Bearer token (Clerk JWT) and return status 401 for missing/invalid tokens
8. THE Customer_Detail_API SHALL require the `surewaka_admin` role and return status 403 for users without this role

### Requirement 2: Customer Deliveries API Endpoint

**User Story:** As an admin, I want a paginated delivery history for a customer, so that I can review their delivery activity over time.

#### Acceptance Criteria

1. THE Customer_Deliveries_API SHALL return paginated deliveries in the response shape `{ data: CustomerDeliveryItem[], error: null, meta: { total, page, pageSize, totalPages } }` with status 200
2. THE Customer_Deliveries_API SHALL order results by `createdAt` descending (most recent first)
3. THE Customer_Deliveries_API SHALL return at most `pageSize` items in the `data` array
4. THE Customer_Deliveries_API SHALL compute `meta.totalPages` as `ceil(total / pageSize)` and use offset `(page - 1) * pageSize`
5. THE Customer_Deliveries_API SHALL default to `page = 1` and `pageSize = 10` when not specified
6. THE Customer_Deliveries_API SHALL reject `pageSize` values greater than 50 with status 400 and a validation error
7. THE Customer_Deliveries_API SHALL return `{ data: [], meta: { total: 0, page: 1, pageSize: 10, totalPages: 0 } }` for customers with no deliveries
8. THE Customer_Deliveries_API SHALL validate the `:id` path parameter as a valid UUID v4 and return status 400 for invalid formats
9. THE Customer_Deliveries_API SHALL require authentication and admin role (same as Customer_Detail_API)

### Requirement 3: Shared Types and Validation

**User Story:** As a developer, I want shared TypeScript types and Zod schemas for customer detail data, so that the API and frontend have a single source of truth.

#### Acceptance Criteria

1. THE `@surewaka/shared` package SHALL export a `CustomerDetail` type with fields: id (string), name (string), phone (string), email (string|null), avatarUrl (string|null), gender (string|null), verified (boolean), createdAt (string), notificationEmail (boolean), notificationSms (boolean), tier (CustomerTier|null), totalDeliveries (number), totalSpent (number), lastDeliveryAt (string|null), primaryCity (string|null), healthScore (number)
2. THE `@surewaka/shared` package SHALL export a `CustomerDeliveryItem` type with fields: id (string), status (string), pickupAddress (string), pickupCity (string), dropoffAddress (string), dropoffCity (string), packageDescription (string), packageCategory (string), price (number|null), amountPaid (number|null), paymentStatus (string), recipientName (string), recipientPhone (string), createdAt (string)
3. THE `@surewaka/shared` package SHALL export a `customerDetailDeliveryQuerySchema` Zod schema validating page (optional coerced int >= 1, default 1) and pageSize (optional coerced int >= 1 and <= 50, default 10)

### Requirement 4: Frontend Route and Navigation

**User Story:** As an admin, I want to navigate to a customer's detail page by clicking their row in the listing table, and easily return to the listing.

#### Acceptance Criteria

1. THE admin app routes SHALL include a `customers/:customerId` route mapped to `routes/customers.$customerId.tsx`
2. THE customer listing table rows SHALL be clickable and navigate to `/customers/:customerId`
3. THE Customer_Detail_Page SHALL display a "Back to Customers" link with a left arrow icon that navigates to `/customers`
4. THE Customer_Detail_Page SHALL set the browser tab title to "SureWaka Admin - Customer Detail"
5. THE Customer_Detail_Page SHALL wrap content in a RoleGate requiring the `surewaka_admin` role, displaying an "Access Denied" fallback for unauthorized users

### Requirement 5: Profile Header

**User Story:** As an admin, I want to see the customer's identity and key status at a glance when viewing their detail page.

#### Acceptance Criteria

1. THE Profile_Header SHALL display the customer's avatar image when `avatarUrl` is available, or initials (first letter of first and last name) in a placeholder circle when not
2. THE Profile_Header SHALL display the customer's full name as a prominent heading
3. THE Profile_Header SHALL display a colored tier badge next to the name (power=green, regular=blue, new=purple, dormant=gray) when tier is non-null, and no badge when tier is null
4. THE Profile_Header SHALL display a green "Verified" badge with a check icon for verified customers, or a gray "Unverified" badge for unverified customers
5. THE Profile_Header SHALL display the customer's phone number, and email when available
6. THE Profile_Header SHALL display "Member since [formatted date]" and the primary city when available

### Requirement 6: Stat Cards

**User Story:** As an admin, I want to see key customer metrics at a glance via stat cards, so I can quickly assess their value and engagement.

#### Acceptance Criteria

1. THE Stat_Cards section SHALL display four cards in a responsive grid: 4 columns on desktop (lg), 2 columns on tablet (sm), 1 column on mobile
2. THE Total Deliveries card SHALL display `totalDeliveries` as a numeric value
3. THE Total Spent card SHALL display `totalSpent` converted from kobo to Naira formatted as Nigerian currency (₦X,XXX format)
4. THE Health Score card SHALL display the score as "X/100" with a color-coded label: green "Healthy" for >= 70, yellow "At Risk" for 40-69, red "Critical" for < 40
5. THE Last Active card SHALL display a relative time string (e.g., "3 days ago") when `lastDeliveryAt` is available, or a dash (—) when null

### Requirement 7: Delivery History Tab

**User Story:** As an admin, I want to browse a customer's delivery history with pagination, so I can investigate their activity patterns.

#### Acceptance Criteria

1. THE Delivery_History_Tab SHALL display a table with columns: Status (badge), Package (description), Route (pickup city → dropoff city), Price (₦), and Date (formatted)
2. THE delivery status SHALL be displayed as a colored badge: delivered=green, cancelled/failed=red, pending=yellow, in-transit statuses=blue, draft=gray
3. THE Delivery_History_Tab SHALL show pagination controls with "Previous" and "Next" buttons and "Showing X-Y of Z" text when deliveries exceed one page
4. THE Delivery_History_Tab SHALL show a friendly empty state message when the customer has no deliveries
5. THE Delivery_History_Tab SHALL display a loading skeleton matching the table layout while data is loading
6. THE Delivery_History_Tab SHALL display an error message with a "Retry" button when the delivery fetch fails

### Requirement 8: Customer Info Tab

**User Story:** As an admin, I want to see additional customer account details like notification preferences and gender.

#### Acceptance Criteria

1. THE Customer_Info_Tab SHALL display notification preferences showing whether email and SMS notifications are enabled or disabled
2. THE Customer_Info_Tab SHALL display gender with proper capitalization (Woman, Man, Prefer not to disclose) or "Not specified" when null
3. THE Customer_Info_Tab SHALL display account details including the full formatted creation date and verification status

### Requirement 9: Loading and Error States

**User Story:** As an admin, I want clear feedback when the page is loading or encounters an error, following the frontend resilience standards.

#### Acceptance Criteria

1. THE Customer_Detail_Page SHALL display a skeleton loader matching the full page layout (back link shape, profile header shape, stat cards shapes, tab area shape) while customer data is loading
2. THE Customer_Detail_Page SHALL display an error message with a "Retry" button when the customer detail fetch fails
3. THE Customer_Detail_Page SHALL display a "Customer not found" message with a link back to the listing when the API returns 404
4. THE Customer_Detail_Page SHALL be wrapped in an error boundary that catches unhandled exceptions and renders a "Something went wrong" fallback with a "Try again" button

### Requirement 10: Frontend Data Hooks

**User Story:** As a developer, I want clean data-fetching hooks that handle loading, error, and abort states following established patterns.

#### Acceptance Criteria

1. THE `useCustomerDetail` hook SHALL abort in-flight requests via AbortController when the component unmounts or the customerId changes, without updating state on abort
2. THE `useCustomerDeliveries` hook SHALL re-fetch when the page parameter changes
3. THE hooks SHALL retrieve the Clerk auth token via `useAuth().getToken()` and include it as a Bearer token in the Authorization header
4. THE hooks SHALL set an `error` string state for non-2xx responses using the API error message
