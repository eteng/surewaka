import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, walletTransactions, wallets, users, payoutRequests } from '@surewaka/db';
import { verifyWebhookSignature } from '../lib/paystack';
import { getWalletByUserId, creditWallet } from '../lib/wallet-service';
import { paystackWebhookSchema } from '@surewaka/shared';
import { notifyPayoutCompleted, notifyPayoutFailed } from '../services/push-triggers';
import { writeLedgerEvent } from '../lib/ledger';
import { paystackTransferFee, paystackCollectionFee } from '../lib/paystack-fees';

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

  // ── charge.success — wallet top-up ──────────────────────────────────────────
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
      const txn = await creditWallet(
        wallet.id,
        amount,
        'fund',
        reference,
        'Wallet top-up via Paystack',
        data.metadata ?? {},
      );

      // Ledger: Paystack collection cost — non-blocking
      if (txn) {
        const channel = typeof data.channel === 'string' ? data.channel : 'card';
        const collectionFee = paystackCollectionFee(amount, channel);
        if (collectionFee > 0) {
          writeLedgerEvent({
            category: 'expense',
            type: 'paystack_collection',
            amountKobo: collectionFee,
            sourceId: txn.id,
            sourceType: 'wallet_transaction',
          }).catch((err) => console.error('[Webhook:Ledger] paystack_collection write failed:', err));
        }
      }
    } catch (err) {
      console.error('[webhook] Failed to process charge.success', err);
    }

    return c.json({ data: { ok: true }, error: null, meta: null });
  }

  // ── transfer events — payout callbacks ──────────────────────────────────────
  if (event === 'transfer.success' || event === 'transfer.failed' || event === 'transfer.reversed') {
    const transferCode = data.transfer_code;
    if (!transferCode) return c.json({ data: { ok: true }, error: null, meta: null });

    try {
      const rows = await db
        .select({
          id: payoutRequests.id,
          walletId: payoutRequests.walletId,
          amount: payoutRequests.amount,
          feeKobo: payoutRequests.feeKobo,
          status: payoutRequests.status,
          userId: wallets.userId,
        })
        .from(payoutRequests)
        .innerJoin(wallets, eq(wallets.id, payoutRequests.walletId))
        .where(eq(payoutRequests.paystackTransferCode, transferCode));

      if (rows.length === 0) {
        console.warn(`[webhook] No payout found for transfer_code ${transferCode}`);
        return c.json({ data: { ok: true }, error: null, meta: null });
      }

      const payout = rows[0];

      // Idempotency: skip if already in target terminal state
      if (
        (event === 'transfer.success' && payout.status === 'completed') ||
        (event === 'transfer.failed' && payout.status === 'failed') ||
        (event === 'transfer.reversed' && payout.status === 'reversed')
      ) {
        return c.json({ data: { ok: true }, error: null, meta: null });
      }

      if (event === 'transfer.success') {
        await db
          .update(payoutRequests)
          .set({ status: 'completed', processedAt: new Date() })
          .where(eq(payoutRequests.id, payout.id));

        await notifyPayoutCompleted(payout.id, payout.userId, payout.amount).catch((e) =>
          console.error('[webhook] notifyPayoutCompleted failed', e),
        );

        // Ledger: withdrawal fee revenue + Paystack transfer cost — non-blocking
        if (payout.feeKobo > 0) {
          writeLedgerEvent({
            category: 'revenue',
            type: 'withdrawal_fee',
            amountKobo: payout.feeKobo,
            sourceId: payout.id,
            sourceType: 'payout_request',
          }).catch((err) => console.error('[Webhook:Ledger] withdrawal_fee write failed:', err));
        }

        writeLedgerEvent({
          category: 'expense',
          type: 'paystack_transfer',
          amountKobo: paystackTransferFee(payout.amount),
          sourceId: payout.id,
          sourceType: 'payout_request',
        }).catch((err) => console.error('[Webhook:Ledger] paystack_transfer write failed:', err));
      } else {
        const newStatus = event === 'transfer.reversed' ? 'reversed' : 'failed';
        const failureReason =
          event === 'transfer.reversed'
            ? 'Transfer reversed by receiving bank'
            : (data.complete_message ?? 'Transfer failed');

        await db.transaction(async (tx) => {
          const [wallet] = await tx
            .select({ balance: wallets.balance })
            .from(wallets)
            .where(eq(wallets.id, payout.walletId))
            .for('update');

          if (!wallet) throw new Error(`Wallet ${payout.walletId} not found`);
          const newBalance = Number(wallet.balance) + payout.amount;

          await tx
            .update(wallets)
            .set({ balance: newBalance, updatedAt: new Date() })
            .where(eq(wallets.id, payout.walletId));

          await tx.insert(walletTransactions).values({
            walletId: payout.walletId,
            type: 'payout_reversal',
            amount: payout.amount,
            balanceAfter: newBalance,
            reference: `reversal_${payout.id}`,
            description: failureReason,
          });

          await tx
            .update(payoutRequests)
            .set({ status: newStatus, failureReason, processedAt: new Date() })
            .where(eq(payoutRequests.id, payout.id));
        });

        const notifyReason = event === 'transfer.reversed' ? 'reversed' : 'failed';
        await notifyPayoutFailed(payout.id, payout.userId, payout.amount, notifyReason).catch((e) =>
          console.error('[webhook] notifyPayoutFailed failed', e),
        );
      }
    } catch (err) {
      console.error(`[webhook] Failed to process ${event}`, err);
    }

    return c.json({ data: { ok: true }, error: null, meta: null });
  }

  return c.json({ data: { ok: true }, error: null, meta: null });
});

export default webhookRoutes;
