// Feature: rbac-system
// Role Service — business logic for role assignment, revocation, querying, and sync.
// Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6

import { db, userRoles, roleAuditLog } from '@surewaka/db';
import { eq, and } from 'drizzle-orm';
import { getClerkClient } from '@surewaka/auth';
import type { UserRole, UserRoleRecord, AppMetadata } from '@surewaka/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AssignRoleParams = {
  userId: string;
  role: UserRole;
  assignedBy: string;
  assignedByRoles: UserRole[];
  scopeType?: 'carrier' | null;
  scopeId?: string | null;
  reason?: string;
};

export type RevokeRoleParams = {
  userId: string;
  role: UserRole;
  revokedBy: string;
  scopeId?: string | null;
  reason?: string;
};

export type UpgradeRoleParams = {
  userId: string;
  fromRole: UserRole;
  toRole: UserRole;
  performedBy: string;
  performedByRoles: UserRole[];
  reason: string;
};

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: Record<string, unknown> | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Roles that only surewaka_admin can assign */
const ADMIN_ONLY_ROLES: UserRole[] = ['surewaka_admin', 'support_agent'];

/** Roles that require org scope (scopeType + scopeId) */
const ORG_SCOPED_ROLES: UserRole[] = ['carrier_admin', 'carrier_driver'];

// ─── Role Service ────────────────────────────────────────────────────────────

/**
 * Assign a role to a user.
 * - Validates org-scoped roles require scope fields
 * - Enforces only surewaka_admin can assign surewaka_admin or support_agent
 * - Returns 409 Conflict on duplicate active role assignment
 * - Logs audit entry and syncs to Clerk
 */
export async function assignRole(params: AssignRoleParams): Promise<ServiceResult<UserRoleRecord>> {
  const { userId, role, assignedBy, assignedByRoles, scopeType, scopeId, reason } = params;

  // Enforce: only surewaka_admin can assign surewaka_admin or support_agent
  if (ADMIN_ONLY_ROLES.includes(role) && !assignedByRoles.includes('surewaka_admin')) {
    return {
      data: null,
      error: { code: 'FORBIDDEN', message: `Only surewaka_admin can assign ${role}` },
      meta: null,
    };
  }

  // Validate org-scoped roles require scopeType and scopeId
  if (ORG_SCOPED_ROLES.includes(role)) {
    if (scopeType !== 'carrier' || !scopeId) {
      return {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Org-scoped roles require scopeType and scopeId',
        },
        meta: null,
      };
    }
  }

  // Check for duplicate active role assignment
  const existing = await db
    .select()
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.role, role),
        eq(userRoles.isActive, true),
        ...(scopeId ? [eq(userRoles.scopeId, scopeId)] : [])
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      data: null,
      error: { code: 'CONFLICT', message: 'User already has this active role' },
      meta: null,
    };
  }

  // Insert role record
  const [roleRecord] = await db
    .insert(userRoles)
    .values({
      userId,
      role,
      scopeType: scopeType ?? null,
      scopeId: scopeId ?? null,
      assignedBy,
    })
    .returning();

  // Audit log
  await db.insert(roleAuditLog).values({
    userId,
    role,
    action: 'assigned',
    scopeType: scopeType ?? null,
    scopeId: scopeId ?? null,
    performedBy: assignedBy,
    reason: reason ?? null,
  });

  // Sync roles to Clerk (fire-and-forget on failure)
  await syncRolesToAuth(userId);

  const result: UserRoleRecord = {
    id: roleRecord.id,
    userId: roleRecord.userId,
    role: roleRecord.role as UserRole,
    scopeType: roleRecord.scopeType as 'carrier' | null,
    scopeId: roleRecord.scopeId,
    assignedBy: roleRecord.assignedBy,
    assignedAt: roleRecord.assignedAt,
    revokedAt: roleRecord.revokedAt,
    isActive: roleRecord.isActive,
  };

  return { data: result, error: null, meta: null };
}

/**
 * Revoke a role from a user.
 * Sets is_active=false and revoked_at on the matching record.
 * Logs audit entry and syncs to Clerk.
 */
export async function revokeRole(params: RevokeRoleParams): Promise<ServiceResult<void>> {
  const { userId, role, revokedBy, scopeId, reason } = params;

  const updated = await db
    .update(userRoles)
    .set({ isActive: false, revokedAt: new Date() })
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.role, role),
        eq(userRoles.isActive, true),
        ...(scopeId ? [eq(userRoles.scopeId, scopeId)] : [])
      )
    )
    .returning();

  if (updated.length === 0) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Active role not found' },
      meta: null,
    };
  }

  // Audit log
  await db.insert(roleAuditLog).values({
    userId,
    role,
    action: 'revoked',
    scopeType: updated[0].scopeType ?? null,
    scopeId: updated[0].scopeId ?? null,
    performedBy: revokedBy,
    reason,
  });

  // Sync roles to Clerk
  await syncRolesToAuth(userId);

  return { data: null, error: null, meta: null };
}

/**
 * Upgrade a user's role (assign new role + log as 'upgraded').
 * Enforces only surewaka_admin can perform upgrades to admin/support roles.
 */
