// Feature: admin-user-management
// User Management Service — business logic for employee invitation, listing, editing,
// deactivation/reactivation, and audit history.
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8

import { db, users, userRoles, carriers, roleAuditLog } from '@surewaka/db';
import { eq, ne, and, ilike, or, asc, desc, count, sql, type SQL } from 'drizzle-orm';
import { createServiceClient } from '@surewaka/supabase';
import type { UserRole } from '@surewaka/shared';
import { assignRole, syncRolesToAuth } from './role-service';

// ─── Types ───────────────────────────────────────────────────────────────────

export type InviteEmployeeParams = {
  email: string;
  fullName: string;
  role: UserRole;
  scopeType?: 'carrier' | null;
  scopeId?: string | null;
  invitedBy: string;
  invitedByRoles: UserRole[];
};

export type ListEmployeesParams = {
  page: number;
  pageSize: number;
  search?: string;
  role?: UserRole;
  status?: 'active' | 'inactive';
  sortBy: 'name' | 'email' | 'createdAt' | 'updatedAt';
  sortDir: 'asc' | 'desc';
};

export type UpdateEmployeeParams = {
  userId: string;
  fullName?: string;
  phone?: string;
  email?: string;
};

export type DeactivateEmployeeParams = {
  userId: string;
  performedBy: string;
};

export type ReactivateEmployeeParams = {
  userId: string;
  performedBy: string;
};

export type EmployeeListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  verified: boolean;
  roles: { role: UserRole; scopeType: string | null; scopeId: string | null }[];
  createdAt: Date;
  updatedAt: Date;
};

export type EmployeeDetail = EmployeeListItem & {
  avatarUrl: string | null;
  carriers: { id: string; name: string; role: UserRole }[];
};

export type AuditLogEntry = {
  id: string;
  action: string;
  role: UserRole;
  scopeType: string | null;
  scopeId: string | null;
  performedBy: {
    id: string;
    name: string;
  };
  reason: string | null;
  createdAt: Date;
};

export type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: Record<string, unknown> | null;
};

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Invite a new employee via email.
 * - Checks email uniqueness (409 CONFLICT if exists)
 * - Calls Supabase Auth inviteUserByEmail (502 INVITATION_FAILED on failure)
 * - Creates user record + assigns role in a DB transaction
 * - Returns created employee detail
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8
 */
export async function inviteEmployee(
  params: InviteEmployeeParams
): Promise<ServiceResult<EmployeeDetail>> {
  const { email, fullName, role, scopeType, scopeId, invitedBy, invitedByRoles } = params;

  // 1. Check email uniqueness in users table (Requirement 1.4)
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    return {
      data: null,
      error: { code: 'CONFLICT', message: 'A user with this email already exists' },
      meta: null,
    };
  }

  // 2. Call Supabase Auth inviteUserByEmail (Requirement 1.1, 1.7)
  // This is called BEFORE the DB transaction — fail-fast pattern
  const supabaseAdmin = createServiceClient();
  const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      name: fullName,
      role,
    },
  });

  if (inviteError) {
    return {
      data: null,
      error: {
        code: 'INVITATION_FAILED',
        message: `Failed to send invitation email: ${inviteError.message}`,
      },
      meta: null,
    };
  }

  // 3. Begin DB transaction: insert user + assign role (Requirement 1.2, 1.3, 1.8)
  const result = await db.transaction(async (tx) => {
    // Insert user record with verified=false
    const [newUser] = await tx
      .insert(users)
      .values({
        email,
        name: fullName,
        phone: '',
        verified: false,
      })
      .returning();

    // Assign role via RoleService (delegates to existing RBAC system)
    const roleResult = await assignRole({
      userId: newUser.id,
      role,
      assignedBy: invitedBy,
      assignedByRoles: invitedByRoles,
      scopeType: scopeType ?? null,
      scopeId: scopeId ?? null,
      reason: 'Invited by admin',
    });

    if (roleResult.error) {
      throw new Error(`Role assignment failed: ${roleResult.error.message}`);
    }

    return newUser;
  });

  // 4. Build and return EmployeeDetail response
  // Fetch the active roles for the newly created user
  const activeRoles = await db
    .select({
      role: userRoles.role,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
    })
    .from(userRoles)
    .where(and(eq(userRoles.userId, result.id), eq(userRoles.isActive, true)));

  // Resolve carrier names for org-scoped roles
  const carrierDetails: { id: string; name: string; role: UserRole }[] = [];
  for (const r of activeRoles) {
    if ((r.role === 'carrier_admin' || r.role === 'carrier_driver') && r.scopeId) {
      const [carrier] = await db
        .select({ id: carriers.id, name: carriers.name })
        .from(carriers)
        .where(eq(carriers.id, r.scopeId))
        .limit(1);

      if (carrier) {
        carrierDetails.push({
          id: carrier.id,
          name: carrier.name,
          role: r.role as UserRole,
        });
      }
    }
  }

  const employeeDetail: EmployeeDetail = {
    id: result.id,
    name: result.name,
    email: result.email,
    phone: result.phone || null,
    verified: result.verified,
    roles: activeRoles.map((r) => ({
      role: r.role as UserRole,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
    })),
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    avatarUrl: result.avatarUrl ?? null,
    carriers: carrierDetails,
  };

  return { data: employeeDetail, error: null, meta: null };
}

