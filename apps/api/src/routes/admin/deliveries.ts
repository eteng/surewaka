// Feature: admin-deliveries
// Admin delivery routes — list deliveries with lifecycle tabs, filters, pagination, and search.

import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import { adminDeliveryListQuerySchema } from '@surewaka/shared';
import type { UserRole } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import { db, deliveries, users, drivers, carriers, weightDiscrepancyCorrections } from '@surewaka/db';
import { eq, and, or, ilike, inArray, sql, asc, desc } from 'drizzle-orm';
import { getDeliveryDetail } from '../../services/delivery-detail-service';
import { getDeliveryEvents } from '../../services/delivery-events-service';
import { getWalletByUserId, creditWallet } from '../../lib/wallet-service';
import { writeLedgerEvent } from '../../lib/ledger';

type DeliveryManagementEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    userRoles: UserRole[];
  };
};

const deliveryRoutes = new Hono<DeliveryManagementEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Lifecycle tab status groups ─────────────────────────────────────────────

const TAB_STATUSES = {
  requests: ['pending_routing', 'routing_failed', 'draft', 'pending', 'accepted'] as const,
  active: [
    'en_route_pickup',
    'arrived_pickup',
    'picked_up',
    'en_route_dropoff',
    'arrived_dropoff',
  ] as const,
  completed: ['delivered', 'cancelled', 'failed', 'returned'] as const,
} as const;

// All routes require authentication + surewaka_admin role
deliveryRoutes.use('*', requireAuth);
deliveryRoutes.use('*', requireRole('surewaka_admin'));

// ─── GET / — List deliveries with pagination, filtering, sorting, search ─────

