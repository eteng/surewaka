import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { createSavedAddressSchema, updateSavedAddressSchema, upsertRecentLocationSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import * as addressService from '../services/address-service';
import * as recentLocationService from '../services/recent-location-service';

type AddressRoutesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
  };
};

const addressRoutes = new Hono<AddressRoutesEnv>();

addressRoutes.use('*', requireAuth);

addressRoutes.get('/', async (c) => {
  const user = c.get('user');
  try {
    const result = await addressService.listAddresses(user.id);
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list addresses' }, meta: null }, 500);
  }
});

// /recent must be registered before /:id to avoid Hono matching 'recent' as an ID
addressRoutes.get('/recent', async (c) => {
  const user = c.get('user');
  try {
    const result = await recentLocationService.listRecent(user.id);
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list recent locations' }, meta: null }, 500);
  }
});

addressRoutes.post('/recent', async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const parsed = upsertRecentLocationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
    }
    await recentLocationService.upsertRecent(user.id, parsed.data);
    return c.json({ data: null, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to upsert recent location' }, meta: null }, 500);
  }
});

addressRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const result = await addressService.getAddress(user.id, id);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'NOT_FOUND' ? 404 : 500);
    }
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to get address' }, meta: null }, 500);
  }
});

addressRoutes.post('/', async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const parsed = createSavedAddressSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
    }
    const result = await addressService.createAddress(user.id, parsed.data);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'LIMIT_REACHED' ? 400 : 500);
    }
    return c.json({ data: result.data, error: null, meta: null }, 201);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create address' }, meta: null }, 500);
  }
});

addressRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const body = await c.req.json();
    const parsed = updateSavedAddressSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
    }
    const result = await addressService.updateAddress(user.id, id, parsed.data);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'NOT_FOUND' ? 404 : 500);
    }
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update address' }, meta: null }, 500);
  }
});

addressRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const result = await addressService.deleteAddress(user.id, id);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'NOT_FOUND' ? 404 : 500);
    }
    return c.json({ data: null, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete address' }, meta: null }, 500);
  }
});

export default addressRoutes;
