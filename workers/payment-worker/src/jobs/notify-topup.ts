import type { NotifyTopupJobData } from '../queue';

export async function handleNotifyTopup(data: NotifyTopupJobData) {
  console.log(`[notify-topup] User ${data.userId} topped up ₦${data.amount / 100}`);
  return { notified: false, reason: 'push notifications not yet configured' };
}
