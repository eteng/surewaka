import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  route('login', 'routes/login.tsx'),
  route('mfa/enroll', 'routes/mfa/enroll.tsx'),
  route('mfa/verify', 'routes/mfa/verify.tsx'),
  layout('routes/layout.tsx', [
    index('routes/dashboard.tsx'),
    route('deliveries', 'routes/deliveries.tsx'),
    route('drivers', 'routes/drivers.tsx'),
    route('carriers', 'routes/carriers.tsx'),
    route('users', 'routes/users.tsx'),
    route('users/:userId', 'routes/users.$userId.tsx'),
    route('analytics', 'routes/analytics.tsx'),
    route('settings', 'routes/settings.tsx'),
    route('settings/profile', 'routes/settings/profile.tsx'),
    route('settings/name-changes', 'routes/settings/name-changes.tsx'),
    route('notifications', 'routes/notifications.tsx'),
    route('disputes', 'routes/disputes.tsx'),
    route('verifications', 'routes/verifications.tsx'),
    route('waitlist', 'routes/waitlist.tsx'),
  ]),
] satisfies RouteConfig;
