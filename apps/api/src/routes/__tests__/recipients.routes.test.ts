// Route unit tests for /api/v1/recipients (task 4.4).
//
// Validates: Requirements 4.1, 4.2, 4.4, 4.5, 5.2, 7.2
//
// These tests exercise the Hono sub-app directly via app.request(...), with:
//   - a switchable auth stub (reject → 401, or inject the session customer)
//   - the recipient-service module mocked so the route never touches the DB
// and assert the route maps service results to the correct HTTP status/shape,
// and that the user id handed to the service is always the injected session
// user's id — never a value from the request body.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { personas } from '../../test-utils/auth-mock';

// ── Auth stub: switchable between "reject" (401) and "inject customer" ────────
// requireAuth is the real middleware in production; here we replace it with a
// stub whose behavior flips per test via `authMode`. In 'reject' mode it mirrors
// the real middleware's 401 response and does NOT call next(), so the handler
// never runs (Requirements 4.1, 4.2). In 'inject' mode it sets the customer on
// the context exactly like a valid session would.
const CUSTOMER = personas.customer();
let authMode: 'reject' | 'inject' = 'inject';

vi.mock('../../middleware/auth', () => ({
  requireAuth: createMiddleware(async (c, next) => {
    if (authMode === 'reject') {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Missing token' }, meta: null },
        401,
      );
    }
    c.set('user', CUSTOMER);
    c.set('accessToken', 'test-token');
    await next();
  }),
}));

// ── Service mock ──────────────────────────────────────────────────────────────
const mockList = vi.fn();
const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../services/recipient-service', () => ({
  listRecipients: (...a: unknown[]) => mockList(...a),
  getRecipient: (...a: unknown[]) => mockGet(...a),
  createRecipient: (...a: unknown[]) => mockCreate(...a),
  updateRecipient: (...a: unknown[]) => mockUpdate(...a),
  deleteRecipient: (...a: unknown[]) => mockDelete(...a),
}));

async function createTestApp() {
  const { default: recipientRoutes } = await import('../recipients');
  const app = new Hono();
  app.route('/api/v1/recipients', recipientRoutes);
  return app;
}

const VALID_BODY = {
  recipientName: 'Ada Lovelace',
  recipientPhone: '08012345678',
  deliveryNotes: 'Leave at the gate',
  label: 'Home',
};

const SAVED = {
  id: '33333333-3333-4333-8333-333333333333',
  recipientName: VALID_BODY.recipientName,
  recipientPhone: VALID_BODY.recipientPhone,
  deliveryNotes: VALID_BODY.deliveryNotes,
  label: VALID_BODY.label,
  created_at: new Date().toISOString(),
};

const ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  authMode = 'inject';
});

