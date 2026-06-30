import { db } from '@surewaka/db';
import { drivers, users, carrierMembers, carriers } from '@surewaka/db';
import { eq, and, ilike, or, sql, asc, desc, isNull, isNotNull } from 'drizzle-orm';
import type { DriverListQuery, DriverListItem } from '@surewaka/shared';

type ListDriversResult = {
  data: DriverListItem[];
  total: number;
};

export async function listDrivers(params: DriverListQuery): Promise<ListDriversResult> {
  const { page, pageSize, search, vehicleType, verified, available, carrierId, affiliation, sortBy, sortDir } =
    params;

  const offset = (page - 1) * pageSize;

  // Correlated subquery for total deliveries count
  const totalDeliveriesSq = sql<number>`(
    SELECT count(*)::int FROM deliveries
    WHERE deliveries.driver_id = ${drivers.id}
    AND deliveries.status = 'delivered'
  )`;

  // Build WHERE conditions
  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(users.name, pattern),
        ilike(users.phone, pattern),
      )!,
    );
  }

  if (vehicleType) {
    conditions.push(eq(drivers.vehicleType, vehicleType));
  }

  if (verified !== undefined) {
    conditions.push(eq(drivers.verified, verified === 'true'));
  }

  if (available !== undefined) {
    conditions.push(eq(drivers.available, available === 'true'));
  }

  if (carrierId) {
    conditions.push(eq(carrierMembers.carrierId, carrierId));
  }

  if (affiliation === 'independent') {
    conditions.push(isNull(carrierMembers.id));
  } else if (affiliation === 'carrier') {
    conditions.push(isNotNull(carrierMembers.id));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort column and direction
  const dirFn = sortDir === 'asc' ? asc : desc;

  const sortColumnMap = {
    createdAt: drivers.createdAt,
    rating: drivers.rating,
    name: users.name,
    totalDeliveries: totalDeliveriesSq,
  } as const;

  const sortColumn = sortColumnMap[sortBy] ?? drivers.createdAt;

  // Count total
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(drivers)
    .innerJoin(users, eq(drivers.userId, users.id))
    .leftJoin(carrierMembers, and(eq(carrierMembers.userId, drivers.userId), eq(carrierMembers.isActive, true)))
    .leftJoin(carriers, eq(carriers.id, carrierMembers.carrierId))
    .where(whereClause);

  // Fetch paginated data
  const rows = await db
    .select({
      id: drivers.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      avatarUrl: users.avatarUrl,
      vehicleType: drivers.vehicleType,
      licensePlate: drivers.licensePlate,
      vehicleModel: drivers.vehicleModel,
      verified: drivers.verified,
      available: drivers.available,
      rating: drivers.rating,
      totalDeliveries: totalDeliveriesSq,
      carrierName: carriers.name,
      carrierId: carrierMembers.carrierId,
      createdAt: drivers.createdAt,
    })
    .from(drivers)
    .innerJoin(users, eq(drivers.userId, users.id))
    .leftJoin(carrierMembers, and(eq(carrierMembers.userId, drivers.userId), eq(carrierMembers.isActive, true)))
    .leftJoin(carriers, eq(carriers.id, carrierMembers.carrierId))
    .where(whereClause)
    .orderBy(dirFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const data: DriverListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    avatarUrl: row.avatarUrl,
    vehicleType: row.vehicleType,
    licensePlate: row.licensePlate,
    vehicleModel: row.vehicleModel,
    verified: row.verified,
    available: row.available,
    rating: row.rating ?? 0,
    totalDeliveries: row.totalDeliveries ?? 0,
    carrierName: row.carrierName ?? null,
    carrierId: row.carrierId ?? null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, total: count };
}
