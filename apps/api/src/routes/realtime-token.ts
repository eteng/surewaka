import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, deliveries } from '@surewaka/db';
import Ably from 'ably';
import { requireAuth } from '../middleware/auth';
import { CHANNELS } from '../lib/realtime';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser } };

const realtimeTokenRoutes = new Hono<Env>();
realtimeTokenRoutes.use('*', requireAuth);

const querySchema = z.object({ deliveryId: z.string().uuid() });

/**
 * GET /api/v1/realtime/token?deliveryId=<id>
 *
 * Mints a short-lived Ably token scoped to exactly the caller's own
 * delivery-tracking channel, after confirming they own the delivery. The
 * mobile client fetches this fresh per tracking session rather than
 * embedding the raw ABLY_API_KEY.
 *
 * This is the one place that talks to the Ably SDK directly instead of
 * going through @surewaka/realtime's RealtimeProvider abstraction
 * (packages/realtime/src/types.ts) — that abstraction deliberately only
 * exposes publish/subscribe/close so a future Cloudflare DO backend can
 * satisfy it too, but client-side token auth is inherently Ably-specific,
 * so it doesn't fit there. See design.md Component 1.
 */
realtimeTokenRoutes.get('/token', async (c) => {
  const user = c.get('user');

  const parsed = querySchema.safeParse({ deliveryId: c.req.query('deliveryId') });
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid or missing deliveryId' },
        meta: null,
      },
      400,
    );
  }
  const { deliveryId } = parsed.data;

  const [delivery] = await db
    .select({ customerId: deliveries.customerId })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!delivery || delivery.customerId !== user.id) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
      404,
    );
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    throw new Error('ABLY_API_KEY must be set');
  }

  const ably = new Ably.Rest({ key: apiKey });
  const tokenRequest = await ably.auth.createTokenRequest({
    clientId: user.id,
    capability: { [CHANNELS.deliveryTracking(deliveryId)]: ['subscribe'] },
  });

  return c.json({ data: tokenRequest, error: null, meta: null });
});

export default realtimeTokenRoutes;