// ─── Column Mapping for Sorting ──────────────────────────────────────────────

const sortColumnMap = {
  name: users.name,
  email: users.email,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

// ─── List Employees ──────────────────────────────────────────────────────────

/**
 * List employees with search, filtering, sorting, and pagination.
 * Only returns users who have at least one record in user_roles.
 * Aggregates active roles per user in the response.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */
export async function listEmployees(
  params: ListEmployeesParams
): Promise<{ data: EmployeeListItem[]; total: number }> {
  const { page, pageSize, search, role, status, sortBy, sortDir } = params;

  // Build WHERE conditions
  const conditions: SQL[] = [];

  // Search filter: ILIKE on name, email, or phone (Requirement 2.2)
  if (search && search.trim() !== '') {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(users.name, searchPattern),
        ilike(users.email, searchPattern),
        ilike(users.phone, searchPattern)
      )!
    );
  }

  // Role filter: EXISTS in user_roles where role matches and isActive=true (Requirement 2.3)
  if (role) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_roles.user_id = ${users.id}
          AND user_roles.role = ${role}
          AND user_roles.is_active = true
      )`
    );
  }

  // Status filter: verified=true for active, verified=false for inactive (Requirement 2.3)
  if (status === 'active') {
    conditions.push(eq(users.verified, true));
  } else if (status === 'inactive') {
    conditions.push(eq(users.verified, false));
  }

  // Ensure only users with at least one role record are returned (Requirement 2.7)
  // Use EXISTS subquery to check for any user_roles record
  conditions.push(
    sql`EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = ${users.id}
    )`
  );

  // Combine all conditions with AND
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort direction and column (Requirement 2.5)
  const sortColumn = sortColumnMap[sortBy];
  const orderFn = sortDir === 'asc' ? asc : desc;

  // Calculate offset (Requirement 2.4)
  const offset = (page - 1) * pageSize;

  // Execute data query with filters, sorting, and pagination
  const employeeRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      verified: users.verified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Execute count query with the same filters (Requirement 2.6)
  const [countResult] = await db
    .select({ total: count() })
    .from(users)
    .where(whereClause);

  const total = countResult?.total ?? 0;

  // If no employees found, return early
  if (employeeRows.length === 0) {
    return { data: [], total };
  }

  // Aggregate active roles per user
  const userIds = employeeRows.map((e) => e.id);
  const activeRoles = await db
    .select({
      userId: userRoles.userId,
      role: userRoles.role,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
    })
    .from(userRoles)
    .where(
      and(
        sql`${userRoles.userId} IN (${sql.join(
          userIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        eq(userRoles.isActive, true)
      )
    );

  // Group roles by userId
  const rolesByUserId = new Map<
    string,
    { role: UserRole; scopeType: string | null; scopeId: string | null }[]
  >();
  for (const r of activeRoles) {
    const existing = rolesByUserId.get(r.userId) ?? [];
    existing.push({
      role: r.role as UserRole,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
    });
    rolesByUserId.set(r.userId, existing);
  }

  // Build response
  const data: EmployeeListItem[] = employeeRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || null,
    verified: row.verified,
    roles: rolesByUserId.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return { data, total };
}

// ─── Get Employee ────────────────────────────────────────────────────────────

/**
 * Get a single employee by ID with active roles and resolved carrier names.
 * Returns NOT_FOUND if the user does not exist.
 *
 * Requirements: 8.1, 8.2, 8.4
 */
