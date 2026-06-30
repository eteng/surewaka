import { db } from '@surewaka/db';
import { users, customerSegments, deliveries } from '@surewaka/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { CustomerDetail, CustomerDeliveryItem } from '@surewaka/shared';

export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      avatarUrl: users.avatarUrl,
      gender: users.gender,
      verified: users.verified,
      createdAt: users.createdAt,
      notificationEmail: users.notificationEmail,
      notificationSms: users.notificationSms,
      tier: customerSegments.tier,
      totalDeliveries: customerSegments.totalDeliveries,
      totalSpent: customerSegments.totalSpent,
      lastDeliveryAt: customerSegments.lastDeliveryAt,
      primaryCity: customerSegments.primaryCity,
      healthScore: customerSegments.healthScore,
    })
    .from(users)
    .leftJoin(customerSegments, eq(customerSegments.userId, users.id))
    .where(and(eq(users.id, id), eq(users.role, 'customer')))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    avatarUrl: row.avatarUrl,
    gender: row.gender,
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
    notificationEmail: row.notificationEmail,
    notificationSms: row.notificationSms,
    tier: row.tier ?? null,
    totalDeliveries: row.totalDeliveries ?? 0,
    totalSpent: row.totalSpent ?? 0,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    primaryCity: row.primaryCity ?? null,
    healthScore: row.healthScore ?? 0,
  };
}

export type PaginatedDeliveries = {
  data: CustomerDeliveryItem[];
  total: number;
};

export async function getCustomerDeliveries(
  customerId: string,
  page: number,
  pageSize: number,
): Promise<PaginatedDeliveries> {
  const offset = (page - 1) * pageSize;

  const [countResult] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(eq(deliveries.customerId, customerId));

  const total = countResult?.total ?? 0;

  const rows = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      pickupAddress: deliveries.pickupAddress,
      pickupCity: deliveries.pickupCity,
      dropoffAddress: deliveries.dropoffAddress,
      dropoffCity: deliveries.dropoffCity,
      packageDescription: deliveries.packageDescription,
      packageCategory: deliveries.packageCategory,
      price: deliveries.price,
      amountPaid: deliveries.amountPaid,
      paymentStatus: deliveries.paymentStatus,
      recipientName: deliveries.recipientName,
      recipientPhone: deliveries.recipientPhone,
      createdAt: deliveries.createdAt,
    })
    .from(deliveries)
    .where(eq(deliveries.customerId, customerId))
    .orderBy(desc(deliveries.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows.map((r) => ({
      id: r.id,
      status: r.status,
      pickupAddress: r.pickupAddress,
      pickupCity: r.pickupCity,
      dropoffAddress: r.dropoffAddress,
      dropoffCity: r.dropoffCity,
      packageDescription: r.packageDescription,
      packageCategory: r.packageCategory,
      price: r.price,
      amountPaid: r.amountPaid,
      paymentStatus: r.paymentStatus,
      recipientName: r.recipientName,
      recipientPhone: r.recipientPhone,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}
