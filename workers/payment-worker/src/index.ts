import { Worker } from 'bullmq';
import { connection } from './queue';
import { handleEscrowHold } from './jobs/escrow-hold';
import { handleEscrowRelease } from './jobs/escrow-release';
import { handleRefund } from './jobs/refund';
import { handleProvisionDva } from './jobs/provision-dva';
import { handleNotifyTopup } from './jobs/notify-topup';
import type { PaymentJobName } from './queue';

const worker = new Worker<unknown, unknown, PaymentJobName>(
  'payment',
  async (job) => {
    switch (job.name) {
      case 'escrow-hold':    return handleEscrowHold(job.data as never);
      case 'escrow-release': return handleEscrowRelease(job.data as never);
      case 'refund':         return handleRefund(job.data as never);
      case 'provision-dva':  return handleProvisionDva(job.data as never);
      case 'notify-topup':   return handleNotifyTopup(job.data as never);
      default:
        console.warn(`Unknown job: ${job.name}`);
    }
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job) => console.log(`✅ Job ${job.id} (${job.name}) completed`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} (${job?.name}) failed:`, err));

console.log('💰 Payment worker started');
