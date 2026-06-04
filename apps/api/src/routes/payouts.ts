import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db, payoutRequests } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, debitWallet } from '../lib/wallet-service';
import { payoutRequestSchema } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';
import { randomUUID } from 'crypto';

type Env = { Variables: { user: SupabaseUser; accessToken: string } };

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
    const wallet = await getWalletByUserId(user.id);
    const reference = `payout_${randomUUID().slice(0, 8)}`;

    await debitWallet(
      wallet.id,
      parsed.data.amount,
      'payout',
      reference,
      `Payout to ${parsed.data.account_name} (${parsed.data.bank_code})`,
    );

    const [payout] = await db
      .insert(payoutRequests)
      .values({
        walletId: wallet.id,
        amount: parsed.data.amount,
        bankCode: parsed.data.bank_code,
        accountNumber: parsed.data.account_number,
        accountName: parsed.data.account_name,
        status: 'pending',
      })
      .returning();

    return c.json({ data: payout, error: null, meta: null }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'INSUFFICIENT_BALANCE') {
      return c.json(
        {
          data: null,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance too low' },
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
  } catch {
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payouts' }, meta: null },
      500,
    );
  }
});

export default payoutRoutes;
