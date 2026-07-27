import { createMiddleware } from 'hono/factory';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type RoleEnv = {
  Variables: {
    user: AuthUser;
    userRoles: UserRole[];
  };
};

/**
 * Role-based access control middleware.
 * Checks that the authenticated user holds at least one of the required roles.
 *
 * - Extracts roles from `user.roles` (populated from Clerk publicMetadata)
 * - Defaults to ['customer'] if missing/empty
 * - `surewaka_superadmin` bypasses all role checks (top-tier hierarchy)
 * - `surewaka_admin` bypasses all role checks except `surewaka_superadmin`-only routes
 * - Returns 403 FORBIDDEN when the user lacks required roles
 * - Sets `userRoles` on Hono context for downstream middleware/handlers
 *
 * Must execute AFTER `requireAuth` in the middleware chain.
 */
export function requireRole(...roles: UserRole[]) {
  return createMiddleware<RoleEnv>(async (c, next) => {
    const user = c.get('user');

    // Default to ['customer'] when roles are missing or empty
    const userRoles: UserRole[] =
      Array.isArray(user.roles) && user.roles.length > 0
        ? (user.roles as UserRole[])
        : ['customer'];

    c.set('userRoles', userRoles);

    // Hierarchy: surewaka_superadmin > surewaka_admin > others
    // surewaka_superadmin bypasses all role checks
    if (userRoles.includes('surewaka_superadmin')) {
      await next();
      return;
    }
    // surewaka_admin bypasses all non-superadmin routes
    if (userRoles.includes('surewaka_admin') && !roles.includes('surewaka_superadmin')) {
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
        403,
      );
    }

    await next();
  });
}
