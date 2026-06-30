import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';
import { getDashboardStats } from '../../services/dashboard-service';

type DashboardEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const dashboardRoutes = new Hono<DashboardEnv>();

dashboardRoutes.use('*', requireAuth);
dashboardRoutes.use('*', requireRole('surewaka_admin'));

dashboardRoutes.get('/stats', async (c) => {
  try {
    const stats = await getDashboardStats();
    return c.json({ data: stats, error: null, meta: null });
  } catch {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard stats' }, meta: null },
      500,
    );
  }
});

export default dashboardRoutes;
