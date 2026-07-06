import { enqueuePushFromWorker } from '../push-enqueue';
import type { NotifyTopupJobData } from '../queue';

export async function handleNotifyTopup(data: NotifyTopupJobData) {
  const naira = (data.amount / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

  const enqueued = await enqueuePushFromWorker(
    data.userId,
    'payment_received',
    {
      title: 'Wallet topped up',
      body: `₦${naira} has been added to your SureWaka wallet.`,
      data: {
        type: 'payment_received',
        resourceId: data.userId,
        deepLink: '/wallet',
      },
    },
    'customer',
  );

  return { notified: enqueued };
}
