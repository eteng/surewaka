// Feature: rbac-system
// Admin role management routes — assign, revoke, and list user roles.
// Requirements: 4.1, 4.2, 4.5, 4.6

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireMfa } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { assignRoleSchema, revokeRoleSchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { assignRole, revokeRole, getUserRoles, upgradeRole } from '../../services/role-service';

type AdminRolesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const adminRoles = new Hono<AdminRolesEnv>();

// All routes require authentication + MFA + surewaka_admin role
adminRoles.use('*', requireAuth);
adminRoles.use('*', requireMfa);
adminRoles.use('*', requireRole('surewaka_admin'));

/**
 * POST /users/:userId/roles — Assign a role to a user
 * Body validated against assignRoleSchema
 */
adminRoles.post('/users/:userId/roles', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();

  // Validate request body
  const parsed = assignRoleSchema.safeParse({ ...body, userId });

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
      400
    );
  }

  const user = c.get('user');
  const userRoles = c.get('userRoles');

  const result = await assignRole({
    userId: parsed.data.userId,
    role: parsed.data.role,
    assignedBy: user.id,
    assignedByRoles: userRoles,
    scopeType: parsed.data.scopeType ?? null,
    scopeId: parsed.data.scopeId ?? null,
    reason: parsed.data.reason,
  });

  if (result.error) {
    const statusCode = result.error.code === 'CONFLICT' ? 409 : 400;
    return c.json({ data: null, error: result.error, meta: null }, statusCode);
  }

  return c.json({ data: result.data, error: null, meta: null }, 201);
});

/**
 * DELETE /users/:userId/roles — Revoke a role from a user
 * Body validated against revokeRoleSchema
 */
adminRoles.delete('/users/:userId/roles', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();

  // Validate request body
  const parsed = revokeRoleSchema.safeParse({ ...body, userId });

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
      400
    );
  }

  const user = c.get('user');

  const result = await revokeRole({
    userId: parsed.data.userId,
    role: parsed.data.role,
    revokedBy: user.id,
    scopeId: parsed.data.scopeId ?? null,
    reason: parsed.data.reason,
  });

  if (result.error) {
    const statusCode = result.error.code === 'NOT_FOUND' ? 404 : 400;
    return c.json({ data: null, error: result.error, meta: null }, statusCode);
  }

  return c.json({ data: null, error: null, meta: null }, 200);
});

/**
 * GET /users/:userId/roles — List a user's active roles
 */
adminRoles.get('/users/:userId/roles', async (c) => {
  const userId = c.req.param('userId');

  const result = await getUserRoles(userId);

  if (result.error) {
    return c.json({ data: null, error: result.error, meta: null }, 400);
  }

  return c.json({ data: result.data, error: null, meta: null }, 200);
});

// ─── Upgrade Driver Schema ────────────────────────────────────────────────────

const upgradeDriverSchema = z.object({
  reason: z.string().min(3, 'Reason must be at least 3 characters').max(500),
});

/**
 * POST /users/:userId/upgrade-driver — Upgrade carrier_driver to independent driver
 * Requires surewaka_admin authorization.
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
adminRoles.post('/users/:userId/upgrade-driver', async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json();

  // Validate request body
  const parsed = upgradeDriverSchema.safeParse(body);

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
      400
    );
  }

  const user = c.get('user');
  const userRoles = c.get('userRoles');

  const result = await upgradeRole({
    userId,
    fromRole: 'carrier_driver',
    toRole: 'driver',
    performedBy: user.id,
    performedByRoles: userRoles,
    reason: parsed.data.reason,
  });

  if (result.error) {
    const statusCode = result.error.code === 'CONFLICT' ? 409 : 400;
    return c.json({ data: null, error: result.error, meta: null }, statusCode);
  }

  return c.json({ data: result.data, error: null, meta: null }, 201);
});

export default adminRoles;