export async function upgradeRole(params: UpgradeRoleParams): Promise<ServiceResult<UserRoleRecord>> {
  const { userId, fromRole, toRole, performedBy, performedByRoles, reason } = params;

  // Enforce: only surewaka_admin can assign surewaka_admin or support_agent
  if (ADMIN_ONLY_ROLES.includes(toRole) && !performedByRoles.includes('surewaka_admin')) {
    return {
      data: null,
      error: { code: 'FORBIDDEN', message: `Only surewaka_admin can assign ${toRole}` },
      meta: null,
    };
  }

  // Check for duplicate active role assignment for the target role
  const existing = await db
    .select()
    .from(userRoles)
    .where(
      and(eq(userRoles.userId, userId), eq(userRoles.role, toRole), eq(userRoles.isActive, true))
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      data: null,
      error: { code: 'CONFLICT', message: 'User already has the target role' },
      meta: null,
    };
  }

  // Insert new role record
  const [roleRecord] = await db
    .insert(userRoles)
    .values({
      userId,
      role: toRole,
      scopeType: null,
      scopeId: null,
      assignedBy: performedBy,
    })
    .returning();

  // Audit log with 'upgraded' action
  await db.insert(roleAuditLog).values({
    userId,
    role: toRole,
    action: 'upgraded',
    scopeType: null,
    scopeId: null,
    performedBy,
    reason,
  });

  // Sync roles to Clerk
  await syncRolesToAuth(userId);

  const result: UserRoleRecord = {
    id: roleRecord.id,
    userId: roleRecord.userId,
    role: roleRecord.role as UserRole,
    scopeType: roleRecord.scopeType as 'carrier' | null,
    scopeId: roleRecord.scopeId,
    assignedBy: roleRecord.assignedBy,
    assignedAt: roleRecord.assignedAt,
    revokedAt: roleRecord.revokedAt,
    isActive: roleRecord.isActive,
  };

  return { data: result, error: null, meta: null };
}

/**
 * Get all active roles for a user.
 */
export async function getUserRoles(userId: string): Promise<ServiceResult<UserRoleRecord[]>> {
  const records = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)));

  const result: UserRoleRecord[] = records.map((r) => ({
    id: r.id,
    userId: r.userId,
    role: r.role as UserRole,
    scopeType: r.scopeType as 'carrier' | null,
    scopeId: r.scopeId,
    assignedBy: r.assignedBy,
    assignedAt: r.assignedAt,
    revokedAt: r.revokedAt,
    isActive: r.isActive,
  }));

  return { data: result, error: null, meta: null };
}

/**
 * Get users by role, with optional scopeId filter.
 */
export async function getUsersByRole(
  role: UserRole,
  scopeId?: string
): Promise<ServiceResult<UserRoleRecord[]>> {
  const records = await db
    .select()
    .from(userRoles)
    .where(
      and(
        eq(userRoles.role, role),
        eq(userRoles.isActive, true),
        ...(scopeId ? [eq(userRoles.scopeId, scopeId)] : [])
      )
    );

  const result: UserRoleRecord[] = records.map((r) => ({
    id: r.id,
    userId: r.userId,
    role: r.role as UserRole,
    scopeType: r.scopeType as 'carrier' | null,
    scopeId: r.scopeId,
    assignedBy: r.assignedBy,
    assignedAt: r.assignedAt,
    revokedAt: r.revokedAt,
    isActive: r.isActive,
  }));

  return { data: result, error: null, meta: null };
}

/**
 * Check if a user has a specific active role (with optional scopeId).
 */
export async function hasRole(
  userId: string,
  role: UserRole,
  scopeId?: string
): Promise<boolean> {
  const records = await db
    .select()
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.role, role),
        eq(userRoles.isActive, true),
        ...(scopeId ? [eq(userRoles.scopeId, scopeId)] : [])
      )
    )
    .limit(1);

  return records.length > 0;
}

// ─── Role Sync ───────────────────────────────────────────────────────────────

/**
 * Sync all active roles from user_roles table to Clerk app_metadata.
 * - Sets `roles` array, `primary_role` (first in list), and `carrier_id` for org-scoped roles
 * - Defaults to `['customer']` when no active roles exist
 * - On failure: logs error but does not throw (Requirement 6.5)
 */
export async function syncRolesToAuth(userId: string): Promise<void> {
  try {
    const activeRoles = await db
      .select({ role: userRoles.role, scopeId: userRoles.scopeId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)));

    const roles: UserRole[] =
      activeRoles.length > 0
        ? ([...new Set(activeRoles.map((r) => r.role))] as UserRole[])
        : ['customer'];

    // Find carrier_id from org-scoped roles
    const carrierRole = activeRoles.find(
      (r) => r.role === 'carrier_admin' || r.role === 'carrier_driver'
    );

    const appMetadata: AppMetadata = {
      roles,
      primary_role: roles[0],
      ...(carrierRole?.scopeId && { carrier_id: carrierRole.scopeId }),
    };

    const clerk = getClerkClient();
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: appMetadata,
    });
  } catch (err) {
    // Log error but don't throw — mutation already succeeded (Requirement 6.5)
    console.error(`[RoleSync] Unexpected error syncing roles for user ${userId}:`, err);
  }
}
