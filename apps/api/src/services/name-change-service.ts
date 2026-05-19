// Feature: admin-user-profile
// Name Change Service — business logic for admin review of name change requests.
// Requirements: 2.5, 2.6

import { db, users, nameChangeRequests } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import { createServiceClient } from '@surewaka/supabase';
import { type NameChangeReview } from '@surewaka/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type NameChangeRequestRecord = {
  id: string;
  userId: string;
  userName: string;
  currentName: string;
  requestedName: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: Record<string, unknown> | null;
};

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Sync name to Supabase Auth user_metadata.
 * Fire-and-forget: logs errors but does not throw.
 */
async function syncNameMetadata(userId: string, name: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { name },
    });

    if (error) {
      console.error('[NameChangeService] Auth metadata sync failed:', {
        userId,
        error: error.message,
      });
    }
  } catch (err) {
    console.error('[NameChangeService] Unexpected error syncing name metadata:', { userId, err });
  }
}

// ─── Name Change Service ─────────────────────────────────────────────────────

/**
 * List all pending name change requests with the user's current name.
 */
export async function listPending(): Promise<ServiceResult<NameChangeRequestRecord[]>> {
  const results = await db
    .select({
      id: nameChangeRequests.id,
      userId: nameChangeRequests.userId,
      userName: users.name,
      currentName: nameChangeRequests.currentName,
      requestedName: nameChangeRequests.requestedName,
      reason: nameChangeRequests.reason,
      status: nameChangeRequests.status,
      reviewedBy: nameChangeRequests.reviewedBy,
      reviewedAt: nameChangeRequests.reviewedAt,
      createdAt: nameChangeRequests.createdAt,
    })
    .from(nameChangeRequests)
    .innerJoin(users, eq(nameChangeRequests.userId, users.id))
    .where(eq(nameChangeRequests.status, 'pending'));

  const records: NameChangeRequestRecord[] = results.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    currentName: row.currentName,
    requestedName: row.requestedName,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data: records, error: null, meta: null };
}

/**
 * Review (approve or reject) a name change request.
 * If approved: updates the user's name column and syncs to auth metadata.
 */
export async function review(
  requestId: string,
  adminId: string,
  decision: NameChangeReview,
): Promise<ServiceResult<NameChangeRequestRecord>> {
  // Fetch the request
  const [request] = await db
    .select()
    .from(nameChangeRequests)
    .where(eq(nameChangeRequests.id, requestId))
    .limit(1);

  if (!request) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Name change request not found' },
      meta: null,
    };
  }

  if (request.status !== 'pending') {
    return {
      data: null,
      error: { code: 'CONFLICT', message: 'Name change request has already been reviewed' },
      meta: null,
    };
  }

  const now = new Date();

  // Update the request status
  const [updatedRequest] = await db
    .update(nameChangeRequests)
    .set({
      status: decision.status,
      reviewedBy: adminId,
      reviewedAt: now,
    })
    .where(eq(nameChangeRequests.id, requestId))
    .returning();

  // If approved, update the user's name and sync auth metadata
  if (decision.status === 'approved') {
    await db
      .update(users)
      .set({ name: request.requestedName, updatedAt: now })
      .where(eq(users.id, request.userId));

    // Fire-and-forget auth metadata sync
    await syncNameMetadata(request.userId, request.requestedName);
  }

  // Fetch the user's current name for the response
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, request.userId))
    .limit(1);

  const record: NameChangeRequestRecord = {
    id: updatedRequest.id,
    userId: updatedRequest.userId,
    userName: user?.name ?? request.currentName,
    currentName: updatedRequest.currentName,
    requestedName: updatedRequest.requestedName,
    reason: updatedRequest.reason,
    status: updatedRequest.status,
    reviewedBy: updatedRequest.reviewedBy,
    reviewedAt: updatedRequest.reviewedAt ? updatedRequest.reviewedAt.toISOString() : null,
    createdAt: updatedRequest.createdAt.toISOString(),
  };

  return { data: record, error: null, meta: null };
}
