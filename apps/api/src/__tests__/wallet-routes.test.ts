import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockGetUser = vi.fn();
vi.mock('@surewaka/supabase', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

const mockGetWalletByUserId = vi.fn();
const mockCheckBalance = vi.fn();
const mockInitializeTransaction = vi.fn();
const mockVerifyTransaction = vi.fn();

vi.mock('../lib/wallet-service', () => ({
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
  checkBalance: (...a: unknown[]) => mockCheckBalance(...a),
  creditWallet: vi.fn(),
}));

vi.mock('../lib/paystack', () => ({
  initializeTransaction: (...a: unknown[]) => mockInitializeTransaction(...a),
  verifyTransaction: (...a: unknown[]) => mockVerifyTransaction(...a),
  createCustomer: vi.fn(),
  createDedicatedVirtualAccount: vi.fn(),
}));

vi.mock('@surewaka/db', () => ({ db: {}, wallets: 'wallets', walletTransactions: 'walletTransactions' }));

function authUser() {
  return { id: 'user-123', email: 'test@example.com', user_metadata: { name: 'Test User' }, app_metadata: {} };
}

async function createTestApp() {
  const walletModule = await import('../routes/wallet');
  const app = new Hono();
  app.route('/api/v1/wallet', walletModule.default);
  return app;
}

describe('Wallet routes', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('GET /balance returns 401 without auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await app.request('/api/v1/wallet/balance', {
      headers: { Authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /balance returns balance for authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 350000, currency: 'NGN', status: 'active' });
    const res = await app.request('/api/v1/wallet/balance', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.balance).toBe(350000);
    expect(body.data.currency).toBe('NGN');
  });

  it('POST /check returns sufficient=false with shortfall', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 100000 });
    mockCheckBalance.mockResolvedValue({ sufficient: false, balance: 100000, shortfall: 250000 });
    const res = await app.request('/api/v1/wallet/check', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 350000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sufficient).toBe(false);
    expect(body.data.shortfall).toBe(250000);
  });

  it('POST /fund returns reference and authorization_url', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    mockInitializeTransaction.mockResolvedValue({
      reference: 'ref_abc',
      authorization_url: 'https://paystack.com/pay/ref_abc',
    });
    const res = await app.request('/api/v1/wallet/fund', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500000, email: 'test@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reference).toBe('ref_abc');
  });

  it('POST /fund returns 400 for amount below minimum', async () => {
    mockGetUser.mockResolvedValue({ data: { user: authUser() }, error: null });
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    const res = await app.request('/api/v1/wallet/fund', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10000, email: 'test@example.com' }),
    });
    expect(res.status).toBe(400);
  });
});
