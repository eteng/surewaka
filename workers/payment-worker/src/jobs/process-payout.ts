import { db, payoutRequests } from '@surewaka/db';
import { eq } from 'drizzle-orm';
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

export async function handleProcessPayout(data: ProcessPayoutJobData) {
  // 1. Fetch the payout request
  const [payout] = await db
    .select()
    .from(payoutRequests)
    .where(eq(payoutRequests.id, data.payoutRequestId));

  if (!payout) throw new Error(`Payout request not found: ${data.payoutRequestId}`);
  if (payout.status !== 'pending') {
    console.log(`[ProcessPayout] Skipping non-pending payout ${payout.id} (status: ${payout.status})`);
    return { skipped: true, status: payout.status };
  }

  // 2. Mark as processing
  await db
    .update(payoutRequests)
    .set({ status: 'processing' })
    .where(eq(payoutRequests.id, payout.id));

  try {
    // 3. Create transfer recipient on Paystack
    const recipient = await createRecipient(
      payout.accountName,
      payout.accountNumber,
      payout.bankCode,
    );

    // 4. Initiate the transfer
    const reference = `payout_transfer_${payout.id}`;
    const transfer = await initiateTransfer(
      payout.amount,
      recipient.recipient_code,
      reference,
      `SureWaka payout to ${payout.accountName}`,
    );

    // 5. Update payout request with Paystack codes
    await db
      .update(payoutRequests)
      .set({
        paystackRecipientCode: recipient.recipient_code,
        paystackTransferCode: transfer.transfer_code,
        // If Paystack returns immediate success (OTP disabled), mark completed
        ...(transfer.status === 'success'
          ? { status: 'completed', processedAt: new Date() }
          : {}),
      })
      .where(eq(payoutRequests.id, payout.id));

    return { transfer_code: transfer.transfer_code, status: transfer.status };
  } catch (err) {
    // Transfer failed — mark payout as failed, but DON'T reverse the wallet debit here.
    // Reversal should be a separate admin action or retry flow.
    const reason = err instanceof Error ? err.message : 'Unknown error';
    await db
      .update(payoutRequests)
      .set({ status: 'failed', failureReason: reason })
      .where(eq(payoutRequests.id, payout.id));

    throw err; // Re-throw so BullMQ can retry
  }
}
