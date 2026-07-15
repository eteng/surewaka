import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, payoutRequests, feeSettings } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, debitWallet } from '../lib/wallet-service';
import { payoutRequestSchema } from '@surewaka/shared';
import { enqueuePaymentJob } from '../lib/queue-client';
import type { AuthUser } from '@surewaka/auth';
import { randomUUID } from 'crypto';

type Env = { Variables: { user: AuthUser; accessToken: string } };

const payoutRoutes = new Hono<Env>();
payoutRoutes.use('*', requireAuth);

payoutRoutes.post('/request', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = payoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        },
        meta: null,
      },
      400,
    );
  }

  try {
    const [settings] = await db.select({ withdrawalFeeKobo: feeSettings.withdrawalFeeKobo }).from(feeSettings).limit(1);
    const fee = settings?.withdrawalFeeKobo ?? 10000;

    const wallet = await getWalletByUserId(user.id);
    const reference = `payout_${randomUUID()}`;
    const totalDebit = parsed.data.amount + fee;

    const payout = await db.transaction(async (tx) => {
      await debitWallet(
        wallet.id,
        totalDebit,
        'payout',
        reference,
        `Payout to ${parsed.data.account_name} (${parsed.data.bank_code}) — includes ₦${fee / 100} withdrawal fee`,
        { fee_kobo: fee },
        tx,
      );

      const [inserted] = await tx
        .insert(payoutRequests)
        .values({
          walletId: wallet.id,
          amount: parsed.data.amount,
          feeKobo: fee,
          bankCode: parsed.data.bank_code,
          accountNumber: parsed.data.account_number,
          accountName: parsed.data.account_name,
          status: 'pending',
        })
        .returning();

      return inserted;
    });

    // Enqueue the payout processing job
    await enqueuePaymentJob('process-payout', { payoutRequestId: payout.id });

    return c.json({ data: { ...payout, fee_kobo: fee }, error: null, meta: null }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'WALLET_NOT_FOUND') {
      return c.json(
        {
          data: null,
          error: { code: 'WALLET_NOT_FOUND', message: 'No wallet found for this account' },
          meta: null,
        },
        404,
      );
    }
    if (msg === 'INSUFFICIENT_BALANCE') {
      return c.json(
        {
          data: null,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance too low (withdrawal amount + ₦100 fee must be covered)' },
          meta: null,
        },
        422,
      );
    }
    console.error('[POST /payouts/request]', err);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to request payout' },
        meta: null,
      },
      500,
    );
  }
});

payoutRoutes.get('/', async (c) => {
  const user = c.get('user');
  try {
    const wallet = await getWalletByUserId(user.id);
    const rows = await db
      .select()
      .from(payoutRequests)
      .where(eq(payoutRequests.walletId, wallet.id))
      .orderBy(desc(payoutRequests.createdAt))
      .limit(50);
    return c.json({ data: rows, error: null, meta: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'WALLET_NOT_FOUND') {
      return c.json(
        {
          data: null,
          error: { code: 'WALLET_NOT_FOUND', message: 'No wallet found for this account' },
          meta: null,
        },
        404,
      );
    }
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payouts' }, meta: null },
      500,
    );
  }
});

export default payoutRoutes;