deliveryRoutes.get('/', async (c) => {
  const query = c.req.query();

  const parsed = adminDeliveryListQuerySchema.safeParse(query);

  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        },
        meta: null,
      },
      400,
    );
  }

  const { page, pageSize, search, status, tab, sortBy, sortDir } = parsed.data;
  const offset = (page - 1) * pageSize;

  // Alias for the customer (users) table joined to deliveries
  const customerUser = users;

  // Alias for the driver's user record (to get driver name)
  // Drivers table has userId -> users table, so we need a second join on users for driver name
  // But we can't alias easily in Drizzle select-style. Instead we'll use sql for driver name.

  // ─── Build WHERE conditions ──────────────────────────────────────────────

  const conditions = [];

  // Tab-based lifecycle filtering
  if (tab === 'requests') {
    conditions.push(inArray(deliveries.status, [...TAB_STATUSES.requests]));
  } else if (tab === 'active') {
    conditions.push(inArray(deliveries.status, [...TAB_STATUSES.active]));
  } else if (tab === 'completed') {
    conditions.push(inArray(deliveries.status, [...TAB_STATUSES.completed]));
  }

  // Status filter (additional filter on top of tab)
  if (status) {
    conditions.push(eq(deliveries.status, status));
  }

  // Search across multiple fields using ILIKE
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(customerUser.name, pattern),
        ilike(customerUser.phone, pattern),
        ilike(deliveries.recipientName, pattern),
        ilike(deliveries.recipientPhone, pattern),
        ilike(deliveries.pickupAddress, pattern),
        ilike(deliveries.dropoffAddress, pattern),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // ─── Determine sort order ────────────────────────────────────────────────

  // Check if user provided explicit sort params (not just defaults)
  const hasExplicitSort = query.sortBy !== undefined;

  let orderByClause;

  if (hasExplicitSort) {
    // Use explicit sort when provided
    const dirFn = sortDir === 'asc' ? asc : desc;

    const sortColumnMap = {
      createdAt: deliveries.createdAt,
      status: deliveries.status,
      customerName: customerUser.name,
      price: deliveries.priceKobo,
    } as const;

    const sortColumn = sortColumnMap[sortBy] ?? deliveries.createdAt;
    orderByClause = dirFn(sortColumn);
  } else {
    // Apply tab-specific default sort
    switch (tab) {
      case 'requests':
        orderByClause = asc(deliveries.createdAt); // oldest unmatched first
        break;
      case 'active':
        orderByClause = desc(deliveries.updatedAt); // most recently active first
        break;
      case 'completed':
        orderByClause = desc(deliveries.createdAt); // newest completed first
        break;
      default:
        orderByClause = desc(deliveries.createdAt); // all tab: newest first
        break;
    }
  }

  // ─── Fetch paginated data with joins ─────────────────────────────────────

  const rows = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      pickupAddress: deliveries.pickupAddress,
      pickupCity: deliveries.pickupCity,
      dropoffAddress: deliveries.dropoffAddress,
      dropoffCity: deliveries.dropoffCity,
      packageCategory: deliveries.packageCategory,
      price: deliveries.priceKobo,
      createdAt: deliveries.createdAt,
      updatedAt: deliveries.updatedAt,
      customerName: customerUser.name,
      customerPhone: customerUser.phone,
      driverName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = ${drivers.userId})`,
      carrierName: carriers.name,
      recipientName: deliveries.recipientName,
      recipientPhone: deliveries.recipientPhone,
    })
    .from(deliveries)
    .innerJoin(customerUser, eq(deliveries.customerId, customerUser.id))
    .leftJoin(drivers, eq(deliveries.driverId, drivers.id))
    .leftJoin(carriers, eq(deliveries.carrierId, carriers.id))
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(pageSize)
    .offset(offset);

  // ─── Count total matching records ────────────────────────────────────────

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(customerUser, eq(deliveries.customerId, customerUser.id))
    .leftJoin(drivers, eq(deliveries.driverId, drivers.id))
    .leftJoin(carriers, eq(deliveries.carrierId, carriers.id))
    .where(whereClause);

  // ─── Compute tab counts (parallel count query grouped by status) ─────────

  const statusCounts = await db
    .select({
      status: deliveries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(deliveries)
    .groupBy(deliveries.status);

  const tabCounts = {
    all: 0,
    requests: 0,
    active: 0,
    completed: 0,
  };

  for (const row of statusCounts) {
    const cnt = row.count;
    tabCounts.all += cnt;

    if ((TAB_STATUSES.requests as readonly string[]).includes(row.status)) {
      tabCounts.requests += cnt;
    } else if ((TAB_STATUSES.active as readonly string[]).includes(row.status)) {
      tabCounts.active += cnt;
    } else if ((TAB_STATUSES.completed as readonly string[]).includes(row.status)) {
      tabCounts.completed += cnt;
    }
  }

  // ─── Build response ──────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / pageSize);

  const data = rows.map((row) => ({
    id: row.id,
    status: row.status,
    pickupAddress: row.pickupAddress,
    pickupCity: row.pickupCity,
    dropoffAddress: row.dropoffAddress,
    dropoffCity: row.dropoffCity,
    packageCategory: row.packageCategory,
    price: row.price,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    driverName: row.driverName ?? null,
    carrierName: row.carrierName ?? null,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
  }));

  return c.json(
    {
      data,
      error: null,
      meta: {
        total,
        page,
        pageSize,
        totalPages,
        tabCounts,
      },
    },
    200,
  );
});

// ─── GET /:id/events — Get delivery event trail ───────────────────────────────

deliveryRoutes.get('/:id/events', async (c) => {
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery ID format' },
        meta: null,
      },
      400,
    );
  }

  const events = await getDeliveryEvents(id);
  return c.json({ data: events, error: null, meta: null }, 200);
});

// ─── GET /:id — Get delivery detail ──────────────────────────────────────────

deliveryRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid delivery ID format' },
        meta: null,
      },
      400,
    );
  }

  const delivery = await getDeliveryDetail(id);

  if (!delivery) {
    return c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Delivery not found' },
        meta: null,
      },
      404,
    );
  }

  return c.json({ data: delivery, error: null, meta: null }, 200);
});

// ─── Admin Weight Correction Reversal ─────────────────────────────────────────

/**
 * POST /admin/deliveries/:id/reverse-weight-correction
 *
 * Reverses an auto-expired or declined weight correction. Credits the customer
 * the remaining 15% that was withheld and writes a commission_reversal ledger event.
 *
 * REQ-4: Admin manual correction reversal.
 */
deliveryRoutes.post('/:id/reverse-weight-correction', async (c) => {
  const user = c.get('user');
  const deliveryId = c.req.param('id');

  // 1. Load delivery
  const [delivery] = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      customerId: deliveries.customerId,
      amountPaid: deliveries.amountPaid,
      escrowHoldId: deliveries.escrowHoldId,
    })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));

  if (!delivery) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null },
      404,
    );
  }

  if (delivery.status !== 'failed') {
    return c.json(
      { data: null, error: { code: 'INVALID_STATUS', message: 'Only failed deliveries can be reversed' }, meta: null },
      422,
    );
  }

  // 2. Find the expired/declined correction
  const [correction] = await db
    .select()
    .from(weightDiscrepancyCorrections)
    .where(
      and(
        eq(weightDiscrepancyCorrections.deliveryId, deliveryId),
        inArray(weightDiscrepancyCorrections.status, ['expired', 'declined']),
      ),
    )
    .limit(1);

  if (!correction) {
    return c.json(
      { data: null, error: { code: 'NO_CORRECTION', message: 'No expired/declined weight correction found for this delivery' }, meta: null },
      422,
    );
  }

  if (correction.status === 'reversed') {
    return c.json(
      { data: null, error: { code: 'ALREADY_REVERSED', message: 'Correction already reversed' }, meta: null },
      409,
    );
  }

  // 3. Compute the withheld amount (15% of original escrow)
  const originalAmount = Number(delivery.amountPaid ?? 0);
  const alreadyRefunded = Math.floor(originalAmount * 0.85);
  const withheldAmount = originalAmount - alreadyRefunded;

  if (withheldAmount <= 0) {
    return c.json(
      { data: null, error: { code: 'NOTHING_TO_REVERSE', message: 'No withheld amount to refund' }, meta: null },
      422,
    );
  }

  // 4. Credit the customer
  const wallet = await getWalletByUserId(delivery.customerId);
  await creditWallet(
    wallet.id,
    withheldAmount,
    'refund',
    `weight_correction_reversal_${correction.id}`,
    `Admin reversal of weight correction for delivery ${deliveryId}`,
    { correction_id: correction.id, delivery_id: deliveryId, reversed_by: user.id },
  );

  // 5. Update correction status
  await db
    .update(weightDiscrepancyCorrections)
    .set({ status: 'reversed', respondedAt: new Date() })
    .where(eq(weightDiscrepancyCorrections.id, correction.id));

  // 6. Ledger event (fire-and-forget)
  writeLedgerEvent({
    category: 'revenue',
    type: 'commission_reversal',
    amountKobo: withheldAmount,
    sourceId: delivery.escrowHoldId ?? delivery.id,
    sourceType: 'escrow_hold',
  }).catch((err) => console.error('[admin] reversal ledger write failed:', err));

  return c.json({
    data: {
      correctionId: correction.id,
      refundedAmountKobo: withheldAmount,
      newCorrectionStatus: 'reversed',
    },
    error: null,
    meta: null,
  });
});

export default deliveryRoutes;
