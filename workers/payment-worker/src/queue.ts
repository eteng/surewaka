import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const paymentQueue = new Queue('payment', { connection });

export type PaymentJobName =
  | 'escrow-hold'
  | 'escrow-release'
  | 'refund'
  | 'provision-dva'
  | 'notify-topup';

export type EscrowHoldJobData = {
  deliveryId: string;
  walletId: string;
  amount: number;
  reference: string;
};

export type EscrowReleaseJobData = {
  deliveryId: string;
  escrowHoldId: string;
  driverWalletId: string;
};

export type RefundJobData = {
  deliveryId: string;
  walletId: string;
  amount: number;
  rate: number;
  reason: string;
};

export type ProvisionDvaJobData = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type NotifyTopupJobData = {
  userId: string;
  amount: number;
};
