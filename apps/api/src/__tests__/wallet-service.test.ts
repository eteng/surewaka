import { describe, it, expect, vi } from 'vitest';

const mockTx = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  for: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

const mockDb = {
  transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

vi.mock('@surewaka/db', () => ({
  db: mockDb,
  wallets: 'wallets',
  walletTransactions: 'wallet_transactions',
  eq: vi.fn((a: unknown, b: unknown) => `${String(a)}=${String(b)}`),
}));

describe('wallet-service: creditWallet', () => {
  it('credits the wallet and returns the transaction', async () => {
    const mockWallet = { balance: 100000 };
    const mockTxnRow = { id: 'txn-1', amount: 350000, balanceAfter: 450000 };

    mockTx.for.mockResolvedValueOnce([mockWallet]);     // SELECT ... FOR UPDATE
    mockTx.returning.mockResolvedValueOnce([mockTxnRow]); // INSERT ... RETURNING

    const { creditWallet } = await import('../lib/wallet-service');
    const result = await creditWallet('wallet-id', 350000, 'fund', 'ref_123', 'Top up');

    expect(result).toEqual(mockTxnRow);
  });
});

describe('wallet-service: debitWallet', () => {
  it('throws INSUFFICIENT_BALANCE when debit exceeds balance', async () => {
    mockTx.for.mockResolvedValueOnce([{ balance: 10000 }]); // SELECT ... FOR UPDATE

    const { debitWallet } = await import('../lib/wallet-service');
    await expect(
      debitWallet('wallet-id', 50000, 'escrow_hold', 'ref_456', 'Delivery payment'),
    ).rejects.toThrow('INSUFFICIENT_BALANCE');
  });
});

describe('wallet-service: checkBalance', () => {
  it('checkBalance returns shortfall when balance is insufficient', async () => {
    mockDb.where.mockReturnThis();
    (mockDb as unknown as { then: unknown }).then = undefined;
    vi.spyOn(mockDb, 'where').mockResolvedValueOnce([{ balance: 20000 }] as never);

    const { checkBalance } = await import('../lib/wallet-service');
    const result = await checkBalance('wallet-id', 50000);

    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(30000);
    expect(result.balance).toBe(20000);
  });
});
