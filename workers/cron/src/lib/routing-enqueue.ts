import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export type RouteDeliveryJobData = {
  deliveryId: string;
  bookingTime: string;
  vehicleType: string;
};

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const routingQueue = new Queue<RouteDeliveryJobData>('routing', { connection });

export async function enqueueRouteDelivery(data: RouteDeliveryJobData): Promise<void> {
  await routingQueue.add('route-delivery', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
}
