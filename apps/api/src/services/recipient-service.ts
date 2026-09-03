import { db, userSavedRecipients } from '@surewaka/db';
import { eq, and, asc, count } from 'drizzle-orm';
import type { CreateSavedRecipient, UpdateSavedRecipient, SavedRecipient } from '@surewaka/shared';

const RECIPIENT_CAP = 25;

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: null;
};

function toSavedRecipient(row: typeof userSavedRecipients.$inferSelect): SavedRecipient {
  return {
    id:             row.id,
    label:          row.label ?? undefined,
    recipientName:  row.recipientName,
    recipientPhone: row.recipientPhone,
    deliveryNotes:  row.deliveryNotes ?? undefined,
    created_at:     row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function listRecipients(userId: string): Promise<ServiceResult<SavedRecipient[]>> {
  const rows = await db
    .select()
    .from(userSavedRecipients)
    .where(eq(userSavedRecipients.userId, userId))
    .orderBy(asc(userSavedRecipients.createdAt));

  return { data: rows.map(toSavedRecipient), error: null, meta: null };
}

export async function getRecipient(
  userId: string,
  id: string,
): Promise<ServiceResult<SavedRecipient>> {
  const [row] = await db
    .select()
    .from(userSavedRecipients)
    .where(and(eq(userSavedRecipients.id, id), eq(userSavedRecipients.userId, userId)))
    .limit(1);

  if (!row) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Recipient not found' }, meta: null };
  }

  return { data: toSavedRecipient(row), error: null, meta: null };
}

export async function createRecipient(
  userId: string,
  input: CreateSavedRecipient,
): Promise<ServiceResult<SavedRecipient>> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(userSavedRecipients)
    .where(eq(userSavedRecipients.userId, userId));

  if (total >= RECIPIENT_CAP) {
    return {
      data: null,
      error: {
        code: 'LIMIT_REACHED',
        message: `You can save at most ${RECIPIENT_CAP} recipients`,
      },
      meta: null,
    };
  }

  const [row] = await db
    .insert(userSavedRecipients)
    .values({
      userId,
      label:          input.label,
      recipientName:  input.recipientName,
      recipientPhone: input.recipientPhone,
      deliveryNotes:  input.deliveryNotes,
    })
    .returning();

  return { data: toSavedRecipient(row), error: null, meta: null };
}

export async function updateRecipient(
  userId: string,
  id: string,
  input: UpdateSavedRecipient,
): Promise<ServiceResult<SavedRecipient>> {
  const updates: Partial<typeof userSavedRecipients.$inferInsert> = {};
  if (input.label          !== undefined) updates.label          = input.label;
  if (input.recipientName  !== undefined) updates.recipientName  = input.recipientName;
  if (input.recipientPhone !== undefined) updates.recipientPhone = input.recipientPhone;
  if (input.deliveryNotes  !== undefined) updates.deliveryNotes  = input.deliveryNotes;
  updates.updatedAt = new Date();

  const [row] = await db
    .update(userSavedRecipients)
    .set(updates)
    .where(and(eq(userSavedRecipients.id, id), eq(userSavedRecipients.userId, userId)))
    .returning();

  if (!row) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Recipient not found' }, meta: null };
  }

  return { data: toSavedRecipient(row), error: null, meta: null };
}

export async function deleteRecipient(
  userId: string,
  id: string,
): Promise<ServiceResult<null>> {
  const [row] = await db
    .delete(userSavedRecipients)
    .where(and(eq(userSavedRecipients.id, id), eq(userSavedRecipients.userId, userId)))
    .returning();

  if (!row) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Recipient not found' }, meta: null };
  }

  return { data: null, error: null, meta: null };
}
