import { db, payoutRequests, wallets, walletTransactions } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { ProcessPayoutJobData } from '../queue';

const BASE = 'https://api.paystack.co';

function headers() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function createRecipient(name: string, accountNumber: string, bankCode: string) {
  const res = await fetch(`${BASE}/transferrecipient`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    }),
  });
  const json = (await res.json()) as { status: boolean; message?: string; data: { recipient_code: string } };
  if (!json.status) throw new Error(`Recipient creation failed: ${json.message ?? res.status}`);
  return json.data;
}

async function initiateTransfer(amount: number, recipientCode: string, reference: string, reason: string) {
  const res = await fetch(`${BASE}/transfer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      source: 'balance',
      amount,
      recipient: recipientCode,
      reference,
      reason,
    }),
  });
  const json = (await res.json()) as { status: boolean; message?: string; data: { transfer_code: string; status: string } };
  if (!json.status) throw new Error(`Transfer initiation failed: ${json.message ?? res.status}`);
  return json.data;
}

async function reversePayoutInWallet(walletId: string, amount: number, payoutId: string, reason: string) {
  await db.transaction(async (tx) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for('update');

    if (!wallet) throw new Error(`Wallet ${walletId} not found during reversal`);
    const newBalance = Number(wallet.balance) + amount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    await tx.insert(walletTransactions).values({
      walletId,
      type: 'payout_reversal',
      amount,
      balanceAfter: newBalance,
      reference: `reversal_${payoutId}`,
      description: reason,
    });

    await tx
      .update(payoutRequests)
      .set({ status: 'failed', failureReason: reason, processedAt: new Date() })
      .where(eq(payoutRequests.id, payoutId));
  });
}

export async function handleProcessPayout(job: Job<ProcessPayoutJobData>) {
  const { payoutRequestId } = job.data;

  const [payout] = await db
    .select()
    .from(payoutRequests)
    .where(eq(payoutRequests.id, payoutRequestId));

  if (!payout) throw new Error(`Payout request not found: ${payoutRequestId}`);

  // Skip terminal states — already handled (by webhook or a prior exhaustion)
  if (payout.status === 'completed' || payout.status === 'failed' || payout.status === 'reversed') {
    console.log(`[ProcessPayout] Skipping terminal payout ${payout.id} (status: ${payout.status})`);
    return { skipped: true, status: payout.status };
  }

  // Transfer already initiated — webhook will complete it, no need to re-call Paystack
  if (payout.paystackTransferCode) {
    console.log(`[ProcessPayout] Transfer already initiated for ${payout.id}, awaiting webhook`);
    return { skipped: true, reason: 'transfer_already_initiated' };
  }

  // Mark as processing
  await db
    .update(payoutRequests)
    .set({ status: 'processing' })
    .where(eq(payoutRequests.id, payout.id));

  try {
    const recipient = await createRecipient(payout.accountName, payout.accountNumber, payout.bankCode);
    const reference = `payout_transfer_${payout.id}`;
    const transfer = await initiateTransfer(
      payout.amount,
      recipient.recipient_code,
      reference,
      `SureWaka payout to ${payout.accountName}`,
    );

    await db
      .update(payoutRequests)
      .set({
        paystackRecipientCode: recipient.recipient_code,
        paystackTransferCode: transfer.transfer_code,
        ...(transfer.status === 'success' ? { status: 'completed', processedAt: new Date() } : {}),
      })
      .where(eq(payoutRequests.id, payout.id));

    return { transfer_code: transfer.transfer_code, status: transfer.status };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (isLastAttempt) {
      console.error(`[ProcessPayout] Exhausted retries for ${payout.id}:`, err);
      try {
        await reversePayoutInWallet(
          payout.walletId,
          payout.amount,
          payout.id,
          `Payout failed after ${job.attemptsMade} attempts: ${reason}`,
        );
      } catch (reversalErr) {
        console.error(`[ProcessPayout] REVERSAL FAILED for ${payout.id} — manual re-credit required`, reversalErr);
        await db
          .update(payoutRequests)
          .set({ status: 'failed', failureReason: 'Exhausted retries; reversal also failed — manual re-credit required' })
          .where(eq(payoutRequests.id, payout.id))
          .catch(() => {});
        throw reversalErr;
      }
    } else {
      // Intermediate failure — revert to pending so the next attempt can proceed
      await db
        .update(payoutRequests)
        .set({ status: 'pending' })
        .where(eq(payoutRequests.id, payout.id));
      throw err;
    }
  }
}