export async function getEmployee(userId: string): Promise<ServiceResult<EmployeeDetail>> {
  // 1. Query user by ID
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      verified: users.verified,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // 2. Return NOT_FOUND if user does not exist
  if (!user) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Employee not found' },
      meta: null,
    };
  }

  // 3. Query active roles for this user
  const activeRoles = await db
    .select({
      role: userRoles.role,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
    })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)));

  // 4. Resolve carrier names for org-scoped roles (carrier_admin, carrier_driver)
  const carrierDetails: { id: string; name: string; role: UserRole }[] = [];
  for (const r of activeRoles) {
    if ((r.role === 'carrier_admin' || r.role === 'carrier_driver') && r.scopeId) {
      const [carrier] = await db
        .select({ id: carriers.id, name: carriers.name })
        .from(carriers)
        .where(eq(carriers.id, r.scopeId))
        .limit(1);

      if (carrier) {
        carrierDetails.push({
          id: carrier.id,
          name: carrier.name,
          role: r.role as UserRole,
        });
      }
    }
  }

  // 5. Build and return EmployeeDetail response
  const employeeDetail: EmployeeDetail = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || null,
    verified: user.verified,
    roles: activeRoles.map((r) => ({
      role: r.role as UserRole,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    avatarUrl: user.avatarUrl ?? null,
    carriers: carrierDetails,
  };

  return { data: employeeDetail, error: null, meta: null };
}

// ─── Update Employee ─────────────────────────────────────────────────────────

/**
 * Update an employee's profile details (partial update).
 * - Validates target user exists (404 NOT_FOUND if not)
 * - Checks email uniqueness against other users (409 CONFLICT if duplicate)
 * - Checks phone uniqueness against other users (409 CONFLICT if duplicate)
 * - Updates only specified fields, preserves unmodified fields
 * - Sets updated_at to current timestamp
 * - Returns updated employee detail
 *
 * Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7
 */
export async function updateEmployee(
  params: UpdateEmployeeParams
): Promise<ServiceResult<EmployeeDetail>> {
  const { userId, fullName, phone, email } = params;

  // 1. Check if user exists by ID (Requirement 3.7)
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existingUser) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Employee not found' },
      meta: null,
    };
  }

  // 2. If email is provided, check uniqueness against other users (Requirement 3.4)
  if (email) {
    const [emailConflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, userId)))
      .limit(1);

    if (emailConflict) {
      return {
        data: null,
        error: { code: 'CONFLICT', message: 'A user with this email already exists' },
        meta: null,
      };
    }
  }

  // 3. If phone is provided, check uniqueness against other users (Requirement 3.5)
  if (phone) {
    const [phoneConflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phone), ne(users.id, userId)))
      .limit(1);

    if (phoneConflict) {
      return {
        data: null,
        error: { code: 'CONFLICT', message: 'A user with this phone number already exists' },
        meta: null,
      };
    }
  }

  // 4. Build update object with only provided fields + updated_at (Requirements 3.1, 3.2, 3.6)
  const updateData: Partial<{ name: string; phone: string; email: string; updatedAt: Date }> = {
    updatedAt: new Date(),
  };

  if (fullName !== undefined) {
    updateData.name = fullName;
  }
  if (phone !== undefined) {
    updateData.phone = phone;
  }
  if (email !== undefined) {
    updateData.email = email;
  }

  // 5. Execute UPDATE query
  await db.update(users).set(updateData).where(eq(users.id, userId));

  // 6. Return the full updated employee detail
  return getEmployee(userId);
}

// ─── Deactivate Employee ─────────────────────────────────────────────────────

/**
 * Deactivate an employee account.
 * - Rejects self-deactivation (400 SELF_DEACTIVATION_NOT_ALLOWED)
 * - Sets verified=false on user record
 * - Revokes all active roles (isActive=false)
 * - Creates audit log entry for each revoked role
 * - Updates Supabase Auth app_metadata to clear roles (non-throwing)
 * - All DB changes wrapped in a single transaction
 *
 * Requirements: 4.1, 4.2, 4.3, 4.6, 4.7
 */
