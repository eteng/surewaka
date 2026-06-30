import { and, count, eq, gte, inArray } from 'drizzle-orm';
import { db, carrierApplications, deliveries, waitlistSignups } from '@surewaka/db';

export type DashboardStats = {
  pendingApplications: number;
  pendingApplicationsDelta: number;
  approvedCarriers: number;
  approvedCarriersDelta: number;
  totalDeliveries: number;
  deliveriesDelta: number;
  waitlistTotal: number;
  waitlistDelta: number;
};

function sevenDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const cutoff = sevenDaysAgo();

  const [
    pendingResult,
    pendingDeltaResult,
    approvedResult,
    approvedDeltaResult,
    deliveriesResult,
    deliveriesDeltaResult,
    waitlistResult,
    waitlistDeltaResult,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(carrierApplications)
      .where(inArray(carrierApplications.status, ['pending', 'under_review'])),
    db
      .select({ value: count() })
      .from(carrierApplications)
      .where(
        and(
          inArray(carrierApplications.status, ['pending', 'under_review']),
          gte(carrierApplications.createdAt, cutoff),
        ),
      ),
    db
      .select({ value: count() })
      .from(carrierApplications)
      .where(eq(carrierApplications.status, 'approved')),
    db
      .select({ value: count() })
      .from(carrierApplications)
      .where(
        and(eq(carrierApplications.status, 'approved'), gte(carrierApplications.updatedAt, cutoff)),
      ),
    db.select({ value: count() }).from(deliveries),
    db
      .select({ value: count() })
      .from(deliveries)
      .where(gte(deliveries.createdAt, cutoff)),
    db.select({ value: count() }).from(waitlistSignups),
    db
      .select({ value: count() })
      .from(waitlistSignups)
      .where(gte(waitlistSignups.createdAt, cutoff)),
  ]);

  return {
    pendingApplications: pendingResult[0]?.value ?? 0,
    pendingApplicationsDelta: pendingDeltaResult[0]?.value ?? 0,
    approvedCarriers: approvedResult[0]?.value ?? 0,
    approvedCarriersDelta: approvedDeltaResult[0]?.value ?? 0,
    totalDeliveries: deliveriesResult[0]?.value ?? 0,
    deliveriesDelta: deliveriesDeltaResult[0]?.value ?? 0,
    waitlistTotal: waitlistResult[0]?.value ?? 0,
    waitlistDelta: waitlistDeltaResult[0]?.value ?? 0,
  };
}
