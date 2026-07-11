import { Hono } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/role';
import type { AuthUser } from '@surewaka/auth';
import type { UserRole } from '@surewaka/shared';
import {
  periodToDates,
  getOverviewKpis,
  getDeliveryPerformance,
  getDriverPerformance,
  getCarrierPerformance,
  getCustomerExperience,
  getRootCause,
} from '../../services/analytics-service';

type Env = {
  Variables: { user: AuthUser; accessToken: string; userRoles: UserRole[] };
};

const analyticsRoutes = new Hono<Env>();
analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', requireRole('surewaka_admin'));

function getPeriod(c: { req: { query: (k: string) => string | undefined } }) {
  const period = c.req.query('period') ?? 'week';
  const from = c.req.query('from');
  const to = c.req.query('to');
  return periodToDates(period, from, to);
}

analyticsRoutes.get('/overview', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getOverviewKpis(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/overview]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load overview' }, meta: null },
      500,
    );
  }
});

analyticsRoutes.get('/delivery-performance', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getDeliveryPerformance(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/delivery-performance]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load delivery performance' }, meta: null },
      500,
    );
  }
});

analyticsRoutes.get('/driver-performance', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getDriverPerformance(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/driver-performance]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load driver performance' }, meta: null },
      500,
    );
  }
});

analyticsRoutes.get('/carrier-performance', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getCarrierPerformance(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/carrier-performance]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load carrier performance' }, meta: null },
      500,
    );
  }
});

analyticsRoutes.get('/customer-experience', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getCustomerExperience(start, end);
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/customer-experience]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load customer experience' }, meta: null },
      500,
    );
  }
});

analyticsRoutes.get('/root-cause', async (c) => {
  try {
    const { start, end } = getPeriod(c);
    const data = await getRootCause({
      start,
      end,
      city: c.req.query('city') ?? 'Lagos',
      zone: c.req.query('zone'),
      driverId: c.req.query('driverId'),
      carrierId: c.req.query('carrierId'),
      legType: c.req.query('legType'),
      timeOfDay: c.req.query('timeOfDay') as 'morning' | 'midday' | 'evening' | 'night' | undefined,
    });
    return c.json({ data, error: null, meta: null });
  } catch (err) {
    console.error('[analytics/root-cause]', err);
    return c.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to load root cause data' }, meta: null },
      500,
    );
  }
});

export default analyticsRoutes;
