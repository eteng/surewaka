// Feature: admin-driver-listing
// Admin driver listing routes — list drivers with vehicle, carrier, and performance data.

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { driverListQuerySchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { listDrivers } from '../../services/driver-listing-service';
import { getDriverDetail } from '../../services/driver-detail-service';

type DriverManagementEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const adminDriverRoutes = new Hono<DriverManagementEnv>();

// All routes require authentication + surewaka_admin role
adminDriverRoutes.use('*', requireAuth);
adminDriverRoutes.use('*', requireRole('surewaka_admin'));

// ─── GET / — List drivers with vehicle, carrier, and performance data ────────

adminDriverRoutes.get('/', async (c) => {
  const query = c.req.query();

  const parsed = driverListQuerySchema.safeParse(query);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        },
        meta: null,
      },
      400,
    );
  }

  const { page, pageSize } = parsed.data;

  const result = await listDrivers(parsed.data);

  const totalPages = Math.ceil(result.total / pageSize);

  return c.json(
    {
      data: result.data,
      error: null,
      meta: { total: result.total, page, pageSize, totalPages },
    },
    200,
  );
});

// ─── GET /:id — Get driver detail by ID ──────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

adminDriverRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid driver ID format' },
        meta: null,
      },
      400,
    );
  }

  const driver = await getDriverDetail(id);

  if (!driver) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Driver not found' },
        meta: null,
      },
      404,
    );
  }

  return c.json({ data: driver, error: null, meta: null }, 200);
});

export default adminDriverRoutes;
