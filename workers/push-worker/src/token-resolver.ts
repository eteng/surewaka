// Feature: push-notifications
// Token Resolver — resolves active push tokens for notification delivery.
// Requirements: 2.2, 2.4, 3.2, 3.3, 4.4, 4.5, 7.2, 7.3, 10.2-10.7

import { db, pushTokens, users } from '@surewaka/db';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { PushTargetApp } from '@surewaka/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ResolvedToken = {
  expoPushToken: string;
  id: string;
};

export type ResolvedTokenBulk = {
  expoPushToken: string;
  id: string;
  userId: string;
};

// ─── resolveTokens (single-user) ─────────────────────────────────────────────

/**
 * Resolve active push tokens for a single user.
 *
 * Re-checks notification_push preference at delivery time (Req 4.4) —
 * jobs enqueued before opt-out are caught here.
 *
 * App filter:
 * - 'customer' → only customer-app tokens
 * - 'driver' → only driver-app tokens
 * - 'all' → all active tokens regardless of app (Req 10.4 / 10.7)
 *
 * Requirements: 2.4, 3.2, 3.3, 4.4, 4.5, 10.2-10.7
 */
export async function resolveTokens(
  userId: string,
  targetApp: PushTargetApp | 'all',
): Promise<ResolvedToken[]> {
  // Build conditions: active tokens for this user, joined with user preference
  const conditions = [
    eq(pushTokens.userId, userId),
    eq(pushTokens.isActive, true),
    eq(users.notificationPush, true),
  ];

  // App filter — only applied for specific app targets
  if (targetApp === 'customer') {
    conditions.push(eq(pushTokens.app, 'customer'));
  } else if (targetApp === 'driver') {
    conditions.push(eq(pushTokens.app, 'driver'));
  }
  // targetApp === 'all' → no app filter

  const tokens = await db
    .select({
      expoPushToken: pushTokens.expoPushToken,
      id: pushTokens.id,
    })
    .from(pushTokens)
    .innerJoin(users, eq(pushTokens.userId, users.id))
    .where(and(...conditions));

  return tokens;
}

// ─── resolveTokensBulk (broadcast chunk) ─────────────────────────────────────

/**
 * Resolve active push tokens for multiple users in a single DB query.
 * Used by broadcast chunk processor.
 *
 * Segment-aware filtering (Req 10.4 clarification):
 * - 'customers' → only customer-app tokens
 * - 'drivers' → only driver-app tokens
 * - 'all' → all tokens regardless of app field
 *
 * Preference check is included in the query (JOIN users WHERE notification_push = true).
 * This handles users who opted out after the broadcast was enqueued.
 *
 * Requirements: 4.4, 4.5, 7.2, 7.3, 10.4
 */
export async function resolveTokensBulk(
  userIds: string[],
  segment: string,
): Promise<ResolvedTokenBulk[]> {
  if (userIds.length === 0) return [];

  // Build conditions: active tokens for these users + preference check
  const conditions = [
    inArray(pushTokens.userId, userIds),
    eq(pushTokens.isActive, true),
    eq(users.notificationPush, true),
  ];

  // Segment-aware app filter
  if (segment === 'customers') {
    conditions.push(eq(pushTokens.app, 'customer'));
  } else if (segment === 'drivers') {
    conditions.push(eq(pushTokens.app, 'driver'));
  }
  // segment === 'all' → no app filter (Req 10.4)

  const tokens = await db
    .select({
      expoPushToken: pushTokens.expoPushToken,
      id: pushTokens.id,
      userId: pushTokens.userId,
    })
    .from(pushTokens)
    .innerJoin(users, eq(pushTokens.userId, users.id))
    .where(and(...conditions));

  return tokens;
}

// ─── deactivateToken ─────────────────────────────────────────────────────────

/**
 * Mark a single token as inactive.
 * Called when Expo returns DeviceNotRegistered or InvalidCredentials.
 *
 * Requirements: 2.2
 */
export async function deactivateToken(tokenId: string): Promise<void> {
  await db
    .update(pushTokens)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(eq(pushTokens.id, tokenId));
}

/**
 * Bulk-deactivate multiple tokens by ID.
 * Used by broadcast processor for efficiency.
 *
 * Requirements: 2.2
 */
export async function deactivateTokens(tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return;

  await db
    .update(pushTokens)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(inArray(pushTokens.id, tokenIds));
}
