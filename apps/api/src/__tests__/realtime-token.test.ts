// Tests for the Ably token-auth endpoint (Realtime_Token_Endpoint, Requirement 1
// in .kiro/specs/realtime-delivery-tracking/requirements.md): mints a
// short-lived token scoped to exactly the caller's own delivery channel, so
// the mobile client never embeds the raw ABLY_API_KEY. See design.md
// Component 1 for why this talks to the Ably SDK directly instead of going
// through @surewaka/realtime's RealtimeProvider abstraction.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { asUser, asUnauthenticated } from '../test-utils/auth-mock';

// ─── Mock state ─────────────────────────────────────────────────────────────

let deliveryResult: Array<{ customerId: string }> = [];
const createTokenRequestCalls: Array<Record<string, unknown>> = [];

const CUSTOMER_ID = 'user-customer-id'; // matches personas.customer().id
const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
vi.mock('@surewaka/auth', () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));

vi.mock('@surewaka/db', () => {
  const deliveriesTable = { id: 'deliveries.id', customerId: 'deliveries.customerId' };
  const usersTable = { id: 'users.id', clerkId: 'users.clerkId' };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if (table === deliveriesTable) return Promise.resolve(deliveryResult);
              return Promise.resolve([{ id: CUSTOMER_ID }]); // users lookup (requireAuth)
            },
          }),
        }),
      }),
    },
    users: usersTable,
    deliveries: deliveriesTable,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b, op: 'eq' }),
}));

vi.mock('ably', () => ({
  default: {
    Rest: class {
      auth = {
        createTokenRequest: (params: Record<string, unknown>) => {
          createTokenRequestCalls.push(params);
          return Promise.resolve({ ...params, mac: 'fake-mac', keyName: 'fake-key' });
        },
      };
    },
  },
}));

// ─── App setup ──────────────────────────────────────────────────────────────

async function createTestApp() {
  const mod = await import('../routes/realtime-token');
  const app = new Hono();
  app.route('/api/v1/realtime', mod.default);
  return app;
}

describe('GET /api/v1/realtime/token', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    createTokenRequestCalls.length = 0;
    deliveryResult = [];
    process.env.ABLY_API_KEY = 'test-key.fake:secret';
    app = await createTestApp();
  });

  it('rejects unauthenticated requests', async () => {
    asUnauthenticated(mockVerifyToken);

    const res = await app.request(`/api/v1/realtime/token?deliveryId=${DELIVERY_ID}`, {
      headers: { Authorization: 'Bearer whatever' },
    });

    expect(res.status).toBe(401);
    expect(createTokenRequestCalls).toHaveLength(0);
  });

  it('rejects a malformed deliveryId', async () => {
    asUser(mockVerifyToken, 'customer');

    const res = await app.request('/api/v1/realtime/token?deliveryId=not-a-uuid', {
      headers: { Authorization: 'Bearer whatever' },
    });

    expect(res.status).toBe(400);
    expect(createTokenRequestCalls).toHaveLength(0);
  });

  it('returns 404 when the delivery does not exist', async () => {
    asUser(mockVerifyToken, 'customer');
    deliveryResult = [];

    const res = await app.request(`/api/v1/realtime/token?deliveryId=${DELIVERY_ID}`, {
      headers: { Authorization: 'Bearer whatever' },
    });

    expect(res.status).toBe(404);
    expect(createTokenRequestCalls).toHaveLength(0);
  });

  it('returns 404 when the caller does not own the delivery', async () => {
    asUser(mockVerifyToken, 'customer');
    deliveryResult = [{ customerId: 'someone-else' }];

    const res = await app.request(`/api/v1/realtime/token?deliveryId=${DELIVERY_ID}`, {
      headers: { Authorization: 'Bearer whatever' },
    });

    expect(res.status).toBe(404);
    expect(createTokenRequestCalls).toHaveLength(0);
  });

  it('issues a token scoped to exactly the caller delivery channel on the happy path', async () => {
    asUser(mockVerifyToken, 'customer');
    deliveryResult = [{ customerId: CUSTOMER_ID }];

    const res = await app.request(`/api/v1/realtime/token?deliveryId=${DELIVERY_ID}`, {
      headers: { Authorization: 'Bearer whatever' },
    });

    expect(res.status).toBe(200);
    expect(createTokenRequestCalls).toHaveLength(1);

    const capability = createTokenRequestCalls[0]?.capability as Record<string, string[]>;
    expect(Object.keys(capability)).toEqual([`delivery:${DELIVERY_ID}`]);
    expect(capability[`delivery:${DELIVERY_ID}`]).toEqual(['subscribe']);

    const body = (await res.json()) as { error: unknown; data: { mac: string } };
    expect(body.error).toBeNull();
    expect(body.data.mac).toBe('fake-mac');
  });
});
