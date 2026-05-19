// Feature: rbac-system
// Property 9: Carrier Driver Limitation — carrier_driver cannot accept jobs outside their carrier
// **Validates: Requirements 3.1, 3.4**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Hono } from 'hono';
import type { UserRole } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock('@surewaka/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
  carrierMembers: {
    userId: 'user_id',
    carrierId: 'carrier_id',
    isActive: 'is_active',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arbitrary for a valid UUID v4 */
const uuidArb = fc.uuid().filter((u) => u.length === 36);

/** Two distinct UUIDs representing different carriers */
const distinctCarrierIdsArb = fc
  .tuple(uuidArb, uuidArb)
  .filter(([a, b]) => a !== b);

/**
 * Create a mock SupabaseUser with carrier_driver role and a specific carrier membership.
 */
function createCarrierDriverUser(
  id: string,
  carrierId: string
): SupabaseUser {
  return {
    id,
    email: 'driver@surewaka.com',
    user_metadata: { name: 'Carrier Driver' },
    app_metadata: {
      roles: ['carrier_driver'] as UserRole[],
      primary_role: 'carrier_driver' as UserRole,
      carrier_id: carrierId,
    },
  };
}

/**
 * Create a Hono app with the carrier scope middleware applied to a carrier-scoped route.
 * Simulates the middleware chain: requireAuth → requireRole → requireCarrierScope → handler.
 */
async function createTestApp(user: SupabaseUser, userRoles: UserRole[]) {
  const { requireCarrierScope } = await import('../middleware/carrier-scope');

  const app = new Hono();

  // Simulate requireAuth + requireRole — sets user and userRoles on context
  app.use('/carriers/:carrierId/*', async (c, next) => {
    c.set('user' as never, user);
    c.set('userRoles' as never, userRoles);
    await next();
  });

  // Apply carrier scope middleware
  app.use('/carriers/:carrierId/*', requireCarrierScope);

  // Test handler simulating a job acceptance endpoint
  app.post('/carriers/:carrierId/jobs/accept', (c) =>
    c.json({ data: 'job_accepted', error: null, meta: null })
  );

  // Also test GET routes (e.g., viewing carrier jobs)
  app.get('/carriers/:carrierId/jobs', (c) =>
    c.json({ data: 'jobs_list', error: null, meta: null })
  );

  return app;
}

/**
 * Configure mock DB to return membership results.
 */
function mockMembershipQuery(results: unknown[]) {
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue(results);
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Carrier Driver Limitation — Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Property 9: carrier_driver cannot accept jobs outside their carrier', () => {
    it('carrier_driver with membership in carrier A is DENIED when accessing carrier B routes (B ≠ A)', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          distinctCarrierIdsArb, // [memberCarrierId, requestedCarrierId] where A ≠ B
          async (userId, [memberCarrierId, requestedCarrierId]) => {
            // carrier_driver belongs to carrier A
            const user = createCarrierDriverUser(userId, memberCarrierId);
            const app = await createTestApp(user, ['carrier_driver']);

            // DB returns empty — user is NOT a member of carrier B
            mockMembershipQuery([]);

            // Attempt to accept a job on carrier B
            const res = await app.request(`/carriers/${requestedCarrierId}/jobs/accept`, {
              method: 'POST',
            });

            // Must be denied with 403 FORBIDDEN
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.code).toBe('FORBIDDEN');
            expect(body.error.message).toBe('Not a member of this carrier');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('carrier_driver with membership in carrier A is ALLOWED to access carrier A routes', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          uuidArb, // carrierId (same for membership and request)
          async (userId, carrierId) => {
            // carrier_driver belongs to carrier A
            const user = createCarrierDriverUser(userId, carrierId);
            const app = await createTestApp(user, ['carrier_driver']);

            // DB returns a membership record — user IS a member of carrier A
            mockMembershipQuery([
              {
                id: '00000000-0000-4000-8000-000000000001',
                carrierId,
                userId,
                role: 'carrier_driver',
                invitedBy: null,
                joinedAt: new Date(),
                leftAt: null,
                isActive: true,
              },
            ]);

            // Accept a job on their own carrier
            const res = await app.request(`/carriers/${carrierId}/jobs/accept`, {
              method: 'POST',
            });

            // Must be allowed (200)
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toBe('job_accepted');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('carrier_driver is denied access to ALL carriers they are not a member of, regardless of carrier ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          uuidArb, // memberCarrierId (carrier A)
          fc.array(uuidArb, { minLength: 1, maxLength: 5 }), // other carrier IDs
          async (userId, memberCarrierId, otherCarrierIds) => {
            // Ensure all other carrier IDs are distinct from the member carrier
            const distinctOthers = otherCarrierIds.filter((id) => id !== memberCarrierId);
            fc.pre(distinctOthers.length > 0);

            const user = createCarrierDriverUser(userId, memberCarrierId);

            for (const otherCarrierId of distinctOthers) {
              const app = await createTestApp(user, ['carrier_driver']);
              mockMembershipQuery([]); // Not a member

              const res = await app.request(`/carriers/${otherCarrierId}/jobs`, {
                method: 'GET',
              });

              // Always denied
              expect(res.status).toBe(403);
              const body = await res.json();
              expect(body.error.code).toBe('FORBIDDEN');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('the limitation applies symmetrically: for any pair of distinct carriers, membership in one never grants access to the other', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          distinctCarrierIdsArb, // [carrierA, carrierB]
          async (userId, [carrierA, carrierB]) => {
            // User is member of carrier A → denied on carrier B
            const userA = createCarrierDriverUser(userId, carrierA);
            const appA = await createTestApp(userA, ['carrier_driver']);
            mockMembershipQuery([]);

            const resAtoB = await appA.request(`/carriers/${carrierB}/jobs/accept`, {
              method: 'POST',
            });
            expect(resAtoB.status).toBe(403);

            // User is member of carrier B → denied on carrier A
            const userB = createCarrierDriverUser(userId, carrierB);
            const appB = await createTestApp(userB, ['carrier_driver']);
            mockMembershipQuery([]);

            const resBtoA = await appB.request(`/carriers/${carrierA}/jobs/accept`, {
              method: 'POST',
            });
            expect(resBtoA.status).toBe(403);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
