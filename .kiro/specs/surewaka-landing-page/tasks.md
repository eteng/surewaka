# Implementation Plan: SureWaka Landing Page

## Overview

Build the SureWaka marketing landing page inside `apps/landing` using React Router v7 (SSR), Tailwind CSS v4, and Supabase for waitlist signups. Implementation follows a bottom-up approach: shared schemas and data layer first, then middleware, then layout/routing, then page sections, and finally campaign pages.

## Tasks

- [x] 1. Add waitlist data model and validation schema
  - [x] 1.1 Add `waitlistUserTypeEnum` and `waitlistSignups` table to `packages/db/src/schema.ts`
    - Add `waitlist_user_type` enum with values: `sender`, `business`, `driver`
    - Add `waitlist_signups` table with columns: `id`, `full_name`, `email` (unique), `user_type`, `source`, `created_at`, `updated_at`
    - Export the new table and enum
    - _Requirements: 5.6_

  - [x] 1.2 Add `waitlistSignupSchema` to `packages/shared/src/validators.ts`
    - Add Zod schema: `fullName` (string, min 2, max 100), `email` (string, email), `userType` (enum sender/business/driver), `source` (optional string, default 'home')
    - Export `WaitlistSignup` type inferred from the schema
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

  - [x] 1.3 Write property tests for waitlist validation schema (Properties 2 & 3)
    - **Property 2: Invalid email rejection** — Generate strings that are not valid emails (missing @, missing domain, consecutive dots, trailing dots). Verify `waitlistSignupSchema.safeParse` returns error with email field message.
    - **Validates: Requirements 5.4**
    - **Property 3: Missing required fields produce per-field errors** — Generate random subsets of {fullName, email, userType} to omit. Verify error field names exactly match omitted fields.
    - **Validates: Requirements 5.5**

- [x] 2. Implement basic auth middleware
  - [x] 2.1 Create `apps/landing/app/middleware/basic-auth.server.ts`
    - Export `requireBasicAuth(request: Request): Response | null`
    - When `BASIC_AUTH_ENABLED` !== `"true"`, return `null` (allow through)
    - When enabled, decode `Authorization: Basic` header and compare against `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` env vars
    - On failure, return `new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="SureWaka"' } })`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 2.2 Write property test for basic auth middleware (Property 4)
    - **Property 4: Basic auth middleware correctly gates access**
    - Generate tuples of (enabled: boolean, requestCredentials: string | null, configuredUser: string, configuredPassword: string). Verify 401 iff enabled AND credentials don't match.
    - **Validates: Requirements 13.1, 13.2, 13.4**

- [x] 3. Set up route architecture and layouts
  - [x] 3.1 Update `apps/landing/app/routes.ts` with layout groups
    - Import `layout` and `route` from `@react-router/dev/routes`
    - Define marketing layout group wrapping: index (`routes/home.tsx`), `privacy`, `terms`
    - Define campaign layout group wrapping: `campaigns/lagos-launch`, `campaigns/drivers`, `campaigns/referral`
    - _Requirements: 11.1, 11.3, 11.5_

  - [x] 3.2 Create `apps/landing/app/layouts/marketing-layout.tsx`
    - Import and render `<Navbar />`, `<Outlet />`, `<Footer />`
    - Call `requireBasicAuth` in the layout's `loader` function; if it returns a Response, throw it
    - _Requirements: 6.1, 6.2, 7.1, 13.1_

  - [x] 3.3 Create `apps/landing/app/layouts/campaign-layout.tsx`
    - Minimal layout: SureWaka logo at top, `<Outlet />` below
    - No nav links, no footer
    - Call `requireBasicAuth` in the layout's `loader` function
    - _Requirements: 11.1, 11.2, 13.5_

- [x] 4. Checkpoint - Ensure route structure compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Build shared components (Navbar, Footer, WaitlistForm)
  - [x] 5.1 Create `apps/landing/app/components/navbar.tsx`
    - Sticky positioning (`sticky top-0 z-50`)
    - SureWaka logo linking to `#top` or `/`
    - Desktop: horizontal links (How It Works, Benefits, Join Waitlist) + CTA button
    - Mobile (<768px): hamburger icon toggling a vertical menu
    - Smooth scroll on anchor link click via `scroll-behavior: smooth`
    - Minimum 44x44px tap targets for mobile links
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2, 8.3, 8.4_

  - [x] 5.2 Create `apps/landing/app/components/footer.tsx`
    - SureWaka logo + tagline
    - Section navigation links
    - Social media links (Twitter/X, LinkedIn, Instagram) with `lucide-react` icons
    - Legal links: Privacy Policy (`/privacy`), Terms of Service (`/terms`)
    - Contact email display
    - Copyright notice with dynamic current year
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 5.3 Create `apps/landing/app/components/waitlist-form.tsx`
    - Accept `source` prop (defaults to `'home'`)
    - Use React Router's `<Form method="post">` for progressive enhancement
    - Fields: `fullName` (text input, required), `email` (email input, required), `userType` (select with options: Sender, Business, Driver/Logistics Provider)
    - Hidden field for `source`
    - Display inline validation errors from `useActionData()`
    - Show success confirmation message when submission succeeds (hide form)
    - Use `useNavigation()` for loading/submitting state on the button
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.4 Create `apps/landing/app/lib/supabase.server.ts`
    - Import `createServiceClient` from `@surewaka/supabase`
    - Export `getSupabaseAdmin()` helper function
    - _Requirements: 5.6_

