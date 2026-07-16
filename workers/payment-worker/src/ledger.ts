import { Queue } from 'bullmq';
import { db, platformLedger } from '@surewaka/db';
import { connection } from './queue';

const ledgerQueue = new Queue('ledger', { connection });

export type LedgerEvent = {
  category: 'revenue' | 'expense';
  type: 'commission' | 'withdrawal_fee' | 'paystack_transfer' | 'paystack_collection' | 'commission_reversal';
  amountKobo: number;
  sourceId: string;
  sourceType: 'escrow_hold' | 'payout_request' | 'wallet_transaction';
};

export async function writeLedgerEvent(event: LedgerEvent): Promise<void> {
  try {
    await db.insert(platformLedger).values({
      category: event.category,
      type: event.type,
      amountKobo: event.amountKobo,
      sourceId: event.sourceId,
      sourceType: event.sourceType,
      occurredAt: new Date(),
    }).onConflictDoNothing();
  } catch (err) {
    console.error('[Ledger] Direct write failed, enqueueing retry:', err);
    try {
      await ledgerQueue.add('write-ledger-event', event, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: false,
      });
    } catch (e) {
      console.error('[Ledger] Retry enqueue also failed — event may be lost:', e);
    }
  }
}
