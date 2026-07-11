import { Queue } from 'bullmq';

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
};

const paymentQueue = new Queue('payment', { connection: redisConnection });

type PaymentJobName =
  | 'escrow-hold'
  | 'escrow-release'
  | 'refund'
  | 'provision-dva'
  | 'notify-topup'
  | 'process-payout';

export async function enqueuePaymentJob(name: PaymentJobName, data: Record<string, unknown>) {
  await paymentQueue.add(name, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
