import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  layout('layouts/marketing-layout.tsx', [
    index('routes/home.tsx'),
    route('privacy', 'routes/privacy.tsx'),
    route('terms', 'routes/terms.tsx'),
  ]),
  layout('layouts/campaign-layout.tsx', [
    route('campaigns/lagos-launch', 'routes/campaigns/lagos-launch.tsx'),
    route('campaigns/drivers', 'routes/campaigns/drivers.tsx'),
    route('campaigns/referral', 'routes/campaigns/referral.tsx'),
  ]),
] satisfies RouteConfig;
