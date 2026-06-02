import { db, recentLocations } from '@surewaka/db';
import { eq, and, asc, desc, count } from 'drizzle-orm';
import type { UpsertRecentLocation, RecentLocation } from '@surewaka/shared';

const RECENT_CAP = 5;

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta: null;
};

function toRecentLocation(row: typeof recentLocations.$inferSelect): RecentLocation {
  return {
    id:           row.id,
    address_text: row.addressText,
    city:         row.city,
    state:        row.state,
    lat:          parseFloat(row.lat),
    lng:          parseFloat(row.lng),
    used_at:      row.usedAt.toISOString(),
  };
}

export async function listRecent(userId: string): Promise<ServiceResult<RecentLocation[]>> {
  const rows = await db
    .select()
    .from(recentLocations)
    .where(eq(recentLocations.userId, userId))
    .orderBy(desc(recentLocations.usedAt))
    .limit(RECENT_CAP);

  return { data: rows.map(toRecentLocation), error: null, meta: null };
}

export async function upsertRecent(
  userId: string,
  input: UpsertRecentLocation,
): Promise<ServiceResult<null>> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(recentLocations)
      .where(
        and(
          eq(recentLocations.userId, userId),
          eq(recentLocations.addressText, input.address_text),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(recentLocations)
        .set({
          usedAt: new Date(),
          lat:    String(input.lat),
          lng:    String(input.lng),
          city:   input.city,
          state:  input.state,
        })
        .where(eq(recentLocations.id, existing.id));
    } else {
      await tx.insert(recentLocations).values({
        userId,
        addressText: input.address_text,
        city:        input.city,
        state:       input.state,
        lat:         String(input.lat),
        lng:         String(input.lng),
      });

      const [{ total }] = await tx
        .select({ total: count() })
        .from(recentLocations)
        .where(eq(recentLocations.userId, userId));

      if (total > RECENT_CAP) {
        const [oldest] = await tx
          .select({ id: recentLocations.id })
          .from(recentLocations)
          .where(eq(recentLocations.userId, userId))
          .orderBy(asc(recentLocations.usedAt))
          .limit(1);

        if (oldest) {
          await tx.delete(recentLocations).where(eq(recentLocations.id, oldest.id));
        }
      }
    }
  });

  return { data: null, error: null, meta: null };
}
