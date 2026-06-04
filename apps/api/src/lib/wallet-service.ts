import { db, wallets, walletTransactions } from '@surewaka/db';
import { eq } from 'drizzle-orm';

export type TransactionType =
  | 'fund'
  | 'escrow_hold'
  | 'escrow_release'
  | 'refund'
  | 'payout'
  | 'commission'
  | 'adjustment';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxOrDb = any;

export async function getWalletByUserId(userId: string) {
  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId));
  if (!wallet) throw new Error('WALLET_NOT_FOUND');
  return wallet;
}

export async function creditWallet(
  walletId: string,
  amount: number,
  type: TransactionType,
  reference: string,
  description: string,
  metadata: Record<string, unknown> = {},
  passedTx?: TxOrDb,
) {
  const run = async (tx: TxOrDb) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for('update');

    if (!wallet) throw new Error('WALLET_NOT_FOUND');
    const newBalance = Number(wallet.balance) + amount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    const [txn] = await tx
      .insert(walletTransactions)
      .values({
        walletId,
        type,
        amount,
        balanceAfter: newBalance,
        reference,
        description,
        metadata,
      })
      .returning();

    return txn;
  };

  return passedTx ? run(passedTx) : db.transaction(run);
}

export async function debitWallet(
  walletId: string,
  amount: number,
  type: TransactionType,
  reference: string,
  description: string,
  metadata: Record<string, unknown> = {},
  passedTx?: TxOrDb,
) {
  const run = async (tx: TxOrDb) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .for('update');

    if (!wallet) throw new Error('WALLET_NOT_FOUND');
    if (Number(wallet.balance) < amount) throw new Error('INSUFFICIENT_BALANCE');
    const newBalance = Number(wallet.balance) - amount;

    await tx
      .update(wallets)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(wallets.id, walletId));

    const [txn] = await tx
      .insert(walletTransactions)
      .values({
        walletId,
        type,
        amount: -amount,
        balanceAfter: newBalance,
        reference,
        description,
        metadata,
      })
      .returning();

    return txn;
  };

  return passedTx ? run(passedTx) : db.transaction(run);
}

export async function checkBalance(walletId: string, amount: number) {
  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.id, walletId));

  if (!wallet) throw new Error('WALLET_NOT_FOUND');
  const balance = Number(wallet.balance);
  const sufficient = balance >= amount;
  return { sufficient, balance, shortfall: sufficient ? 0 : amount - balance };
}
