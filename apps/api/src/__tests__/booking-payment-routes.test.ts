import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetUser = vi.fn();
vi.mock('@surewaka/supabase', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockDebitWallet = vi.fn();
const mockGetWalletByUserId = vi.fn();
const mockCreditWallet = vi.fn();
vi.mock('../lib/wallet-service', () => ({
  debitWallet: (...a: unknown[]) => mockDebitWallet(...a),
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
  creditWallet: (...a: unknown[]) => mockCreditWallet(...a),
}));

const mockDbUpdate = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
const mockDbInsert = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 'escrow-1' }]) };
const mockDbSelect = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 'delivery-1', status: 'pending', customerId: 'user-123', amountPaid: 350000, escrowHoldId: null }]) };

vi.mock('@surewaka/db', () => ({
  db: {
    transaction: vi.fn(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(mockDbSelect)),
    select: vi.fn(() => mockDbSelect),
    update: vi.fn(() => mockDbUpdate),
    insert: vi.fn(() => mockDbInsert),
  },
  deliveries: 'deliveries',
  escrowHolds: 'escrow_holds',
  walletTransactions: 'wallet_transactions',
  eq: vi.fn(),
}));

function authUser() {
  return { id: 'user-123', email: 'user@example.com', user_metadata: {}, app_metadata: {} };
}

async function createTestApp() {
  const mod = await import('../routes/booking-payment');
  const app = new Hono();
  app.route('/api/v1', mod.default);
  return app;
}

describe('Booking payment routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('POST /booking/confirm returns 401 without auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await app.request('/api/v1/booking/confirm', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad', 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_id: 'del-1', amount: 350000 }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /booking/confirm returns 400 for invalid body', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1' });
    const res = await app.request('/api/v1/booking/confirm', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 350000 }), // missing delivery_id
    });
    expect(res.status).toBe(400);
  });

  it('POST /deliveries/:id/cancel returns 422 for non-cancellable status', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockDbSelect.where.mockResolvedValueOnce([{ id: 'del-1', status: 'delivered', customerId: 'user-123', amountPaid: 350000, escrowHoldId: null }]);
    const res = await app.request('/api/v1/deliveries/del-1/cancel', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Changed my mind' }),
    });
    expect(res.status).toBe(422);
  });
});
