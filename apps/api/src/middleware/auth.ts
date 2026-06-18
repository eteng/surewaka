import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@surewaka/auth';
import type { AuthUser } from '@surewaka/auth';

/**
 * Auth middleware for Hono.
 * Extracts the Clerk session token from the Authorization header,
 * verifies it, and attaches the user to the context.
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
  const user = await verifyToken(token);

  if (!user) {
    return c.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' }, meta: null },
      401,
    );
  }

  c.set('user', user);
  c.set('accessToken', token);

  await next();
});

/**
 * Optional auth — attaches user if token present, continues without if not.
 */
export const optionalAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const user = await verifyToken(token);

    if (user) {
      c.set('user', user);
      c.set('accessToken', token);
    }
  }

  await next();
});
