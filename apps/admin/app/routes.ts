import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/dashboard.tsx'),
  route('deliveries', 'routes/deliveries.tsx'),
  route('drivers', 'routes/drivers.tsx'),
  route('carriers', 'routes/carriers.tsx'),
] satisfies RouteConfig;
