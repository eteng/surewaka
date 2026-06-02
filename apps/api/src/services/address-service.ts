import { db, userSavedAddresses } from '@surewaka/db';
import { eq, and, asc, count } from 'drizzle-orm';
import type { CreateSavedAddress, UpdateSavedAddress, SavedAddress } from '@surewaka/shared';

const ADDRESS_CAP = 25;

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: null;
};

function toSavedAddress(row: typeof userSavedAddresses.$inferSelect): SavedAddress {
  return {
    id:           row.id,
    label:        row.label,
    address_text: row.addressText,
    city:         row.city,
    state:        row.state,
    lat:          parseFloat(row.lat),
    lng:          parseFloat(row.lng),
    created_at:   row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function listAddresses(userId: string): Promise<ServiceResult<SavedAddress[]>> {
  const rows = await db
    .select()
    .from(userSavedAddresses)
    .where(eq(userSavedAddresses.userId, userId))
    .orderBy(asc(userSavedAddresses.createdAt));

  return { data: rows.map(toSavedAddress), error: null, meta: null };
}

export async function getAddress(
  userId: string,
  id: string,
): Promise<ServiceResult<SavedAddress>> {
  const [row] = await db
    .select()
    .from(userSavedAddresses)
    .where(and(eq(userSavedAddresses.id, id), eq(userSavedAddresses.userId, userId)))
    .limit(1);

  if (!row) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Address not found' }, meta: null };
  }

  return { data: toSavedAddress(row), error: null, meta: null };
}

export async function createAddress(
  userId: string,
  input: CreateSavedAddress,
): Promise<ServiceResult<SavedAddress>> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(userSavedAddresses)
    .where(eq(userSavedAddresses.userId, userId));

  if (total >= ADDRESS_CAP) {
    return {
      data: null,
      error: { code: 'LIMIT_REACHED', message: `You can save at most ${ADDRESS_CAP} addresses` },
      meta: null,
    };
  }

  const [row] = await db
    .insert(userSavedAddresses)
    .values({
      userId,
      label:       input.label,
      addressText: input.address_text,
      city:        input.city,
      state:       input.state,
      lat:         String(input.lat),
      lng:         String(input.lng),
    })
    .returning();

  return { data: toSavedAddress(row), error: null, meta: null };
}

export async function updateAddress(
  userId: string,
  id: string,
  input: UpdateSavedAddress,
): Promise<ServiceResult<SavedAddress>> {
  const updates: Partial<typeof userSavedAddresses.$inferInsert> = {};
  if (input.label        !== undefined) updates.label       = input.label;
  if (input.address_text !== undefined) updates.addressText = input.address_text;
  if (input.city         !== undefined) updates.city        = input.city;
  if (input.state        !== undefined) updates.state       = input.state;
  if (input.lat          !== undefined) updates.lat         = String(input.lat);
  if (input.lng          !== undefined) updates.lng         = String(input.lng);

  const [row] = await db
    .update(userSavedAddresses)
    .set(updates)
    .where(and(eq(userSavedAddresses.id, id), eq(userSavedAddresses.userId, userId)))
    .returning();

  if (!row) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Address not found' }, meta: null };
  }

  return { data: toSavedAddress(row), error: null, meta: null };
}

export async function deleteAddress(
  userId: string,
  id: string,
): Promise<ServiceResult<null>> {
  const [row] = await db
    .delete(userSavedAddresses)
    .where(and(eq(userSavedAddresses.id, id), eq(userSavedAddresses.userId, userId)))
    .returning();

  if (!row) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Address not found' }, meta: null };
  }

  return { data: null, error: null, meta: null };
}
