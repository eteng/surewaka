// Feature: waitlist-admin
// Waitlist Service — business logic for listing and querying waitlist signups.
// Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 8.1, 10.2, 10.3, 10.4, 10.5

import { db, waitlistSignups } from '@surewaka/db';
import { ilike, eq, or, and, asc, desc, count, gte, sql, type SQL } from 'drizzle-orm';
import type { WaitlistQuery } from '@surewaka/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WaitlistSignupRecord = typeof waitlistSignups.$inferSelect;

export type WaitlistListResult = {
  data: WaitlistSignupRecord[];
  total: number;
};

export type WaitlistStats = {
  total: number;
  bySender: number;
  byBusiness: number;
  byDriver: number;
  last7Days: number;
};

// ─── Column Mapping ──────────────────────────────────────────────────────────

const sortColumnMap = {
  fullName: waitlistSignups.fullName,
  email: waitlistSignups.email,
  userType: waitlistSignups.userType,
  createdAt: waitlistSignups.createdAt,
} as const;

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * List waitlist signups with search, filtering, sorting, and pagination.
 * Executes two queries: one for paginated data, one for total count.
 */
export async function listWaitlistSignups(params: WaitlistQuery): Promise<WaitlistListResult> {
  const { page, pageSize, search, userType, source, sortBy, sortDir } = params;

  // Build WHERE conditions
  const conditions: SQL[] = [];

  // Search filter: ILIKE on full_name OR email
  if (search && search.trim() !== '') {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(waitlistSignups.fullName, searchPattern),
        ilike(waitlistSignups.email, searchPattern)
      )!
    );
  }

  // User type filter
  if (userType) {
    conditions.push(eq(waitlistSignups.userType, userType));
  }

  // Source filter
  if (source) {
    conditions.push(eq(waitlistSignups.source, source));
  }

  // Combine all conditions with AND
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort direction and column
  const sortColumn = sortColumnMap[sortBy];
  const orderFn = sortDir === 'asc' ? asc : desc;

  // Calculate offset
  const offset = (page - 1) * pageSize;

  // Execute data query with filters, sorting, and pagination
  const data = await db
    .select()
    .from(waitlistSignups)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset(offset);

  // Execute count query with the same filters
  const [countResult] = await db
    .select({ total: count() })
    .from(waitlistSignups)
    .where(whereClause);

  return {
    data,
    total: countResult?.total ?? 0,
  };
}

/**
 * Get aggregate waitlist statistics.
 * Uses SQL COUNT with GROUP BY for per-type breakdown and a date filter for recent signups.
 * Requirements: 6.1, 6.2, 6.3, 10.6
 */
export async function getWaitlistStats(): Promise<WaitlistStats> {
  // Query per-type counts using GROUP BY
  const typeCounts = await db
    .select({
      userType: waitlistSignups.userType,
      count: count(),
    })
    .from(waitlistSignups)
    .groupBy(waitlistSignups.userType);

  // Query recent signups (last 7 days)
  const [recentResult] = await db
    .select({ count: count() })
    .from(waitlistSignups)
    .where(gte(waitlistSignups.createdAt, sql`now() - interval '7 days'`));

  // Build stats from the grouped results
  let total = 0;
  let bySender = 0;
  let byBusiness = 0;
  let byDriver = 0;

  for (const row of typeCounts) {
    total += row.count;
    switch (row.userType) {
      case 'sender':
        bySender = row.count;
        break;
      case 'business':
        byBusiness = row.count;
        break;
      case 'driver':
        byDriver = row.count;
        break;
    }
  }

  return {
    total,
    bySender,
    byBusiness,
    byDriver,
    last7Days: recentResult?.count ?? 0,
  };
}
