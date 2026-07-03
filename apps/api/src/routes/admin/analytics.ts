import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = {
  Variables: { user: AuthUser; accessToken: string; userRoles: UserRole[] };
};

const analyticsRoutes = new Hono<Env>();
analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', requireRole('surewaka_admin'));

analyticsRoutes.get('/overview', async (c) => {
  return c.json({ data: null, error: { code: 'NOT_IMPLEMENTED', message: 'Coming in Task 2' }, meta: null }, 501);
});

export default analyticsRoutes;
