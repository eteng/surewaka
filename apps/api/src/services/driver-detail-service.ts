import { db } from '@surewaka/db';
import { drivers, users, carrierMembers, carriers, deliveries } from '@surewaka/db';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { DriverDetail } from '@surewaka/shared';

export async function getDriverDetail(id: string): Promise<DriverDetail | null> {
  const totalDeliveriesSq = sql<number>`(
    SELECT count(*)::int FROM deliveries
    WHERE deliveries.driver_id = ${drivers.id}
    AND deliveries.status = 'delivered'
  )`;

  const [row] = await db
    .select({
      id: drivers.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      avatarUrl: users.avatarUrl,
      vehicleType: drivers.vehicleType,
      vehicleModel: drivers.vehicleModel,
      licensePlate: drivers.licensePlate,
      verified: drivers.verified,
      available: drivers.available,
      rating: drivers.rating,
      createdAt: drivers.createdAt,
      carrierId: carrierMembers.carrierId,
      carrierRole: carrierMembers.role,
      carrierJoinedAt: carrierMembers.joinedAt,
      carrierName: carriers.name,
      totalDeliveries: totalDeliveriesSq,
    })
    .from(drivers)
    .innerJoin(users, eq(drivers.userId, users.id))
    .leftJoin(
      carrierMembers,
      and(eq(carrierMembers.userId, drivers.userId), eq(carrierMembers.isActive, true)),
    )
    .leftJoin(carriers, eq(carriers.id, carrierMembers.carrierId))
    .where(eq(drivers.id, id))
    .limit(1);

  if (!row) return null;

  const recentRows = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      pickupAddress: deliveries.pickupAddress,
      dropoffAddress: deliveries.dropoffAddress,
      date: deliveries.createdAt,
      price: deliveries.price,
    })
    .from(deliveries)
    .where(eq(deliveries.driverId, id))
    .orderBy(desc(deliveries.createdAt))
    .limit(10);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    avatarUrl: row.avatarUrl,
    vehicleType: row.vehicleType,
    vehicleModel: row.vehicleModel,
    licensePlate: row.licensePlate,
    verified: row.verified,
    available: row.available,
    rating: row.rating ?? 0,
    totalDeliveries: row.totalDeliveries ?? 0,
    createdAt: row.createdAt.toISOString(),
    carrierName: row.carrierName ?? null,
    carrierId: row.carrierId ?? null,
    carrierRole: row.carrierRole ?? null,
    carrierJoinedAt: row.carrierJoinedAt?.toISOString() ?? null,
    recentDeliveries: recentRows.map((d) => ({
      id: d.id,
      status: d.status,
      pickupAddress: d.pickupAddress,
      dropoffAddress: d.dropoffAddress,
      date: d.date.toISOString(),
      price: d.price ?? 0,
    })),
  };
}
