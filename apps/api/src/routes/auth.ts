import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { otpRegisterSchema } from '@surewaka/shared';
import { db, users } from '@surewaka/db';
import type { AuthUser } from '@surewaka/auth';

type AuthRoutesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const authRoutes = new Hono<AuthRoutesEnv>();

authRoutes.post('/register', requireAuth, async (c) => {
  const authUser = c.get('user');

  if (!authUser.phone) {
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

  const [user] = await db
    .insert(users)
    .values({
      id: authUser.id,
      name: parsed.data.name,
      phone: authUser.phone,
      email: null,
      role: 'customer',
      verified: false,
    })
    .onConflictDoNothing()
    .returning();

  // onConflictDoNothing returns empty array when row already exists — fetch it
  const [existing] = user ? [user] : await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  const result = existing;

  if (!result) {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to provision user' }, meta: null },
      500,
    );
  }

  return c.json(
    { data: { id: result.id, name: result.name, phone: result.phone, role: result.role }, error: null, meta: null },
    200,
  );
});

export default authRoutes;
