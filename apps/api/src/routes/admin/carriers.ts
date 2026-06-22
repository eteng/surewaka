// Feature: carrier-vetting-pipeline
// Admin carrier vetting routes — list/review/approve/reject applications, list carriers,
// and create strategic partner accounts directly.

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import {
  carrierApplicationListQuerySchema,
  approveCarrierApplicationSchema,
  rejectCarrierApplicationSchema,
  createStrategicCarrierSchema,
  carrierListQuerySchema,
} from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import {
  listApplications,
  getApplication,
  startReview,
  approveApplication,
  rejectApplication,
  createStrategicCarrier,
  listCarriers,
} from '../../services/carrier-vetting-service';

type Env = { Variables: { user: AuthUser } };

const adminCarriers = new Hono<Env>();

adminCarriers.use('*', requireAuth);
adminCarriers.use('*', requireRole('surewaka_admin'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorStatus(code: string): 400 | 404 | 409 | 500 {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'INVALID_STATUS':
      return 409;
    default:
      return 500;
  }
}

// ─── Application Routes ───────────────────────────────────────────────────────

// GET /applications — list all applications (paginated + filterable)
adminCarriers.get('/applications', async (c) => {
  const parsed = carrierApplicationListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const result = await listApplications(parsed.data);
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }

  const { data, total } = result.data!;
  const { page, pageSize } = parsed.data;
  return c.json({
    data,
    error: null,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
});

// GET /applications/:id — get application detail with event history
adminCarriers.get('/applications/:id', async (c) => {
  const result = await getApplication(c.req.param('id'));
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }
  return c.json({ data: result.data, error: null, meta: null });
});

// POST /applications/:id/review — move pending → under_review
adminCarriers.post('/applications/:id/review', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { notes?: string };
  const result = await startReview({
    applicationId: c.req.param('id'),
    adminId: user.id,
    notes: body.notes,
  });
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }
  return c.json({ data: null, error: null, meta: null });
});

// POST /applications/:id/approve — approve and create carrier + invitation
adminCarriers.post('/applications/:id/approve', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = approveCarrierApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const result = await approveApplication({
    applicationId: c.req.param('id'),
    adminId: user.id,
    input: {
      driverVettingEnabled: parsed.data.driverVettingEnabled,
      adminEmail: parsed.data.adminEmail,
    },
  });
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }
  return c.json({ data: result.data, error: null, meta: null }, 201);
});

// POST /applications/:id/reject — reject application
adminCarriers.post('/applications/:id/reject', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = rejectCarrierApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const result = await rejectApplication({
    applicationId: c.req.param('id'),
    adminId: user.id,
    reason: parsed.data.reason,
  });
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }
  return c.json({ data: null, error: null, meta: null });
});

// ─── Carrier Routes ───────────────────────────────────────────────────────────

// GET / — list active carriers
adminCarriers.get('/', async (c) => {
  const parsed = carrierListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const result = await listCarriers(parsed.data);
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }

  const { data, total } = result.data!;
  const { page, pageSize } = parsed.data;
  return c.json({
    data,
    error: null,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
});

// POST /strategic — create strategic partner account directly
adminCarriers.post('/strategic', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = createStrategicCarrierSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const result = await createStrategicCarrier({
    adminId: user.id,
    input: {
      name: parsed.data.carrierName,
      contactEmail: parsed.data.adminEmail ?? `${parsed.data.slug}@surewaka.com`,
      slug: parsed.data.slug,
      driverVettingEnabled: parsed.data.driverVettingEnabled,
      adminEmail: parsed.data.adminEmail,
    },
  });
  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, errorStatus(result.error.code));
  }
  return c.json({ data: result.data, error: null, meta: null }, 201);
});

export default adminCarriers;
