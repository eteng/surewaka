import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireClerkAuth } from '../middleware/auth';
import { otpRegisterSchema } from '@surewaka/shared';
import { db, users } from '@surewaka/db';

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

export default authRoutes;
