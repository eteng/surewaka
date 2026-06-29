import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireClerkAuth } from '../middleware/auth';
import { otpRegisterSchema } from '@surewaka/shared';
import { db, users, userRoles } from '@surewaka/db';
import { getClerkClient } from '@surewaka/auth';

type RegisterEnv = {
  Variables: {
    clerkId: string;
    clerkEmail?: string;
    clerkPhone?: string;
    clerkName?: string;
    accessToken: string;
  };
};

const authRoutes = new Hono<RegisterEnv>();

/**
 * POST /api/v1/auth/register
 *
 * Called after first Clerk sign-in to create the internal user profile.
 * Uses requireClerkAuth (not requireAuth) because the user doesn't have
 * a DB row yet — only a valid Clerk session.
 *
 * Creates a new UUID-keyed row in the users table with the Clerk ID stored
 * in the clerk_id column for future lookups.
 */
authRoutes.post('/register', requireClerkAuth, async (c) => {
  const clerkId = c.get('clerkId');
  const phone = c.get('clerkPhone');

  if (!phone) {
    return c.json(
      { data: null, error: { code: 'MISSING_PHONE', message: 'Phone number not found on account' }, meta: null },
      400,
    );
  }

  const body = await c.req.json();
  const parsed = otpRegisterSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.errors.map((e) => e.message).join(', ') },
        meta: null,
      },
      400,
    );
  }

  // Insert new user with clerk_id — UUID is auto-generated
  const [user] = await db
    .insert(users)
    .values({
      clerkId,
      name: parsed.data.name,
      phone,
      email: c.get('clerkEmail') ?? null,
      role: 'customer',
      verified: false,
    })
    .onConflictDoNothing()
    .returning();

  // onConflictDoNothing returns empty if row already exists — fetch it
  const [existing] = user
    ? [user]
    : await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

  if (!existing) {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to provision user' }, meta: null },
      500,
    );
  }

  return c.json(
    { data: { id: existing.id, name: existing.name, phone: existing.phone, role: existing.role }, error: null, meta: null },
    200,
  );
});

/**
 * POST /api/v1/auth/register-employee
 *
 * Called on first login by invited staff who accepted a Clerk invitation.
 * The invite flow stores { roles: [role], invite_scope_type, invite_scope_id }
 * in Clerk publicMetadata at invite time. This endpoint reads those values,
 * provisions the users + user_roles rows, then clears the invite metadata.
 *
 * Uses requireClerkAuth — no DB row exists yet.
 */
authRoutes.post('/register-employee', requireClerkAuth, async (c) => {
  const clerkId = c.get('clerkId');
  const email = c.get('clerkEmail');
  const clerkName = c.get('clerkName');

  // Read role from Clerk publicMetadata set during invitation
  const clerk = getClerkClient();
  const clerkUser = await clerk.users.getUser(clerkId);
  const meta = clerkUser.publicMetadata as Record<string, unknown>;
  const roles = meta.roles as string[] | undefined;
  const role = roles?.[0];

  const STAFF_ROLES = ['surewaka_admin', 'support_agent', 'carrier_admin', 'carrier_driver'];

  if (!role || !STAFF_ROLES.includes(role)) {
    return c.json(
      { data: null, error: { code: 'NOT_INVITED', message: 'No valid invitation found for this account' }, meta: null },
      400,
    );
  }

  const scopeType = meta.invite_scope_type as 'carrier' | null | undefined;
  const scopeId = meta.invite_scope_id as string | null | undefined;
  const name = clerkName ?? email?.split('@')[0] ?? 'Staff';

  // Insert users row — idempotent via onConflictDoNothing
  const [newUser] = await db
    .insert(users)
    .values({
      clerkId,
      name,
      phone: '',
      email: email ?? null,
      role: role as 'surewaka_admin' | 'support_agent' | 'carrier_admin' | 'carrier_driver',
      verified: true,
    })
    .onConflictDoNothing()
    .returning();

  const existing =
    newUser ??
    (await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1).then((r) => r[0]));

  if (!existing) {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to provision user' }, meta: null },
      500,
    );
  }

  // Insert user_roles row — idempotent via unique constraint
  await db
    .insert(userRoles)
    .values({
      userId: existing.id,
      role: role as 'surewaka_admin' | 'support_agent' | 'carrier_admin' | 'carrier_driver',
      scopeType: scopeType ?? null,
      scopeId: scopeId ?? null,
      assignedBy: existing.id,
      isActive: true,
    })
    .onConflictDoNothing();

  // Clean up invite-specific metadata keys now that the row is provisioned
  await clerk.users.updateUserMetadata(clerkId, {
    publicMetadata: {
      ...meta,
      invite_scope_type: null,
      invite_scope_id: null,
    },
  });

  return c.json(
    { data: { id: existing.id, name: existing.name, role: existing.role }, error: null, meta: null },
    200,
  );
});

export default authRoutes;
