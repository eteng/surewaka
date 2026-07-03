import { z } from 'zod';

export const escalationActionSchema = z.object({
  deliveryId: z.string().uuid(),
  action: z.enum(['call_driver', 'reassign', 'mark_failed']),
  note: z.string().max(500).optional(),
});
