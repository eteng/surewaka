import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import crypto from 'crypto';

process.env.PAYSTACK_SECRET_KEY = 'test-webhook-secret';

const mockCreditWallet = vi.fn();
const mockGetWalletByUserId = vi.fn();

vi.mock('../lib/wallet-service', () => ({
  creditWallet: (...a: unknown[]) => mockCreditWallet(...a),
  getWalletByUserId: (...a: unknown[]) => mockGetWalletByUserId(...a),
}));

vi.mock('../lib/paystack', () => ({
  verifyWebhookSignature: (body: string, sig: string) => {
    const hash = crypto.createHmac('sha512', 'test-webhook-secret').update(body).digest('hex');
    return hash === sig;
  },
}));

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  },
  walletTransactions: 'wallet_transactions',
  wallets: 'wallets',
  users: 'users',
  eq: vi.fn(),
}));

async function createTestApp() {
  const webhookModule = await import('../routes/webhook');
  const app = new Hono();
  app.route('/api/v1/webhook', webhookModule.default);
  return app;
}

function makePayload(event: string, amount: number) {
  return JSON.stringify({
    event,
    data: {
      reference: 'ref_test_123',
      amount,
      status: 'success',
      customer: { email: 'user@example.com' },
      metadata: { topup_type: 'manual', user_id: 'user-123' },
    },
  });
}

function sign(body: string) {
  return crypto.createHmac('sha512', 'test-webhook-secret').update(body).digest('hex');
}

describe('Webhook — Paystack', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  it('returns 400 for invalid signature', async () => {
    const body = makePayload('charge.success', 350000);
    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'bad-sig' },
      body,
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 and credits wallet on charge.success', async () => {
    mockGetWalletByUserId.mockResolvedValue({ id: 'wallet-1', balance: 0 });
    mockCreditWallet.mockResolvedValue({ id: 'txn-1', amount: 350000 });

    const body = makePayload('charge.success', 350000);
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockCreditWallet).toHaveBeenCalledWith(
      'wallet-1', 350000, 'fund',
      'ref_test_123',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('returns 200 without crediting for duplicate reference (idempotency)', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'where' as never).mockResolvedValueOnce([{ id: 'existing-txn' }] as never);

    const body = makePayload('charge.success', 350000);
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockCreditWallet).not.toHaveBeenCalled();
  });
});