// ── Requirements 4.1, 4.2: unauthenticated → 401, no data, service untouched ──
describe('authentication (no valid session → 401)', () => {
  const endpoints = [
    { name: 'GET /', method: 'GET', path: '/api/v1/recipients' },
    { name: 'GET /:id', method: 'GET', path: `/api/v1/recipients/${ID}` },
    { name: 'POST /', method: 'POST', path: '/api/v1/recipients', body: VALID_BODY },
    { name: 'PUT /:id', method: 'PUT', path: `/api/v1/recipients/${ID}`, body: VALID_BODY },
    { name: 'DELETE /:id', method: 'DELETE', path: `/api/v1/recipients/${ID}` },
  ] as const;

  for (const ep of endpoints) {
    it(`${ep.name} returns 401 with no data and never calls the service`, async () => {
      authMode = 'reject';
      const app = await createTestApp();

      const res = await app.request(ep.path, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: 'body' in ep && ep.body ? JSON.stringify(ep.body) : undefined,
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { data: unknown; error: { code: string } | null };
      expect(json.data).toBeNull();
      expect(json.error?.code).toBe('UNAUTHORIZED');

      expect(mockList).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
describe('GET /', () => {
  it('returns 200 with the list and passes the session user id', async () => {
    mockList.mockResolvedValue({ data: [SAVED], error: null, meta: null });
    const app = await createTestApp();

    const res = await app.request('/api/v1/recipients', {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[]; error: null };
    expect(json.data).toEqual([SAVED]);
    expect(json.error).toBeNull();
    expect(mockList).toHaveBeenCalledWith(CUSTOMER.id);
  });
});

// ── GET /:id ────────────────────────────────────────────────────────────────
describe('GET /:id', () => {
  it('returns 200 with the recipient (scoped to session user id)', async () => {
    mockGet.mockResolvedValue({ data: SAVED, error: null, meta: null });
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown; error: null };
    expect(json.data).toEqual(SAVED);
    expect(mockGet).toHaveBeenCalledWith(CUSTOMER.id, ID);
  });

  // Requirement 4.4: a recipient owned by another user is invisible → NOT_FOUND → 404.
  it('returns 404 when the service reports NOT_FOUND (cross-owner/unknown id)', async () => {
    mockGet.mockResolvedValue({
      data: null,
      error: { code: 'NOT_FOUND', message: 'Recipient not found' },
      meta: null,
    });
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { data: unknown; error: { code: string } };
    expect(json.data).toBeNull();
    expect(json.error.code).toBe('NOT_FOUND');
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────
describe('POST /', () => {
  it('returns 201 with the created recipient and uses the session user id', async () => {
    mockCreate.mockResolvedValue({ data: SAVED, error: null, meta: null });
    const app = await createTestApp();

    const res = await app.request('/api/v1/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: unknown; error: null };
    expect(json.data).toEqual(SAVED);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Requirement 4.5: user id comes from the session, not the body.
    expect((mockCreate.mock.calls[0] as unknown[])[0]).toBe(CUSTOMER.id);
  });

  // Requirement 4.5: even when the body carries a stray user_id, the service is
  // given the session user id — never the body's value.
  it('ignores a body-supplied user_id and passes the session id (4.5)', async () => {
    mockCreate.mockResolvedValue({ data: SAVED, error: null, meta: null });
    const app = await createTestApp();

    const res = await app.request('/api/v1/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ ...VALID_BODY, user_id: 'attacker-controlled-id', userId: 'attacker-2' }),
    });

    expect(res.status).toBe(201);
    const [passedUserId, passedInput] = mockCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(passedUserId).toBe(CUSTOMER.id);
    expect(passedUserId).not.toBe('attacker-controlled-id');
    // The stray fields are stripped by the schema before the service sees the input.
    expect(passedInput).not.toHaveProperty('user_id');
    expect(passedInput).not.toHaveProperty('userId');
  });

  // Requirement 7.2: invalid body → 400 VALIDATION_ERROR, service never called.
  it('returns 400 VALIDATION_ERROR for an invalid phone and never persists (7.2)', async () => {
    const app = await createTestApp();

    const res = await app.request('/api/v1/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ ...VALID_BODY, recipientPhone: 'not-a-phone' }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { data: unknown; error: { code: string } };
    expect(json.data).toBeNull();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Requirement 5.2: service LIMIT_REACHED → 400.
  it('returns 400 LIMIT_REACHED when the service reports the cap (5.2)', async () => {
    mockCreate.mockResolvedValue({
      data: null,
      error: { code: 'LIMIT_REACHED', message: 'You can save at most 25 recipients' },
      meta: null,
    });
    const app = await createTestApp();

    const res = await app.request('/api/v1/recipients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify(VALID_BODY),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { data: unknown; error: { code: string } };
    expect(json.data).toBeNull();
    expect(json.error.code).toBe('LIMIT_REACHED');
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
describe('PUT /:id', () => {
  it('returns 200 with the updated recipient and uses the session user id', async () => {
    mockUpdate.mockResolvedValue({ data: SAVED, error: null, meta: null });
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ label: 'Office' }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown; error: null };
    expect(json.data).toEqual(SAVED);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [passedUserId, passedId] = mockUpdate.mock.calls[0] as [string, string];
    expect(passedUserId).toBe(CUSTOMER.id);
    expect(passedId).toBe(ID);
  });

  it('returns 400 VALIDATION_ERROR for an invalid body and never persists (7.2)', async () => {
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ recipientName: 'x' }), // too short (min 2)
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Requirement 4.4: cross-owner/unknown id → NOT_FOUND → 404.
  it('returns 404 when the service reports NOT_FOUND (4.4)', async () => {
    mockUpdate.mockResolvedValue({
      data: null,
      error: { code: 'NOT_FOUND', message: 'Recipient not found' },
      meta: null,
    });
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ label: 'Office' }),
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });
});

// ── DELETE /:id ────────────────────────────────────────────────────────────
describe('DELETE /:id', () => {
  it('returns 200 with { data: null } and uses the session user id', async () => {
    mockDelete.mockResolvedValue({ data: null, error: null, meta: null });
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown; error: null };
    expect(json.data).toBeNull();
    expect(json.error).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith(CUSTOMER.id, ID);
  });

  it('returns 404 when the service reports NOT_FOUND (4.4)', async () => {
    mockDelete.mockResolvedValue({
      data: null,
      error: { code: 'NOT_FOUND', message: 'Recipient not found' },
      meta: null,
    });
    const app = await createTestApp();

    const res = await app.request(`/api/v1/recipients/${ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok' },
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });
});
