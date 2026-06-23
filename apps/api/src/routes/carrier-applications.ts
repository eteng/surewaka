// Feature: carrier-vetting-pipeline
// Public carrier application submission route — no auth required.

import { Hono } from 'hono';
import { submitCarrierApplicationSchema } from '@surewaka/shared';
import { submitApplication } from '../services/carrier-vetting-service';

const carrierApplications = new Hono();

// POST / — submit a new carrier application (public, no auth required)
carrierApplications.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = submitCarrierApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        data: null,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        meta: null,
      },
      400,
    );
  }

  const result = await submitApplication(parsed.data);
  if (result.error) {
    const status = result.error.code === 'CONFLICT' ? 409 : 500;
    return c.json({ data: null, error: result.error, meta: null }, status);
  }
  return c.json({ data: result.data, error: null, meta: null }, 201);
});

export default carrierApplications;
