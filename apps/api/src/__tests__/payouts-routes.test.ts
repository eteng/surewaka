import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockVerifyToken = vi.fn();
vi.mock('@surewaka/auth', () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));

const mockGetWalletByUserId = vi.fn();
const mockDebitWallet = vi.fn();
vi.mock('../lib/wallet-service', () => ({
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
  debitWallet: (...a: unknown[]) => mockDebitWallet(...a),
}));

const mockEnqueuePaymentJob = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/queue-client', () => ({
  enqueuePaymentJob: (...a: unknown[]) => mockEnqueuePaymentJob(...a),
}));

const mockTx = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 'payout-1', status: 'pending', amount: 100000 }]),
};

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    // limit(1) = auth user lookup → return user row; limit(50) = payout list → return []
    limit: vi.fn().mockImplementation((n: number) =>
      Promise.resolve(n === 1 ? [{ id: 'user-123' }] : []),
    ),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'payout-1', status: 'pending', amount: 100000 }]),
    orderBy: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(mockTx)),
  },
  payoutRequests: 'payout_requests',
  wallets: 'wallets',
  users: { clerkId: 'clerk_id', id: 'id' },
  eq: vi.fn(),
  desc: vi.fn(),
}));

/** Returns a ClerkUserInfo as produced by verifyToken() */
function clerkUser() {
  return {
    clerkId: 'clerk_user_123',
    email: 'driver@example.com',
    phone: undefined,
    name: 'Test Driver',
    avatarUrl: undefined,
    roles: ['driver'],
    carrierId: undefined,
  };
}

async function createTestApp() {
  const mod = await import('../routes/payouts');
  const app = new Hono();
  app.route('/api/v1/payouts', mod.default);
  return app;
}

describe('Payouts routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEnqueuePaymentJob.mockResolvedValue(undefined);
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 500000 });
    mockTx.select.mockReturnThis();
    mockTx.from.mockReturnThis();
    mockTx.where.mockReturnThis();
    mockTx.insert.mockReturnThis();
    mockTx.values.mockReturnThis();
    mockTx.returning.mockResolvedValue([{ id: 'payout-1', status: 'pending', amount: 100000 }]);

    // Re-set limit behaviour after clearAllMocks wipes the implementation
    const { db } = await import('@surewaka/db');
    (db.limit as ReturnType<typeof vi.fn>).mockImplementation((n: number) =>
      Promise.resolve(n === 1 ? [{ id: 'user-123' }] : []),
    );

    // Default: valid token
    mockVerifyToken.mockResolvedValue(clerkUser());

    app = await createTestApp();
  });

  it('POST /request returns 401 without auth', async () => {
    mockVerifyToken.mockResolvedValue(null);
    const res = await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('POST /request returns 400 for account_number not 10 digits', async () => {
    const res = await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000, bank_code: '058', account_number: '123', account_name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /request creates payout and returns 201', async () => {
    mockDebitWallet.mockResolvedValue({ id: 'txn-1' });
    const res = await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000, bank_code: '058', account_number: '0123456789', account_name: 'Test Driver' }),
    });
    expect(res.status).toBe(201);
    expect(mockDebitWallet).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.data.status).toBe('pending');
  });

  it('POST /request enqueues process-payout job on 201', async () => {
    mockDebitWallet.mockResolvedValue({ id: 'txn-1' });

    await app.request('/api/v1/payouts/request', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000, bank_code: '058', account_number: '0123456789', account_name: 'Test Driver' }),
    });

    expect(mockEnqueuePaymentJob).toHaveBeenCalledWith('process-payout', { payoutRequestId: 'payout-1' });
  });
});
