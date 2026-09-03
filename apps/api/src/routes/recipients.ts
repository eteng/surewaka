import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ZodError } from 'zod';
import { requireAuth } from '../middleware/auth';
import { createSavedRecipientSchema, updateSavedRecipientSchema } from '@surewaka/shared';
import type { AuthUser } from '@surewaka/auth';
import * as recipientService from '../services/recipient-service';

type RecipientRoutesEnv = {
  Variables: {
    user: AuthUser;
    accessToken: string;
    // Structured diagnostic context the request logger folds into the ≥400
    // error-log entry (see middleware/logging.ts).
    logExtra: Record<string, unknown>;
  };
};

const recipientRoutes = new Hono<RecipientRoutesEnv>();

recipientRoutes.use('*', requireAuth);

// Emit a structured validation-failure log for monitoring/analytics without any
// PII: only the offending field name(s) and Zod issue code(s) are recorded, never
// the submitted values. This attaches to `logExtra`, which the request logger folds
// into the ≥400 error-log entry (logs/api/error/YYYY-MM-DD.log).
function logValidationFailure(c: Context<RecipientRoutesEnv>, userId: string, error: ZodError) {
  const fields = error.issues.map((issue) => issue.path.join('.'));
  const codes = error.issues.map((issue) => issue.code);
  c.set('logExtra', {
    event: 'recipient_validation_failed',
    userId,
    field: fields,
    code: codes,
  });
}

recipientRoutes.get('/', async (c) => {
  const user = c.get('user');
  try {
    const result = await recipientService.listRecipients(user.id);
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to list recipients' }, meta: null }, 500);
  }
});

recipientRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const result = await recipientService.getRecipient(user.id, id);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'NOT_FOUND' ? 404 : 500);
    }
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to get recipient' }, meta: null }, 500);
  }
});

recipientRoutes.post('/', async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.json();
    const parsed = createSavedRecipientSchema.safeParse(body);
    if (!parsed.success) {
      logValidationFailure(c, user.id, parsed.error);
      return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
    }
    const result = await recipientService.createRecipient(user.id, parsed.data);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'LIMIT_REACHED' ? 400 : 500);
    }
    return c.json({ data: result.data, error: null, meta: null }, 201);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create recipient' }, meta: null }, 500);
  }
});

recipientRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const body = await c.req.json();
    const parsed = updateSavedRecipientSchema.safeParse(body);
    if (!parsed.success) {
      logValidationFailure(c, user.id, parsed.error);
      return c.json({ data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.message }, meta: null }, 400);
    }
    const result = await recipientService.updateRecipient(user.id, id, parsed.data);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'NOT_FOUND' ? 404 : 500);
    }
    return c.json({ data: result.data, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update recipient' }, meta: null }, 500);
  }
});

recipientRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    const result = await recipientService.deleteRecipient(user.id, id);
    if (result.error) {
      return c.json({ data: null, error: result.error, meta: null }, result.error.code === 'NOT_FOUND' ? 404 : 500);
    }
    return c.json({ data: null, error: null, meta: null }, 200);
  } catch {
    return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete recipient' }, meta: null }, 500);
  }
});

export default recipientRoutes;
