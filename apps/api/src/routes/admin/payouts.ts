import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { db, payoutRequests, wallets, users, feeSettings } from '@surewaka/db';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';

type Env = { Variables: { user: AuthUser; userRoles: UserRole[] } };

const adminPayoutRoutes = new Hono<Env>();
adminPayoutRoutes.use('*', requireAuth);
adminPayoutRoutes.use('*', requireRole('surewaka_admin'));

adminPayoutRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  try {
    const baseQuery = db
      .select({
        id: payoutRequests.id,
        amount: payoutRequests.amount,
        feeKobo: payoutRequests.feeKobo,
        bankCode: payoutRequests.bankCode,
        accountNumber: payoutRequests.accountNumber,
        accountName: payoutRequests.accountName,
        status: payoutRequests.status,
        failureReason: payoutRequests.failureReason,
        paystackTransferCode: payoutRequests.paystackTransferCode,
        paystackRecipientCode: payoutRequests.paystackRecipientCode,
        createdAt: payoutRequests.createdAt,
        processedAt: payoutRequests.processedAt,
        userId: wallets.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(payoutRequests)
      .innerJoin(wallets, eq(wallets.id, payoutRequests.walletId))
      .innerJoin(users, eq(users.id, wallets.userId))
      .orderBy(desc(payoutRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const rows = status
      ? await baseQuery.where(eq(payoutRequests.status, status))
      : await baseQuery;

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(payoutRequests)
      .where(status ? eq(payoutRequests.status, status) : sql`true`);

    return c.json({
      data: rows,
      error: null,
      meta: { total: countRow.count, limit, offset },
    });
  } catch (err) {
    console.error('[GET /admin/payouts]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payouts' }, meta: null },
      500,
    );
  }
});

export default adminPayoutRoutes;
