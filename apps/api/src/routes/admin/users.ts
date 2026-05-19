// Feature: admin-user-management
// Admin user management routes — invite, list, view, update, deactivate/reactivate employees,
// and view audit history.
// Requirements: 1.1, 2.1, 3.1, 4.1, 4.4, 5.1, 5.2, 6.1, 7.1, 7.2

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import {
  inviteEmployeeSchema,
  updateEmployeeSchema,
  employeeListQuerySchema,
  auditLogQuerySchema,
} from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import {
  inviteEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  deactivateEmployee,
  reactivateEmployee,
  getEmployeeAuditLog,
} from '../../services/user-management-service';

type UserManagementEnv = {
  Variables: {
    user: SupabaseUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const userManagement = new Hono<UserManagementEnv>();

// All routes require authentication + surewaka_admin role (Requirements: 7.1, 7.2)
userManagement.use('*', requireAuth);
userManagement.use('*', requireRole('surewaka_admin'));

// ─── Error Code to HTTP Status Mapping ───────────────────────────────────────

function getHttpStatus(code: string): 400 | 403 | 404 | 409 | 500 | 502 {
  switch (code) {
    case 'CONFLICT':
      return 409;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_ERROR':
      return 400;
    case 'SELF_DEACTIVATION_NOT_ALLOWED':
      return 400;
    case 'INVITATION_FAILED':
      return 502;
    case 'FORBIDDEN':
      return 403;
    case 'INTERNAL_ERROR':
    default:
      return 500;
  }
}

// ─── POST /invite — Invite new employee (Requirement 1.1) ───────────────────

userManagement.post('/invite', async (c) => {
  const body = await c.req.json();

  // Validate request body with inviteEmployeeSchema
  const parsed = inviteEmployeeSchema.safeParse(body);

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

  const user = c.get('user');
  const userRoles = c.get('userRoles');

  const result = await inviteEmployee({
    email: parsed.data.email,
    fullName: parsed.data.fullName,
    role: parsed.data.role,
    scopeType: parsed.data.scopeType ?? null,
    scopeId: parsed.data.scopeId ?? null,
    invitedBy: user.id,
    invitedByRoles: userRoles,
  });

  if (result.error) {
    const status = getHttpStatus(result.error.code);
    return c.json({ data: null, error: result.error, meta: null }, status);
  }

  return c.json({ data: result.data, error: null, meta: null }, 201);
});

// ─── GET / — List employees (Requirement 2.1) ───────────────────────────────

userManagement.get('/', async (c) => {
  const query = c.req.query();

  // Validate query params with employeeListQuerySchema
  const parsed = employeeListQuerySchema.safeParse(query);

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

  const { page, pageSize, search, role, status, sortBy, sortDir } = parsed.data;

  const result = await listEmployees({
    page,
    pageSize,
    search,
    role,
    status,
    sortBy,
    sortDir,
  });

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

// ─── GET /:userId — Get employee detail (Requirement 8.1) ───────────────────

userManagement.get('/:userId', async (c) => {
  const userId = c.req.param('userId');

  const result = await getEmployee(userId);

  if (result.error) {
    const status = getHttpStatus(result.error.code);
    return c.json({ data: null, error: result.error, meta: null }, status);
  }

  return c.json({ data: result.data, error: null, meta: null }, 200);
});

// ─── PATCH /:userId — Update employee details (Requirement 3.1) ─────────────

userManagement.patch('/:userId', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();

  // Validate request body with updateEmployeeSchema
  const parsed = updateEmployeeSchema.safeParse(body);

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

  const result = await updateEmployee({
    userId,
    fullName: parsed.data.fullName,
    phone: parsed.data.phone,
    email: parsed.data.email,
  });

  if (result.error) {
    const status = getHttpStatus(result.error.code);
    return c.json({ data: null, error: result.error, meta: null }, status);
  }

  return c.json({ data: result.data, error: null, meta: null }, 200);
});

// ─── POST /:userId/deactivate — Deactivate employee (Requirement 4.1) ───────

userManagement.post('/:userId/deactivate', async (c) => {
  const userId = c.req.param('userId');
  const user = c.get('user');

  const result = await deactivateEmployee({
    userId,
    performedBy: user.id,
  });

  if (result.error) {
    const status = getHttpStatus(result.error.code);
    return c.json({ data: null, error: result.error, meta: null }, status);
  }

  return c.json({ data: null, error: null, meta: null }, 200);
});

// ─── POST /:userId/reactivate — Reactivate employee (Requirement 4.4) ───────

userManagement.post('/:userId/reactivate', async (c) => {
  const userId = c.req.param('userId');
  const user = c.get('user');

  const result = await reactivateEmployee({
    userId,
    performedBy: user.id,
  });

  if (result.error) {
    const status = getHttpStatus(result.error.code);
    return c.json({ data: null, error: result.error, meta: null }, status);
  }

  return c.json({ data: null, error: null, meta: null }, 200);
});

// ─── GET /:userId/audit-log — Get audit history (Requirement 6.1) ────────────

userManagement.get('/:userId/audit-log', async (c) => {
  const userId = c.req.param('userId');
  const query = c.req.query();

  // Validate query params with auditLogQuerySchema
  const parsed = auditLogQuerySchema.safeParse(query);

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

  const result = await getEmployeeAuditLog(userId, page, pageSize);

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

export default userManagement;