- [x] 6. Implement home page sections
  - [x] 6.1 Refactor `apps/landing/app/routes/home.tsx` — Hero section
    - Headline communicating core value proposition (connecting senders with verified logistics providers)
    - Subheadline elaborating on dual model (carrier aggregation + on-demand matching)
    - Primary CTA button linking to `#waitlist` section
    - Secondary CTA linking to `#how-it-works`
    - Responsive: fully readable on mobile without horizontal scroll
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 6.2 Add Value Proposition section to home page
    - At least 3 benefit cards (e.g., price comparison, real-time tracking, verified providers)
    - Each card: icon (lucide-react), concise title, supporting description (max 2 sentences)
    - Clear visual separation from adjacent sections
    - Responsive grid: 3 columns on desktop, stacked on mobile
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.3 Update How It Works section
    - 3 sequential steps with step numbers, titles, and descriptions
    - Visual indicators showing sequential order (numbered circles or connecting elements)
    - Responsive: single column on mobile, row on desktop
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.4 Add Audience Segments section
    - At least 2 segment cards: Senders/Businesses and Drivers/Logistics Providers
    - Each segment: tailored message explaining specific benefits
    - Each segment: CTA button directing to `#waitlist`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.5 Add Trust/Social Proof section
    - Founding team introduction (Et and Yobo) with brief bios
    - At least one trust indicator (e.g., waitlist count, partner logos)
    - Numeric values with clear labels
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 6.6 Add Waitlist section with form action
    - Render `<WaitlistSection>` containing `<WaitlistForm source="home" />`
    - Implement `action` function in home route: parse form data with `waitlistSignupSchema`, insert into Supabase `waitlist_signups` table, return success/error `ActionData`
    - Handle duplicate email (unique constraint) with user-friendly error message
    - Handle Supabase connection failures with generic error + server-side logging
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.7 Write property test for waitlist form action (Property 1)
    - **Property 1: Waitlist signup data persistence round-trip**
    - Generate valid signups (fullName 2–100 chars, valid emails, random userType). Mock Supabase insert. Verify stored record matches submitted data.
    - **Validates: Requirements 5.3, 5.6**

- [x] 7. Checkpoint - Verify home page renders correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement campaign pages
  - [x] 8.1 Create `apps/landing/app/routes/campaigns/lagos-launch.tsx`
    - Lagos-specific messaging and CTA
    - Reuse `<WaitlistForm source="campaign-lagos" />`
    - Implement `action` function (same pattern as home page)
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [x] 8.2 Create `apps/landing/app/routes/campaigns/drivers.tsx`
    - Driver recruitment messaging
    - Reuse `<WaitlistForm source="campaign-drivers" />`
    - Implement `action` function
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [x] 8.3 Create `apps/landing/app/routes/campaigns/referral.tsx`
    - Referral program messaging
    - Reuse `<WaitlistForm source="campaign-referral" />`
    - Implement `action` function
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

- [ ] 9. Add legal pages and error boundary
  - [x] 9.1 Create `apps/landing/app/routes/privacy.tsx` and `apps/landing/app/routes/terms.tsx`
    - Placeholder content for Privacy Policy and Terms of Service
    - Proper meta tags for SEO
    - _Requirements: 7.4_

  - [x] 9.2 Add `ErrorBoundary` export to `apps/landing/app/root.tsx`
    - Render minimal error page with SureWaka logo and "Something went wrong" message
    - Link back to home page
    - Never show raw stack traces to visitors
    - _Requirements: 9.3 (SSR fallback)_

- [ ] 10. Performance and SSR optimizations
  - [x] 10.1 Ensure SSR renders all above-the-fold content
    - Verify `react-router.config.ts` has `ssr: true`
    - Confirm hero section content is in the initial HTML response (no client-only rendering)
    - Add `loading="lazy"` to all below-the-fold images
    - _Requirements: 9.1, 9.3, 9.4_

  - [x] 10.2 Add meta tags and SEO configuration
    - Export `meta` function with title, description, Open Graph tags
    - Add `<link rel="preconnect">` for Google Fonts (Inter) in root
    - Ensure CLS ≤ 0.1 by setting explicit dimensions on images and reserving space for dynamic content
    - _Requirements: 9.1, 9.2_

- [ ] 11. Verify deployment configuration
  - [x] 11.1 Confirm `apps/landing/vercel.json` is correct for SSR mode
    - Verify framework detection works with React Router v7
    - Ensure environment variables are documented in `.env.example`
    - Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BASIC_AUTH_ENABLED`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` to `.env.example`
    - _Requirements: 12.1, 12.4_

- [ ] 12. Write integration tests
  - [x] 12.1 SSR smoke test
    - Fetch `/` without JS, verify HTML contains hero headline and waitlist form
    - _Requirements: 9.3, 1.1_
  - [x] 12.2 Campaign page routing test
    - Verify `/campaigns/lagos-launch` renders without nav/footer
    - _Requirements: 11.1, 11.2_
  - [x] 12.3 Basic auth integration test
    - Request with/without credentials when `BASIC_AUTH_ENABLED=true`
    - _Requirements: 13.1, 13.2, 13.4_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The waitlist form action pattern is reused across home and campaign pages — consider extracting a shared `handleWaitlistAction` utility in `app/lib/waitlist-action.server.ts` during implementation
- All components use Tailwind CSS v4 with the existing `@theme` tokens in `app.css`
- Icons from `lucide-react` (already in dependencies)
