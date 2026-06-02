import { createMiddleware } from 'hono/factory';
import { createServerClient } from '@surewaka/supabase';
import type { SupabaseUser } from '@surewaka/supabase';

/**
 * Auth middleware for Hono.
 * Extracts the Supabase JWT from the Authorization header,
 * verifies it, and attaches the user to the context.
 */

type AuthEnv = {
  Variables: {
    user: SupabaseUser;
    accessToken: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' }, meta: null }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createServerClient(token);

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' }, meta: null }, 401);
  }

  c.set('user', user as SupabaseUser);
  c.set('accessToken', token);

  await next();
});

/**
 * Requires MFA (aal2) — rejects if session is only aal1.
 */
export const requireMfa = createMiddleware<AuthEnv>(async (c, next) => {
  const token = c.get('accessToken');
  if (!token) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' }, meta: null }, 401);
  }
  const supabase = createServerClient(token);
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!data || data.currentLevel !== 'aal2') {
    return c.json({ data: null, error: { code: 'MFA_REQUIRED', message: 'MFA verification required' }, meta: null }, 403);
  }
  await next();
});

/**
 * Optional auth — attaches user if token present, continues without if not.
 */
export const optionalAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const supabase = createServerClient(token);
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      c.set('user', user as SupabaseUser);
      c.set('accessToken', token);
    }
  }

  await next();
});
