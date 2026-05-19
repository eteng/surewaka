import { createMiddleware } from 'hono/factory';
import { db, carrierMembers } from '@surewaka/db';
import { and, eq } from 'drizzle-orm';
import type { UserRole } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';

type CarrierScopeEnv = {
  Variables: {
    user: SupabaseUser;
    userRoles: UserRole[];
    carrierMembership: typeof carrierMembers.$inferSelect;
  };
};

/**
 * Carrier scope middleware for org-bound routes.
 * Verifies the authenticated user is an active member of the carrier specified in the URL.
 *
 * - Extracts `carrierId` from route params; returns 400 if missing
 * - `surewaka_admin` bypasses the scope check (hierarchy bypass)
 * - Queries `carrier_members` table for active membership (userId + carrierId + isActive)
 * - Returns 403 if user is not an active member of the carrier
 * - Sets `carrierMembership` on Hono context for downstream handlers
 *
 * Must execute AFTER `requireRole` in the middleware chain.
 */
export const requireCarrierScope = createMiddleware<CarrierScopeEnv>(async (c, next) => {
  const user = c.get('user');
  const userRoles: UserRole[] = c.get('userRoles') ?? user.app_metadata?.roles ?? [];
  const carrierId = c.req.param('carrierId');

  // surewaka_admin bypasses scope check
  if (userRoles.includes('surewaka_admin')) {
    await next();
    return;
  }

  if (!carrierId) {
    return c.json(
      {
        data: null,
        error: { code: 'BAD_REQUEST', message: 'Missing carrierId parameter' },
        meta: null,
      },
      400
    );
  }

  // Check user is an active member of this carrier
  const membership = await db
    .select()
    .from(carrierMembers)
    .where(
      and(
        eq(carrierMembers.userId, user.id),
        eq(carrierMembers.carrierId, carrierId),
        eq(carrierMembers.isActive, true)
      )
    )
    .limit(1);

  if (membership.length === 0) {
    return c.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Not a member of this carrier' },
        meta: null,
      },
      403
    );
  }

  c.set('carrierMembership', membership[0]);
  await next();
});
