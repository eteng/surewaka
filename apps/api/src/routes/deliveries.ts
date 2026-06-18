import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, deliveries, users } from '@surewaka/db';
import { requireAuth } from '../middleware/auth';
import { createDeliverySchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type DeliveriesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const deliveryRoutes = new Hono<DeliveriesEnv>();

deliveryRoutes.use('*', requireAuth);

deliveryRoutes.get('/', async (c) => {
  const user = c.get('user');
  try {
    const rows = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.customerId, user.id));
    return c.json({ data: { deliveries: rows, total: rows.length }, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list deliveries' }, meta: null }, 500);
  }
});

deliveryRoutes.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json();
  const parsed = createDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
  }

  const { pickup, dropoff, packageDetails, recipientDetails } = parsed.data;

  try {
    const [userRow] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, user.id));

    const [delivery] = await db
      .insert(deliveries)
      .values({
        customerId:         user.id,
        status:             'draft',
        pickupAddress:      pickup.address,
        pickupCity:         pickup.city,
        pickupLat:          pickup.lat,
        pickupLng:          pickup.lng,
        dropoffAddress:     dropoff.address,
        dropoffCity:        dropoff.city,
        dropoffLat:         dropoff.lat,
        dropoffLng:         dropoff.lng,
        packageDescription: packageDetails.description,
        packageWeight:      packageDetails.weight,
        packageCategory:    packageDetails.category,
        recipientName:      recipientDetails.recipientName,
        recipientPhone:     recipientDetails.recipientPhone,
        deliveryNotes:      recipientDetails.deliveryNotes ?? null,
        senderPhone:        userRow?.phone ?? null,
      })
      .returning();

    return c.json({ data: delivery, error: null, meta: null }, 201);
  } catch (err) {
    console.error('[POST /deliveries]', err);
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create delivery' }, meta: null }, 500);
  }
});

deliveryRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  try {
    const [delivery] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, id));

    if (!delivery || delivery.customerId !== user.id) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Delivery not found' }, meta: null }, 404);
    }

    return c.json({ data: delivery, error: null, meta: null });
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to get delivery' }, meta: null }, 500);
  }
});

export default deliveryRoutes;
