import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, walletTransactions, users } from '@surewaka/db';
import { verifyWebhookSignature } from '../lib/paystack';
import { getWalletByUserId, creditWallet } from '../lib/wallet-service';
import { paystackWebhookSchema } from '@surewaka/shared';

const webhookRoutes = new Hono();

webhookRoutes.post('/paystack', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return c.json({ data: null, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' }, meta: null }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ data: null, error: { code: 'INVALID_JSON', message: 'Invalid JSON body' }, meta: null }, 400);
  }

  const parsed = paystackWebhookSchema.safeParse(payload);
  if (!parsed.success) return c.json({ data: { ok: true }, error: null, meta: null });

  const { event, data } = parsed.data;

  if (event !== 'charge.success') return c.json({ data: { ok: true }, error: null, meta: null });

  // Idempotency: skip if reference was already processed
  const existing = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(eq(walletTransactions.reference, data.reference));

  if (existing.length > 0) return c.json({ data: { ok: true }, error: null, meta: null });

  try {
    // Prefer user_id from metadata (set at transaction initialization) to avoid extra DB lookup
    const rawUserId = data.metadata?.['user_id'];
    const userId = typeof rawUserId === 'string' ? rawUserId : undefined;

    let resolvedUserId: string | undefined = userId;

    if (!resolvedUserId) {
      // Fallback: look up user by email
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, data.customer.email));

      if (!user) {
        console.error(`[webhook] No user found for email ${data.customer.email}`);
        return c.json({ data: { ok: true }, error: null, meta: null });
      }

      resolvedUserId = user.id;
    }

    const wallet = await getWalletByUserId(resolvedUserId);
    await creditWallet(
      wallet.id,
      data.amount,
      'fund',
      data.reference,
      'Wallet top-up via Paystack',
      data.metadata ?? {},
    );
  } catch (err) {
    console.error('[webhook] Failed to process charge.success', err);
  }

  return c.json({ data: { ok: true }, error: null, meta: null });
});

export default webhookRoutes;
