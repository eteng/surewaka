import { db } from '@surewaka/db';
import { deliveryEvents, users } from '@surewaka/db';
import { eq, desc } from 'drizzle-orm';
import type { DeliveryEventWithActor, FailureCause } from '@surewaka/shared';

export async function getDeliveryEvents(deliveryId: string): Promise<DeliveryEventWithActor[]> {
  const rows = await db
    .select({
      id: deliveryEvents.id,
      deliveryId: deliveryEvents.deliveryId,
      legId: deliveryEvents.legId,
      fromStatus: deliveryEvents.fromStatus,
      toStatus: deliveryEvents.toStatus,
      triggeredBy: deliveryEvents.triggeredBy,
      failureCause: deliveryEvents.failureCause,
      failureNote: deliveryEvents.failureNote,
      createdAt: deliveryEvents.createdAt,
      actorName: users.name,
    })
    .from(deliveryEvents)
    .leftJoin(users, eq(users.id, deliveryEvents.triggeredBy))
    .where(eq(deliveryEvents.deliveryId, deliveryId))
    .orderBy(desc(deliveryEvents.createdAt));

  return rows.map((row) => ({
    id: row.id,
    deliveryId: row.deliveryId,
    legId: row.legId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    triggeredBy: row.triggeredBy,
    failureCause: row.failureCause as FailureCause | null,
    failureNote: row.failureNote,
    createdAt: row.createdAt.toISOString(),
    actorName: row.actorName ?? null,
  }));
}
