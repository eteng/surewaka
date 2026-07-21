import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export type RouteDeliveryJobData = {
  deliveryId: string;
  bookingTime: string; // ISO datetime — stamped at enqueue time
  vehicleType: string; // default 'motorcycle' for surewaka_way
};

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const routingQueue = new Queue<RouteDeliveryJobData>('routing', { connection });
