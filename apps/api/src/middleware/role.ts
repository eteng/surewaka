import { createMiddleware } from 'hono/factory';
import type { UserRole } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';

type RoleEnv = {
  Variables: {
    user: SupabaseUser;
    userRoles: UserRole[];
  };
};

/**
 * Role-based access control middleware.
 * Checks that the authenticated user holds at least one of the required roles.
 *
 * - Extracts roles from `user.app_metadata.roles` (defaults to ['customer'] if missing/empty)
 * - `surewaka_admin` bypasses all role checks (hierarchy bypass)
 * - Returns 403 FORBIDDEN when the user lacks required roles
 * - Sets `userRoles` on Hono context for downstream middleware/handlers
 *
 * Must execute AFTER `requireAuth` in the middleware chain.
 */
export function requireRole(...roles: UserRole[]) {
  return createMiddleware<RoleEnv>(async (c, next) => {
    const user = c.get('user');
    const appMetadataRoles = user.app_metadata?.roles;

    // Default to ['customer'] when roles are missing or empty
    const userRoles: UserRole[] =
      Array.isArray(appMetadataRoles) && appMetadataRoles.length > 0
        ? (appMetadataRoles as UserRole[])
        : ['customer'];

    c.set('userRoles', userRoles);

    // Hierarchy bypass: surewaka_admin always has access
    if (userRoles.includes('surewaka_admin')) {
      await next();
      return;
    }

    // Check if user has at least one of the required roles
    const hasAccess = roles.some((role) => userRoles.includes(role));

    if (!hasAccess) {
      return c.json(
        {
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: `Requires one of: ${roles.join(', ')}`,
          },
          meta: null,
        },
        403
      );
    }

    await next();
  });
}
