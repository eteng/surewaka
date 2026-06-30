import { db } from '@surewaka/db';
import { users, customerSegments } from '@surewaka/db';
import { eq, and, ilike, or, gte, lte, sql, asc, desc } from 'drizzle-orm';
import type { CustomerListQuery, CustomerListItem } from '@surewaka/shared';

type ListCustomersResult = {
  data: CustomerListItem[];
  total: number;
};

export async function listCustomers(params: CustomerListQuery): Promise<ListCustomersResult> {
  const { page, pageSize, search, tier, verified, city, joinedFrom, joinedTo, sortBy, sortDir } =
    params;

  const offset = (page - 1) * pageSize;

  // Build WHERE conditions
  const conditions = [eq(users.role, 'customer')];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(users.name, pattern),
        ilike(users.email, pattern),
        ilike(users.phone, pattern),
      )!,
    );
  }

  if (verified !== undefined) {
    conditions.push(eq(users.verified, verified === 'true'));
  }

  if (tier) {
    conditions.push(eq(customerSegments.tier, tier));
  }

  if (city) {
    conditions.push(ilike(customerSegments.primaryCity, `%${city}%`));
  }

  if (joinedFrom) {
    conditions.push(gte(users.createdAt, new Date(joinedFrom)));
  }

  if (joinedTo) {
    conditions.push(lte(users.createdAt, new Date(joinedTo)));
  }

  const whereClause = and(...conditions);

  // Determine sort column and direction
  const dirFn = sortDir === 'asc' ? asc : desc;

  const sortColumnMap = {
    createdAt: users.createdAt,
    name: users.name,
    totalSpent: customerSegments.totalSpent,
    lastDeliveryAt: customerSegments.lastDeliveryAt,
    totalDeliveries: customerSegments.totalDeliveries,
  } as const;

  const sortColumn = sortColumnMap[sortBy] ?? users.createdAt;

  // Count total
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(customerSegments, eq(users.id, customerSegments.userId))
    .where(whereClause);

  // Fetch paginated data
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      verified: users.verified,
      createdAt: users.createdAt,
      tier: customerSegments.tier,
      totalDeliveries: customerSegments.totalDeliveries,
      totalSpent: customerSegments.totalSpent,
      lastDeliveryAt: customerSegments.lastDeliveryAt,
      primaryCity: customerSegments.primaryCity,
      healthScore: customerSegments.healthScore,
    })
    .from(users)
    .leftJoin(customerSegments, eq(users.id, customerSegments.userId))
    .where(whereClause)
    .orderBy(dirFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  const data: CustomerListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatarUrl,
    verified: row.verified,
    tier: row.tier ?? null,
    totalDeliveries: row.totalDeliveries ?? 0,
    totalSpent: row.totalSpent ?? 0,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    primaryCity: row.primaryCity ?? null,
    healthScore: row.healthScore ?? 0,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, total: count };
}
