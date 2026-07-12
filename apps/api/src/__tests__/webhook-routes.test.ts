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

const mockNotifyPayoutCompleted = vi.fn().mockResolvedValue(true);
const mockNotifyPayoutFailed = vi.fn().mockResolvedValue(true);

vi.mock('../services/push-triggers', () => ({
  notifyPayoutCompleted: (...a: unknown[]) => mockNotifyPayoutCompleted(...a),
  notifyPayoutFailed: (...a: unknown[]) => mockNotifyPayoutFailed(...a),
}));

vi.mock('@surewaka/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  },
  walletTransactions: 'wallet_transactions',
  wallets: 'wallets',
  users: 'users',
  payoutRequests: 'payout_requests',
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

function makeTransferPayload(event: string, transferCode: string) {
  return JSON.stringify({
    event,
    data: {
      transfer_code: transferCode,
      amount: 100000,
      status: event === 'transfer.success' ? 'success' : 'failed',
      recipient: { recipient_code: 'RCP_test' },
      complete_message: event === 'transfer.failed' ? 'Transfer could not be completed' : undefined,
    },
  });
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

describe('Webhook — Paystack transfer events', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockNotifyPayoutCompleted.mockResolvedValue(true);
    mockNotifyPayoutFailed.mockResolvedValue(true);
    app = await createTestApp();
  });

  it('transfer.success marks payout completed and notifies user', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'select' as never).mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 'payout-1', walletId: 'wallet-1', amount: 100000, status: 'processing', userId: 'user-1' },
      ]),
    } as never);
    vi.spyOn(db, 'update' as never).mockReturnValueOnce({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never);

    const body = makeTransferPayload('transfer.success', 'TRF_abc123');
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockNotifyPayoutCompleted).toHaveBeenCalledWith('payout-1', 'user-1', 100000);
  });

  it('transfer.failed re-credits wallet and notifies user', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'select' as never).mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 'payout-1', walletId: 'wallet-1', amount: 100000, status: 'processing', userId: 'user-1' },
      ]),
    } as never);
    vi.spyOn(db, 'transaction' as never).mockImplementationOnce(
      (async (fn: (tx: unknown) => unknown) => {
        return fn({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockResolvedValue([{ balance: 500000 }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockResolvedValue([]),
        });
      }) as never,
    );

    const body = makeTransferPayload('transfer.failed', 'TRF_abc123');
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockNotifyPayoutFailed).toHaveBeenCalledWith('payout-1', 'user-1', 100000, 'failed');
  });

  it('transfer.reversed marks payout reversed, re-credits wallet, notifies user', async () => {
    const { db } = await import('@surewaka/db');
    vi.spyOn(db, 'select' as never).mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 'payout-1', walletId: 'wallet-1', amount: 100000, status: 'completed', userId: 'user-1' },
      ]),
    } as never);
    vi.spyOn(db, 'transaction' as never).mockImplementationOnce(
      (async (fn: (tx: unknown) => unknown) => {
        return fn({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockResolvedValue([{ balance: 500000 }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockResolvedValue([]),
        });
      }) as never,
    );

    const body = makeTransferPayload('transfer.reversed', 'TRF_abc123');
    const sig = sign(body);

    const res = await app.request('/api/v1/webhook/paystack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig },
      body,
    });

    expect(res.status).toBe(200);
    expect(mockNotifyPayoutFailed).toHaveBeenCalledWith('payout-1', 'user-1', 100000, 'reversed');
  });
});
