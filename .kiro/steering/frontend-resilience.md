---
inclusion: fileMatch
fileMatchPattern: '**/*.tsx'
description: Frontend resilience standards — error boundaries, async states, form handling, Sentry logging, and 404 pages
---

# Frontend Resilience Standards

These rules apply to all React components across web, admin, landing, and mobile apps.

## 1. Error Boundaries

Every route/page MUST be wrapped in an error boundary with a user-friendly fallback.

- Use React Router's `ErrorBoundary` export in route files
- Fallback UI must include: a clear message, a "Try again" button, and optionally a support link
- Never show raw stack traces to users
- Log the caught error to Sentry before rendering fallback

```tsx
// Route-level error boundary (React Router v7)
export function ErrorBoundary() {
  const error = useRouteError();
  captureException(error); // Sentry
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">We've been notified and are looking into it.</p>
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </div>
  );
}
```

For reusable boundaries around specific UI sections, use a shared `<ErrorBoundary>` component from `packages/ui`.

## 2. Async State Handling

Every data-fetching UI MUST handle all four states: loading, success, empty, and error.

| State | Required UX |
|-------|-------------|
| **Loading** | Skeleton loader matching the shape of the expected content (not a spinner) |
| **Success** | Render data normally |
| **Empty** | Friendly empty state with illustration/icon and a CTA if applicable |
| **Error** | Error message with a "Retry" button that re-triggers the request |

### Skeleton Loaders

- Use `animate-pulse` with `bg-muted` blocks that match content layout
- Skeleton should be the same approximate size/shape as the loaded content
- Group related skeleton elements to avoid layout shift

```tsx
function DeliveryListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-lg border">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
            <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Retry Pattern

```tsx
function ErrorWithRetry({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-muted-foreground">{message ?? 'Failed to load data'}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
```

## 3. Form Resilience

Forms MUST be resilient against errors, missing data, and interrupted submissions.

- **Optimistic disable**: Disable submit button during submission, show loading indicator
- **Server error display**: Show returned validation errors inline next to the relevant field
- **Network failure**: Show a toast/banner with "Connection lost — your progress is saved" if possible
- **Progress preservation**: For multi-step forms, persist progress to `sessionStorage` or React state so a page refresh doesn't lose work
- **Missing/null data**: Forms that edit existing records must gracefully handle `null`/`undefined` fields — use fallback empty strings, never crash
- **Zod client-side validation**: Validate with the same Zod schema used server-side before submitting
- **Accessible error states**: Use `aria-invalid` and `aria-describedby` for field errors

```tsx
// Form field with error state
<div>
  <Label htmlFor="name">Name</Label>
  <Input
    id="name"
    aria-invalid={!!errors.name}
    aria-describedby={errors.name ? 'name-error' : undefined}
    {...register('name')}
  />
  {errors.name && (
    <p id="name-error" className="text-sm text-destructive mt-1">
      {errors.name.message}
    </p>
  )}
</div>
```

## 4. Sentry Error Logging

All unhandled errors and key failure points MUST be reported to Sentry with context.

- Initialize Sentry in the app entry point (`entry.client.tsx` / `app/_layout.tsx`)
- Use `captureException` in error boundaries and catch blocks
- Attach user context (`Sentry.setUser`) after authentication
- Add breadcrumbs for important user actions (navigation, form submit, API calls)
- Tag errors with the app name: `app:web`, `app:admin`, `app:mobile-customer`, `app:mobile-driver`
- Include relevant metadata (route, component name, request payload shape — never PII)

```tsx
import * as Sentry from '@sentry/react'; // or @sentry/react-native

// In error boundary or catch block:
Sentry.captureException(error, {
  tags: { app: 'web', route: location.pathname },
  extra: { componentStack },
});
```

## 5. Custom 404 Page

Every app MUST have a branded 404 page — never show a browser default or blank screen.

- Export a catch-all route or use React Router's splat (`*`) route
- Include: brand logo, friendly message, search or navigation suggestions, link back to home
- Keep it lightweight (no heavy data fetching)

```tsx
// apps/web/app/routes/$.tsx (catch-all 404)
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">This page doesn't exist or has been moved.</p>
      <Button asChild>
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  );
}
```

## Summary Checklist

Before shipping any page/feature, verify:

- [ ] Route has an `ErrorBoundary` export
- [ ] All async data has loading skeleton, empty state, and error + retry
- [ ] Forms handle submission errors, preserve progress, and validate client-side
- [ ] Sentry captures exceptions with app tag and route context
- [ ] App has a custom 404 page (not browser default)
