import { Hono } from 'hono';
import { db, deliveries, driverLocations, drivers } from '@surewaka/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { recordDriverLocationSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';

type Env = { Variables: { user: AuthUser } };

const driverLocationRoutes = new Hono<Env>();
driverLocationRoutes.use('*', requireAuth);

driverLocationRoutes.post('/', async (c) => {
  const user = c.get('user');

  const body = await c.req.json();
  const parsed = recordDriverLocationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null },
      400,
    );
  }

  // Resolve driver record for this user
  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);

  if (!driver) {
    return c.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Driver profile not found' }, meta: null },
      404,
    );
  }

  if (parsed.data.deliveryId) {
    const [delivery] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.id, parsed.data.deliveryId), eq(deliveries.driverId, driver.id)))
      .limit(1);

    if (!delivery) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Delivery not assigned to this driver' }, meta: null },
        403,
      );
    }
  }

  const [location] = await db
    .insert(driverLocations)
    .values({
      driverId: driver.id,
      deliveryId: parsed.data.deliveryId ?? null,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    })
    .returning({ id: driverLocations.id });

  return c.json({ data: { id: location.id }, error: null, meta: null });
});

export default driverLocationRoutes;
