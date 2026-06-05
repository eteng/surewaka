import { Worker } from 'bullmq';
import { connection } from './queue';
import { handleEscrowHold } from './jobs/escrow-hold';
import { handleEscrowRelease } from './jobs/escrow-release';
import { handleRefund } from './jobs/refund';
import { handleProvisionDva } from './jobs/provision-dva';
import { handleNotifyTopup } from './jobs/notify-topup';
import type {
  PaymentJobName,
  EscrowHoldJobData,
  EscrowReleaseJobData,
  RefundJobData,
  ProvisionDvaJobData,
  NotifyTopupJobData,
} from './queue';

type PaymentJobData =
  | EscrowHoldJobData
  | EscrowReleaseJobData
  | RefundJobData
  | ProvisionDvaJobData
  | NotifyTopupJobData;

const worker = new Worker<PaymentJobData, void, PaymentJobName>(
  'payment',
  async (job) => {
    switch (job.name) {
      case 'escrow-hold':    return handleEscrowHold(job.data as EscrowHoldJobData);
      case 'escrow-release': return handleEscrowRelease(job.data as EscrowReleaseJobData);
      case 'refund':         return handleRefund(job.data as RefundJobData);
      case 'provision-dva':  return handleProvisionDva(job.data as ProvisionDvaJobData);
      case 'notify-topup':   return handleNotifyTopup(job.data as NotifyTopupJobData);
      default:
        throw new Error(`Unknown job name: ${String(job.name)}`);
    }
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job) => console.log(`✅ Job ${job.id} (${job.name}) completed`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} (${job?.name}) failed:`, err));

console.log('💰 Payment worker started');