export async function deactivateEmployee(
  params: DeactivateEmployeeParams
): Promise<ServiceResult<void>> {
  const { userId, performedBy } = params;

  // 1. Self-deactivation guard (Requirement 4.6)
  if (performedBy === userId) {
    return {
      data: null,
      error: {
        code: 'SELF_DEACTIVATION_NOT_ALLOWED',
        message: 'You cannot deactivate your own account',
      },
      meta: null,
    };
  }

  // 2. Check user exists (404 if not)
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existingUser) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Employee not found' },
      meta: null,
    };
  }

  // 3. Get all active roles for the user
  const activeRoles = await db
    .select({
      id: userRoles.id,
      role: userRoles.role,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
    })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)));

  // 4. Begin DB transaction (Requirement 4.7)
  await db.transaction(async (tx) => {
    // Set verified=false and update timestamp (Requirement 4.1)
    await tx
      .update(users)
      .set({ verified: false, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Revoke all active roles: set isActive=false (Requirement 4.1)
    if (activeRoles.length > 0) {
      await tx
        .update(userRoles)
        .set({ isActive: false, revokedAt: new Date() })
        .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)));
    }

    // Create audit log entry for each revoked role (Requirement 4.3)
    for (const role of activeRoles) {
      await tx.insert(roleAuditLog).values({
        userId,
        role: role.role,
        action: 'revoked',
        scopeType: role.scopeType,
        scopeId: role.scopeId,
        performedBy,
        reason: 'Account deactivated by admin',
      });
    }
  });

  // 5. Sync roles to Supabase Auth via RoleService (Requirement 4.2, 5.7)
  // After revoking all roles in the DB, syncRolesToAuth reads the (now empty)
  // active roles and updates app_metadata accordingly. Fire-and-forget: non-throwing.
  try {
    await syncRolesToAuth(userId);
  } catch (err) {
    console.error(
      `[Deactivate] Failed to sync auth metadata for user ${userId}:`,
      err
    );
  }

  return { data: null, error: null, meta: null };
}

// ─── Reactivate Employee ─────────────────────────────────────────────────────

/**
 * Reactivate a deactivated employee account.
 * - Sets verified=true on user record
 * - Roles remain empty (must be re-assigned separately)
 *
 * Requirements: 4.4
 */
export async function reactivateEmployee(
  params: ReactivateEmployeeParams
): Promise<ServiceResult<void>> {
  const { userId } = params;

  // 1. Check user exists (404 if not)
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existingUser) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Employee not found' },
      meta: null,
    };
  }

  // 2. Set verified=true and update timestamp (Requirement 4.4)
  await db
    .update(users)
    .set({ verified: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Roles remain empty — must be re-assigned separately
  return { data: null, error: null, meta: null };
}

// ─── Get Employee Audit Log ──────────────────────────────────────────────────

/**
 * Get paginated audit log entries for a specific employee.
 * - Joins role_audit_log with users to resolve performedBy name
 * - Filters by target userId
 * - Sorts by createdAt descending (most recent first)
 * - Paginates with LIMIT/OFFSET
 * - Returns total count for metadata
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
export async function getEmployeeAuditLog(
  userId: string,
  page: number,
  pageSize: number
): Promise<{ data: AuditLogEntry[]; total: number }> {
  // Calculate offset for pagination (Requirement 6.4)
  const offset = (page - 1) * pageSize;

  // Query audit log entries joined with users for performer name resolution (Requirements 6.1, 6.2, 6.5)
  const auditEntries = await db
    .select({
      id: roleAuditLog.id,
      action: roleAuditLog.action,
      role: roleAuditLog.role,
      scopeType: roleAuditLog.scopeType,
      scopeId: roleAuditLog.scopeId,
      performedById: roleAuditLog.performedBy,
      performerName: users.name,
      reason: roleAuditLog.reason,
      createdAt: roleAuditLog.createdAt,
    })
    .from(roleAuditLog)
    .leftJoin(users, eq(roleAuditLog.performedBy, users.id))
    .where(eq(roleAuditLog.userId, userId))
    .orderBy(desc(roleAuditLog.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Count query with the same WHERE clause for total (Requirement 6.4)
  const [countResult] = await db
    .select({ total: count() })
    .from(roleAuditLog)
    .where(eq(roleAuditLog.userId, userId));

  const total = countResult?.total ?? 0;

  // Map results to AuditLogEntry type with performedBy as { id, name } object (Requirement 6.2, 6.5)
  const data: AuditLogEntry[] = auditEntries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    role: entry.role as UserRole,
    scopeType: entry.scopeType,
    scopeId: entry.scopeId,
    performedBy: {
      id: entry.performedById ?? '',
      name: entry.performerName ?? 'Unknown',
    },
    reason: entry.reason,
    createdAt: entry.createdAt,
  }));

  return { data, total };
}
