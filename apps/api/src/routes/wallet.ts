import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { db, wallets, walletTransactions } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { getWalletByUserId, getOrCreateWallet, checkBalance, creditWallet } from '../lib/wallet-service';
import {
  initializeTransaction,
  verifyTransaction,
  createCustomer,
  createDedicatedVirtualAccount,
} from '../lib/paystack';
import { initializeTopupSchema, walletCheckSchema } from '@surewaka/shared';
import type { SupabaseUser } from '@surewaka/supabase';

type Env = { Variables: { user: SupabaseUser; accessToken: string } };

const walletRoutes = new Hono<Env>();
walletRoutes.use('*', requireAuth);

walletRoutes.get('/balance', async (c) => {
  const user = c.get('user');
  try {
    const wallet = await getWalletByUserId(user.id);
    return c.json({
      data: { balance: Number(wallet.balance), currency: wallet.currency, status: wallet.status },
      error: null,
      meta: null,
    });
  } catch {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Wallet not found' }, meta: null },
      404,
    );
  }
});

walletRoutes.get('/transactions', async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page') ?? '1');
  const pageSize = Math.min(Number(c.req.query('pageSize') ?? '20'), 100);
  try {
    const wallet = await getWalletByUserId(user.id);
    const rows = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, wallet.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({ data: rows, error: null, meta: { page, pageSize } });
  } catch {
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions' },
        meta: null,
      },
      500,
    );
  }
});

walletRoutes.get('/dva', async (c) => {
  const user = c.get('user');
  try {
    const wallet = await getWalletByUserId(user.id);
    if (wallet.dvaAccountNo) {
      return c.json({
        data: { bank: wallet.dvaBank, account_number: wallet.dvaAccountNo },
        error: null,
        meta: null,
      });
    }
    const name = (user.user_metadata?.name as string | undefined) ?? '';
    const [firstName, ...rest] = name.split(' ');
    const customer = await createCustomer(user.email ?? '', firstName ?? '', rest.join(' '));
    const dva = await createDedicatedVirtualAccount(customer.customer_code);
    await db
      .update(wallets)
      .set({
        dvaBank: dva.bank.name,
        dvaAccountNo: dva.account_number,
        dvaCustomerCode: customer.customer_code,
      })
      .where(eq(wallets.id, wallet.id));
    return c.json({
      data: { bank: dva.bank.name, account_number: dva.account_number },
      error: null,
      meta: null,
    });
  } catch (err) {
    console.error('[GET /wallet/dva]', err);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to provision virtual account' },
        meta: null,
      },
      500,
    );
  }
});

walletRoutes.post('/fund', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = initializeTopupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map(i => i.message).join(', ') }, meta: null },
      400,
    );
  }
  const email = user.email || `user_${user.id}@wallet.surewaka.com`;
  try {
    const result = await initializeTransaction(parsed.data.amount, email, {
      topup_type: parsed.data.topup_type,
      delivery_id: parsed.data.delivery_id,
      user_id: user.id,
    });
    return c.json({ data: result, error: null, meta: null });
  } catch (err) {
    console.error('[POST /wallet/fund]', err);
    return c.json(
      {
        data: null,
        error: { code: 'PAYMENT_ERROR', message: 'Failed to initialize payment' },
        meta: null,
      },
      500,
    );
  }
});

walletRoutes.get('/fund/:reference', async (c) => {
  const user = c.get('user');
  const reference = c.req.param('reference');
  try {
    const txnData = await verifyTransaction(reference);

    if (txnData.status === 'success') {
      // Resolve wallet from the authenticated user — this is the authoritative
      // ownership boundary. Idempotency is then checked on (reference, wallet_id)
      // so a foreign reference can never credit this user's wallet, and this
      // user's reference can never credit a different wallet.
      const wallet = await getOrCreateWallet(user.id);

      const existing = await db
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(and(eq(walletTransactions.reference, reference), eq(walletTransactions.walletId, wallet.id)));

      if (existing.length === 0) {
        await creditWallet(wallet.id, txnData.amount, 'fund', reference, 'Wallet top-up via Paystack', txnData.metadata ?? {});
      }
    }

    return c.json({ data: { status: txnData.status, amount: txnData.amount }, error: null, meta: null });
  } catch (err) {
    console.error('[GET /wallet/fund/:reference]', err);
    return c.json({ data: null, error: { code: 'PAYMENT_VERIFY_ERROR', message: 'Could not verify payment status' }, meta: null }, 502);
  }
});

walletRoutes.post('/check', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = walletCheckSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map(i => i.message).join(', ') }, meta: null },
      400,
    );
  }
  try {
    const wallet = await getOrCreateWallet(user.id);
    const result = await checkBalance(wallet.id, parsed.data.amount);
    return c.json({ data: result, error: null, meta: null });
  } catch (err) {
    console.error('[POST /wallet/check]', err);
    return c.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check balance' },
        meta: null,
      },
      500,
    );
  }
});

export default walletRoutes;
