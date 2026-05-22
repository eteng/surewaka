// Feature: rbac-system
// Carrier routes — driver onboarding and carrier-scoped operations.
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { requireCarrierScope } from '../middleware/carrier-scope';
import { onboardCarrierDriverSchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import { db, users, userRoles, carrierMembers, carriers, roleAuditLog } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { syncRolesToAuth } from '../services/role-service';

type CarrierRoutesEnv = {
  Variables: {
    user: SupabaseUser;
    accessToken: string;
    userRoles: UserRole[];
    carrierMembership: typeof carrierMembers.$inferSelect;
  };
};

const carrierRoutes = new Hono<CarrierRoutesEnv>();

/**
 * GET /carriers — List all active carriers (for customer booking)
 *
 * Returns carriers with id, name, rating, and delivery count.
 * Used by the mobile app booking flow for carrier comparison.
 *
 * Requirements: 5.4, 8.4
 */
carrierRoutes.get('/carriers', async (c) => {
  const carrierList = await db
    .select({
      id: carriers.id,
      name: carriers.name,
      slug: carriers.slug,
      rating: carriers.rating,
      deliveryCount: carriers.deliveryCount,
      isVerified: carriers.isVerified,
      logoUrl: carriers.logoUrl,
    })
    .from(carriers)
    .where(eq(carriers.isActive, true))
    .orderBy(carriers.rating);

  return c.json({ data: carrierList, error: null, meta: null }, 200);
});

/**
 * POST /carriers/:carrierId/drivers/invite — Onboard a carrier_driver
 *
 * Middleware chain: requireAuth → requireRole('carrier_admin') → requireCarrierScope
 *
 * Validates body with onboardCarrierDriverSchema (phone + fullName).
 * Executes all writes in a single transaction:
 *   1. Find or create user by phone
 *   2. Assign carrier_driver role (scoped to carrier)
 *   3. Insert carrier_members record
 *   4. Insert audit log entry
 *   5. Sync roles to Supabase Auth
 */
carrierRoutes.post(
  '/carriers/:carrierId/drivers/invite',
  requireAuth,
  requireRole('carrier_admin'),
  requireCarrierScope,
  async (c) => {
    const carrierId = c.req.param('carrierId');
    const body = await c.req.json();

    // Validate request body
    const parsed = onboardCarrierDriverSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map((e) => e.message).join(', '),
          },
          meta: null,
        },
        400
      );
    }

    const { phone, fullName } = parsed.data;
    const inviter = c.get('user');

    try {
      const result = await db.transaction(async (tx) => {
        // Step 1: Find or create user by phone
        let existingUsers = await tx
          .select()
          .from(users)
          .where(eq(users.phone, phone))
          .limit(1);

        let user: typeof users.$inferSelect;

        if (existingUsers.length > 0) {
          user = existingUsers[0];
        } else {
          const [newUser] = await tx
            .insert(users)
            .values({
              phone,
              name: fullName,
              email: `${phone.replace('+', '')}@placeholder.surewaka.com`,
            })
            .returning();
          user = newUser;
        }

        // Step 2: Assign carrier_driver role with scope
        const [roleRecord] = await tx
          .insert(userRoles)
          .values({
            userId: user.id,
            role: 'carrier_driver',
            scopeType: 'carrier',
            scopeId: carrierId,
            assignedBy: inviter.id,
          })
          .returning();

        // Step 3: Insert carrier_members record
        await tx.insert(carrierMembers).values({
          carrierId,
          userId: user.id,
          role: 'carrier_driver',
          invitedBy: inviter.id,
        });

        // Step 4: Insert audit log entry
        await tx.insert(roleAuditLog).values({
          userId: user.id,
          role: 'carrier_driver',
          action: 'assigned',
          scopeType: 'carrier',
          scopeId: carrierId,
          performedBy: inviter.id,
          reason: 'Onboarded by carrier admin',
        });

        // Step 5: Sync roles to Supabase Auth
        await syncRolesToAuth(user.id);

        return { user, roleRecord };
      });

      return c.json(
        {
          data: {
            user: {
              id: result.user.id,
              phone: result.user.phone,
              name: result.user.name,
            },
            role: {
              id: result.roleRecord.id,
              role: result.roleRecord.role,
              scopeType: result.roleRecord.scopeType,
              scopeId: result.roleRecord.scopeId,
              assignedAt: result.roleRecord.assignedAt,
            },
          },
          error: null,
          meta: null,
        },
        201
      );
    } catch (error: unknown) {
      // Handle unique constraint violation (duplicate active role/membership)
      if (
        error instanceof Error &&
        error.message.includes('unique') 
      ) {
        return c.json(
          {
            data: null,
            error: {
              code: 'CONFLICT',
              message: 'Driver is already an active member of this carrier',
            },
            meta: null,
          },
          409
        );
      }

      console.error('[CarrierRoutes] Onboarding error:', error);
      return c.json(
        {
          data: null,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to onboard driver',
          },
          meta: null,
        },
        500
      );
    }
  }
);

export default carrierRoutes;
