// Feature: admin-customer-listing, admin-customer-detail
// Admin customer routes — list customers with segment data, filters, pagination, and individual detail.

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { customerListQuerySchema, customerDetailDeliveryQuerySchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { listCustomers } from '../../services/customer-listing-service';
import { getCustomerDetail, getCustomerDeliveries } from '../../services/customer-detail-service';

type CustomerManagementEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const customerRoutes = new Hono<CustomerManagementEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// ─── GET /:id — Get customer detail ──────────────────────────────────────────

customerRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid customer ID format' },
        meta: null,
      },
      400,
    );
  }

  const customer = await getCustomerDetail(id);

  if (!customer) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Customer not found' },
        meta: null,
      },
      404,
    );
  }

  return c.json({ data: customer, error: null, meta: null }, 200);
});

// ─── GET /:id/deliveries — Paginated delivery history for a customer ─────────

customerRoutes.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid customer ID format' },
        meta: null,
      },
      400,
    );
  }

  const query = c.req.query();
  const parsed = customerDetailDeliveryQuerySchema.safeParse(query);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
        meta: null,
      },
      400,
    );
  }

  const { page = 1, pageSize = 10 } = parsed.data;
  const result = await getCustomerDeliveries(id, page, pageSize);
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
