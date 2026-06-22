import { Hono } from 'hono';
import { eq, and, asc, sql } from 'drizzle-orm';
import { db, pushTokens } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { registerPushTokenSchema } from '@surewaka/shared';
import { MAX_PUSH_TOKENS_PER_USER_PER_APP } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type PushTokensEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const pushTokenRoutes = new Hono<PushTokensEnv>();

pushTokenRoutes.use('*', requireAuth);

// POST / — Register or upsert a push token
pushTokenRoutes.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json();
  const parsed = registerPushTokenSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  const { expoPushToken, deviceId, platform, app } = parsed.data;

  try {
    // Upsert: INSERT ... ON CONFLICT (expo_push_token) DO UPDATE
    const [token] = await db
      .insert(pushTokens)
      .values({
        userId: user.id,
        expoPushToken,
        deviceId,
        platform,
        app,
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushTokens.expoPushToken,
        set: {
          userId: user.id,
          deviceId,
          platform,
          app,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Enforce max 10 active tokens per user per app
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, user.id),
          eq(pushTokens.app, app),
          eq(pushTokens.isActive, true),
        ),
      );

    if (countResult.count > MAX_PUSH_TOKENS_PER_USER_PER_APP) {
      // Deactivate oldest tokens beyond the limit
      const excess = countResult.count - MAX_PUSH_TOKENS_PER_USER_PER_APP;

      const oldestTokens = await db
        .select({ id: pushTokens.id })
        .from(pushTokens)
        .where(
          and(
            eq(pushTokens.userId, user.id),
            eq(pushTokens.app, app),
            eq(pushTokens.isActive, true),
          ),
        )
        .orderBy(asc(pushTokens.createdAt))
        .limit(excess);

      for (const oldest of oldestTokens) {
        await db
          .update(pushTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(pushTokens.id, oldest.id));
      }
    }

    return c.json({ data: token, error: null, meta: null }, 201);
  } catch (err) {
    console.error('[POST /push-tokens]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to register push token' }, meta: null },
      500,
    );
  }
});

// DELETE /:token — Deactivate a push token (idempotent)
pushTokenRoutes.delete('/:token', async (c) => {
  const user = c.get('user');
  const token = c.req.param('token');

  try {
    await db
      .update(pushTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(pushTokens.expoPushToken, token),
          eq(pushTokens.userId, user.id),
        ),
      );

    return c.json({ data: { deactivated: true }, error: null, meta: null }, 200);
  } catch (err) {
    console.error('[DELETE /push-tokens/:token]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to deactivate push token' }, meta: null },
      500,
    );
  }
});

export default pushTokenRoutes;
