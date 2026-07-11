import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, walletTransactions, users, payoutRequests } from '@surewaka/db';
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

  // ─── charge.success: wallet top-up ────────────────────────────────────────
  if (event === 'charge.success') {
    const reference = data.reference;
    const amount = data.amount;
    if (!reference || !amount) return c.json({ data: { ok: true }, error: null, meta: null });

    // Idempotency: skip if reference was already processed
    const existing = await db
      .select({ id: walletTransactions.id })
      .from(walletTransactions)
      .where(eq(walletTransactions.reference, reference));

    if (existing.length > 0) return c.json({ data: { ok: true }, error: null, meta: null });

    try {
      const rawUserId = data.metadata?.['user_id'];
      const userId = typeof rawUserId === 'string' ? rawUserId : undefined;
      let resolvedUserId: string | undefined = userId;

      if (!resolvedUserId) {
        const email = data.customer?.email;
        if (!email) {
          console.error('[webhook] No user_id in metadata and no customer email');
          return c.json({ data: { ok: true }, error: null, meta: null });
        }
        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email));

        if (!user) {
          console.error(`[webhook] No user found for email ${email}`);
          return c.json({ data: { ok: true }, error: null, meta: null });
        }
        resolvedUserId = user.id;
      }

      const wallet = await getWalletByUserId(resolvedUserId);
      await creditWallet(
        wallet.id,
        amount,
        'fund',
        reference,
        'Wallet top-up via Paystack',
        data.metadata ?? {},
      );
    } catch (err) {
      console.error('[webhook] Failed to process charge.success', err);
    }
  }

  // ─── transfer.success: payout completed ───────────────────────────────────
  if (event === 'transfer.success') {
    try {
      const transferCode = data.transfer_code as string | undefined;
      if (transferCode) {
        await db
          .update(payoutRequests)
          .set({ status: 'completed', processedAt: new Date() })
          .where(eq(payoutRequests.paystackTransferCode, transferCode));
      }
    } catch (err) {
      console.error('[webhook] Failed to process transfer.success', err);
    }
  }

  // ─── transfer.failed / transfer.reversed: payout failed ───────────────────
  if (event === 'transfer.failed' || event === 'transfer.reversed') {
    try {
      const transferCode = data.transfer_code as string | undefined;
      const reason = (data.reason as string) ?? (data.complete_message as string) ?? 'Transfer failed';
      if (transferCode) {
        const [payout] = await db
          .select({ id: payoutRequests.id, walletId: payoutRequests.walletId, amount: payoutRequests.amount })
          .from(payoutRequests)
          .where(eq(payoutRequests.paystackTransferCode, transferCode));

        if (payout && payout.walletId) {
          // Mark payout as failed
          await db
            .update(payoutRequests)
            .set({ status: 'failed', failureReason: reason })
            .where(eq(payoutRequests.id, payout.id));

          // Reverse the wallet debit — credit back the amount
          await creditWallet(
            payout.walletId,
            payout.amount,
            'adjustment',
            `reversal_${payout.id}`,
            `Payout failed: ${reason}`,
            { payoutRequestId: payout.id, event },
          );
        }
      }
    } catch (err) {
      console.error(`[webhook] Failed to process ${event}`, err);
    }
  }

  return c.json({ data: { ok: true }, error: null, meta: null });
});

export default webhookRoutes;
