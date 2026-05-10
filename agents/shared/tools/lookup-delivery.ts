import { z } from 'zod';
import { createTool } from '@surewaka/ai';

/**
 * Tool for agents to look up delivery information.
 */
export const lookupDeliveryTool = createTool({
  name: 'lookup_delivery',
  description: 'Look up a delivery by its ID and return current status and details',
  parameters: z.object({
    deliveryId: z.string().describe('The delivery ID to look up'),
  }),
  execute: async ({ deliveryId }) => {
    // TODO: Replace with actual DB query
    return {
      id: deliveryId,
      status: 'in_transit',
      pickup: 'Lagos, Ikeja',
      dropoff: 'Lagos, Victoria Island',
      estimatedArrival: '30 minutes',
    };
  },
});
