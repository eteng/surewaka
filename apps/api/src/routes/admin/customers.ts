// Feature: admin-customer-listing
// Admin customer listing routes — list customers with segment data, filters, and pagination.

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { customerListQuerySchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { listCustomers } from '../../services/customer-listing-service';

type CustomerManagementEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const customerRoutes = new Hono<CustomerManagementEnv>();

// All routes require authentication + surewaka_admin role
customerRoutes.use('*', requireAuth);
customerRoutes.use('*', requireRole('surewaka_admin'));

// ─── GET / — List customers with segment data ────────────────────────────────

customerRoutes.get('/', async (c) => {
  const query = c.req.query();

  const parsed = customerListQuerySchema.safeParse(query);

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

  const result = await listCustomers(parsed.data);

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

export default customerRoutes;
