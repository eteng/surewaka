# Requirements Document

## Introduction

This document defines the requirements for the SureWaka landing page — a public-facing marketing page designed to communicate the platform's value proposition, build trust with potential users (senders, SME e-commerce sellers, and logistics providers/drivers), and capture early interest through waitlist signups or contact submissions. The landing page serves as the first touchpoint for visitors discovering SureWaka.

## Glossary

- **Landing_Page**: The single-page public website that presents SureWaka's value proposition and captures visitor interest
- **Campaign_Page**: A focused marketing page for a specific campaign (e.g., Lagos launch, driver recruitment, Black Friday) with a minimal layout and single CTA
- **Visitor**: Any person who navigates to the SureWaka landing page URL
- **CTA_Button**: A call-to-action button that directs visitors to perform a specific action (e.g., join waitlist, get in touch)
- **Hero_Section**: The top-most visible area of the landing page containing the primary headline, subheadline, and main CTA
- **Waitlist_Form**: A form that collects visitor information (name, email, user type) to register interest in the platform
- **Navigation_Bar**: The fixed or sticky top bar containing the SureWaka logo and navigation links
- **Footer**: The bottom section of the landing page containing legal links, social media links, and contact information
- **Responsive_Layout**: A page layout that adapts to different screen sizes (mobile, tablet, desktop)
- **Marketing_Layout**: The shared layout for the main landing page (includes nav and footer)
- **Campaign_Layout**: A minimal layout for campaign pages (no nav, focused CTA, no distractions)

## Requirements

### Requirement 1: Hero Section Display

**User Story:** As a visitor, I want to immediately understand what SureWaka does when I land on the page, so that I can decide if the platform is relevant to me.

#### Acceptance Criteria

1. WHEN a Visitor loads the Landing_Page, THE Hero_Section SHALL display a headline that communicates SureWaka's core value proposition (connecting people who need to move goods with verified logistics providers)
2. WHEN a Visitor loads the Landing_Page, THE Hero_Section SHALL display a subheadline that elaborates on the platform's dual model (carrier aggregation and on-demand matching)
3. THE Hero_Section SHALL display at least one CTA_Button that directs the Visitor to the Waitlist_Form
4. WHEN a Visitor views the Landing_Page on a mobile device, THE Hero_Section SHALL remain fully readable without horizontal scrolling

### Requirement 2: Value Proposition Section

**User Story:** As a visitor, I want to understand the key benefits of using SureWaka, so that I can see how it solves my logistics problems.

#### Acceptance Criteria

1. THE Landing_Page SHALL display a section presenting at least three distinct benefits of the platform (e.g., price comparison, real-time tracking, verified providers)
2. WHEN a Visitor scrolls past the Hero_Section, THE Landing_Page SHALL display the value proposition section with clear visual separation from adjacent sections
3. THE Landing_Page SHALL present each benefit with a concise title and a supporting description of no more than two sentences

### Requirement 3: How It Works Section

**User Story:** As a visitor, I want to understand how SureWaka works step by step, so that I can visualize using the platform.

#### Acceptance Criteria

1. THE Landing_Page SHALL display a "How It Works" section with a minimum of three sequential steps explaining the user journey (e.g., request a delivery, compare options, track in real-time)
2. THE Landing_Page SHALL present each step with a step number, title, and brief description
3. WHEN a Visitor views the "How It Works" section, THE Landing_Page SHALL display the steps in a clear sequential order using visual indicators (numbers or connecting elements)

### Requirement 4: Audience Segments Section

**User Story:** As a visitor, I want to see that SureWaka serves my specific needs (as a sender, business, or driver), so that I feel the platform is built for me.

#### Acceptance Criteria

1. THE Landing_Page SHALL display a section addressing at least two distinct audience segments: senders/businesses and drivers/logistics providers
2. THE Landing_Page SHALL present each audience segment with a tailored message explaining the specific benefits for that segment
3. WHEN a Visitor views the audience segments section, THE Landing_Page SHALL provide a CTA_Button for each segment directing to the Waitlist_Form

### Requirement 5: Waitlist/Signup Form

**User Story:** As a visitor, I want to join the SureWaka waitlist, so that I can be notified when the platform launches.

#### Acceptance Criteria

1. THE Waitlist_Form SHALL collect the Visitor's full name and email address as required fields
2. THE Waitlist_Form SHALL include a selection for user type (sender, business, or driver/logistics provider)
3. WHEN a Visitor submits the Waitlist_Form with valid data, THE Landing_Page SHALL display a confirmation message acknowledging successful registration
4. IF a Visitor submits the Waitlist_Form with an invalid email format, THEN THE Landing_Page SHALL display an inline error message indicating the email is invalid
5. IF a Visitor submits the Waitlist_Form without completing required fields, THEN THE Landing_Page SHALL display inline error messages for each missing required field
6. WHEN a Visitor submits the Waitlist_Form successfully, THE Landing_Page SHALL store the submission data for later retrieval

### Requirement 6: Navigation and Branding

**User Story:** As a visitor, I want to easily navigate the landing page and recognize the SureWaka brand, so that I can find information quickly and trust the platform.

#### Acceptance Criteria

