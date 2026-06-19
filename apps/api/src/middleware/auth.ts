import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@surewaka/auth';
import type { AuthUser } from '@surewaka/auth';
import { db, users } from '@surewaka/db';
import { eq } from 'drizzle-orm';

/**
 * Auth middleware for Hono.
 *
 * 1. Extracts the Clerk session token from the Authorization header
 * 2. Verifies it with Clerk (gets clerkId, email, phone, roles)
 * 3. Looks up the internal user UUID from the users table by clerk_id
 * 4. Attaches the full AuthUser (with internal UUID) to the context
 *
 * If the user has a valid Clerk session but no row in the users table,
 * returns 401 — the client must call POST /api/v1/auth/register first.
 */

type AuthEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' }, meta: null },
      401,
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const clerkUser = await verifyToken(token);

  if (!clerkUser) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' }, meta: null },
      401,
    );
  }

  // Resolve internal UUID from clerk_id
  const [dbUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkUser.clerkId))
    .limit(1);

  if (!dbUser) {
    return c.json(
      { data: null, error: { code: 'PROFILE_REQUIRED', message: 'User profile not found. Please complete registration.' }, meta: null },
      401,
    );
  }

  const authUser: AuthUser = {
    id: dbUser.id,
    clerkId: clerkUser.clerkId,
    email: clerkUser.email,
    phone: clerkUser.phone,
    name: clerkUser.name,
    avatarUrl: clerkUser.avatarUrl,
    roles: clerkUser.roles,
    role: clerkUser.roles[0],
    carrierId: clerkUser.carrierId,
  };

  c.set('user', authUser);
  c.set('accessToken', token);

  await next();
});

/**
 * Clerk-only auth — verifies the token but does NOT require a users table row.
 * Used for the /auth/register endpoint where the user doesn't have a DB profile yet.
 */
type ClerkOnlyEnv = {
  Variables: {
    clerkId: string;
    clerkEmail?: string;
    clerkPhone?: string;
    clerkName?: string;
    accessToken: string;
  };
};

export const requireClerkAuth = createMiddleware<ClerkOnlyEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' }, meta: null },
      401,
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const clerkUser = await verifyToken(token);

  if (!clerkUser) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' }, meta: null },
      401,
    );
  }

  c.set('clerkId', clerkUser.clerkId);
  c.set('clerkEmail', clerkUser.email);
  c.set('clerkPhone', clerkUser.phone);
  c.set('clerkName', clerkUser.name);
  c.set('accessToken', token);

  await next();
});

/**
 * Optional auth — attaches user if token present and user exists, continues without if not.
 */
export const optionalAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const clerkUser = await verifyToken(token);

    if (clerkUser) {
      const [dbUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUser.clerkId))
        .limit(1);

      if (dbUser) {
        const authUser: AuthUser = {
          id: dbUser.id,
          clerkId: clerkUser.clerkId,
          email: clerkUser.email,
          phone: clerkUser.phone,
          name: clerkUser.name,
          avatarUrl: clerkUser.avatarUrl,
          roles: clerkUser.roles,
          role: clerkUser.roles[0],
          carrierId: clerkUser.carrierId,
        };

        c.set('user', authUser);
        c.set('accessToken', token);
      }
    }
  }

  await next();
});