1. THE Navigation_Bar SHALL display the SureWaka logo and link back to the top of the Landing_Page when clicked
2. THE Navigation_Bar SHALL contain anchor links to each major section of the Landing_Page (How It Works, Benefits, Join Waitlist)
3. WHEN a Visitor scrolls down the Landing_Page, THE Navigation_Bar SHALL remain visible at the top of the viewport (sticky positioning)
4. WHEN a Visitor clicks a Navigation_Bar anchor link, THE Landing_Page SHALL smooth-scroll to the corresponding section

### Requirement 7: Footer Section

**User Story:** As a visitor, I want to find contact information and legal details, so that I can reach out to SureWaka or review their policies.

#### Acceptance Criteria

1. THE Footer SHALL display SureWaka's contact email address
2. THE Footer SHALL display links to SureWaka's social media profiles (at minimum: Twitter/X, LinkedIn, Instagram)
3. THE Footer SHALL display a copyright notice with the current year
4. THE Footer SHALL display links to Privacy Policy and Terms of Service pages

### Requirement 8: Responsive Design

**User Story:** As a visitor using a mobile phone, I want the landing page to display correctly on my device, so that I can read content and interact with forms without difficulty.

#### Acceptance Criteria

1. THE Responsive_Layout SHALL adapt the Landing_Page content to display correctly on viewports from 320px to 1920px wide
2. WHEN a Visitor views the Landing_Page on a viewport narrower than 768px, THE Navigation_Bar SHALL collapse into a hamburger menu icon
3. WHEN a Visitor taps the hamburger menu icon, THE Navigation_Bar SHALL expand to show all navigation links in a vertical list
4. THE Responsive_Layout SHALL ensure all CTA_Button elements have a minimum tap target size of 44x44 pixels on touch devices
5. WHEN a Visitor views the Landing_Page on a mobile device, THE Responsive_Layout SHALL stack content sections vertically in a single column

### Requirement 9: Performance and Loading

**User Story:** As a visitor on a potentially slow Nigerian mobile network, I want the landing page to load quickly, so that I don't abandon the page before seeing the content.

#### Acceptance Criteria

1. THE Landing_Page SHALL achieve a Largest Contentful Paint (LCP) of 2.5 seconds or less on a 4G connection
2. THE Landing_Page SHALL achieve a Cumulative Layout Shift (CLS) score of 0.1 or less
3. THE Landing_Page SHALL load all above-the-fold content without requiring JavaScript to render (server-side rendering or static HTML)
4. WHEN images are present below the fold, THE Landing_Page SHALL lazy-load those images to reduce initial page weight

### Requirement 10: Trust and Social Proof Section

**User Story:** As a visitor, I want to see evidence that SureWaka is credible and backed by real people, so that I feel confident joining the waitlist.

#### Acceptance Criteria

1. THE Landing_Page SHALL display a section introducing the founding team (Et and Yobo) with brief bios or a team description
2. THE Landing_Page SHALL display at least one trust indicator (e.g., number of waitlist signups, partner logos, or media mentions)
3. WHEN trust indicators include numeric values, THE Landing_Page SHALL display them with clear labels explaining what the numbers represent

### Requirement 11: Campaign Landing Pages Architecture

**User Story:** As a marketing team member, I want to create focused campaign landing pages for specific audiences or promotions, so that paid ad traffic converts better without distractions.

#### Acceptance Criteria

1. THE apps/landing app SHALL support two route layout groups: a Marketing_Layout (with nav/footer) for the main site and a Campaign_Layout (minimal, no nav) for campaign pages
2. WHEN a Visitor arrives on a Campaign_Page, THE page SHALL display only the campaign content and a single focused CTA without navigation links or footer distractions
3. THE Campaign_Layout SHALL support campaign-specific pages at routes like `/campaigns/lagos-launch`, `/campaigns/drivers`, `/campaigns/referral`
4. THE Campaign_Page SHALL reuse the same Waitlist_Form component as the main Landing_Page
5. WHEN a new campaign is needed, a developer SHALL be able to create a new campaign page by adding a single route file under the campaign layout without modifying shared components

### Requirement 12: Deployment and Hosting

**User Story:** As a developer, I want the landing page deployed to a CDN with automatic preview URLs, so that I can ship campaigns quickly and preview changes before going live.

#### Acceptance Criteria

1. THE Landing_Page SHALL be deployed to Vercel with the root directory set to `apps/landing`
2. WHEN a pull request is opened, THE deployment platform SHALL generate a unique preview URL for the changes
3. THE Landing_Page SHALL support custom domain configuration (surewaka.com)
4. THE Landing_Page SHALL be server-side rendered for optimal performance on slow Nigerian networks
5. THE deployment SHALL complete in under 2 minutes from push to live

### Requirement 13: Pre-Launch Access Protection

**User Story:** As the product owner, I want the landing page protected with basic authentication before launch, so that unwanted visitors cannot see the site while it's under development.

#### Acceptance Criteria

1. THE Landing_Page SHALL require HTTP Basic Authentication for all routes when the environment variable `BASIC_AUTH_ENABLED` is set to `true`
2. WHEN a Visitor accesses any page without valid credentials, THE Landing_Page SHALL return a 401 response with a browser-native authentication prompt
3. THE basic auth credentials SHALL be configured via environment variables (`BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`)
4. WHEN `BASIC_AUTH_ENABLED` is not set or is set to `false`, THE Landing_Page SHALL be publicly accessible without authentication
5. THE basic auth protection SHALL apply to all routes including campaign pages but SHALL NOT block static assets required for the authentication prompt to render
