#!/usr/bin/env npx tsx
/**
 * Seed sample payout requests for dev/testing.
 *
 * Usage (from repo root):
 *   cd apps/api && npx tsx --env-file=../../.env ../../scripts/seed-payouts.ts
 *
 * Creates test users + wallets if none exist, then inserts payouts across
 * all statuses (pending, processing, completed, failed, reversed).
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const BANKS = [
  { bankCode: '058', accountName_suffix: 'GTBank' },
  { bankCode: '011', accountName_suffix: 'First Bank' },
  { bankCode: '033', accountName_suffix: 'UBA' },
  { bankCode: '044', accountName_suffix: 'Access Bank' },
  { bankCode: '057', accountName_suffix: 'Zenith Bank' },
  { bankCode: '221', accountName_suffix: 'Stanbic' },
  { bankCode: '070', accountName_suffix: 'Fidelity' },
];

function randomBank() {
  return BANKS[Math.floor(Math.random() * BANKS.length)];
}

function fakeAccountNumber() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const TEST_USERS = [
  { name: 'Chukwuemeka Obi', email: 'chukwuemeka.test@surewaka.dev', phone: '+2348011111001' },
  { name: 'Amaka Eze', email: 'amaka.test@surewaka.dev', phone: '+2348011111002' },
  { name: 'Tunde Bakare', email: 'tunde.test@surewaka.dev', phone: '+2348011111003' },
  { name: 'Ngozi Adeyemi', email: 'ngozi.test@surewaka.dev', phone: '+2348011111004' },
  { name: 'Damilola Ọlá', email: 'damilola.test@surewaka.dev', phone: '+2348011111005' },
  { name: 'Ifeanyi Nwosu', email: 'ifeanyi.test@surewaka.dev', phone: '+2348011111006' },
  { name: 'Funmilayo Coker', email: 'funmilayo.test@surewaka.dev', phone: '+2348011111007' },
];

async function ensureTestWallets(): Promise<Array<{ wallet_id: string; user_name: string }>> {
  // Check for existing wallets first
  const existing = await sql`
    SELECT w.id AS wallet_id, u.name AS user_name
    FROM wallets w
    INNER JOIN users u ON u.id = w.user_id
    LIMIT 20
  `;

  if (existing.length > 0) {
    console.log(`Using ${existing.length} existing wallet(s).`);
    return existing as Array<{ wallet_id: string; user_name: string }>;
  }

  console.log('No wallets found. Creating test users and wallets...');

  const wallets: Array<{ wallet_id: string; user_name: string }> = [];

  for (const u of TEST_USERS) {
    // Insert user (clerk_id can be null for test data — use a dummy prefixed value)
    const dummyClerkId = `seed_${u.email.split('@')[0]}`;

    const [user] = await sql`
      INSERT INTO users (clerk_id, email, phone, name, role, verified)
      VALUES (${dummyClerkId}, ${u.email}, ${u.phone}, ${u.name}, 'customer', true)
      ON CONFLICT (clerk_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;

    const userId = (user as { id: string }).id;

    // Create wallet with zero balance
    const [wallet] = await sql`
      INSERT INTO wallets (user_id, balance, currency)
      VALUES (${userId}, 0, 'NGN')
      ON CONFLICT (user_id, currency) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING id
    `;

    const walletId = (wallet as { id: string }).id;
    wallets.push({ wallet_id: walletId, user_name: u.name });
    console.log(`  ✓ user + wallet: ${u.name}`);
  }

  return wallets;
}

async function main() {
  const wallets = await ensureTestWallets();
  const pick = (i: number) => wallets[i % wallets.length];

  console.log('\nInserting payout requests...');

  type Payout = {
    walletId: string;
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    paystackRecipientCode: string | null;
    paystackTransferCode: string | null;
    status: string;
    failureReason: string | null;
    processedAt: string | null;
    createdAt: string;
  };

  const payouts: Payout[] = [
    // pending
    {
      walletId: pick(0).wallet_id,
      amount: 5000_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(0).user_name,
      paystackRecipientCode: null,
      paystackTransferCode: null,
      status: 'pending',
      failureReason: null,
      processedAt: null,
      createdAt: daysAgo(0),
    },
    {
      walletId: pick(1).wallet_id,
      amount: 12500_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(1).user_name,
      paystackRecipientCode: null,
      paystackTransferCode: null,
      status: 'pending',
      failureReason: null,
      processedAt: null,
      createdAt: daysAgo(1),
    },
    // processing
    {
      walletId: pick(2).wallet_id,
      amount: 8000_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(2).user_name,
      paystackRecipientCode: 'RCP_seed01xyzabcde',
      paystackTransferCode: 'TRF_seed01xyzabcde',
      status: 'processing',
      failureReason: null,
      processedAt: null,
      createdAt: daysAgo(0),
    },
    // completed
    {
      walletId: pick(3).wallet_id,
      amount: 25000_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(3).user_name,
      paystackRecipientCode: 'RCP_seed02xyzabcde',
      paystackTransferCode: 'TRF_seed02xyzabcde',
      status: 'completed',
      failureReason: null,
      processedAt: daysAgo(2),
      createdAt: daysAgo(3),
    },
    {
      walletId: pick(4).wallet_id,
      amount: 3500_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(4).user_name,
      paystackRecipientCode: 'RCP_seed03xyzabcde',
      paystackTransferCode: 'TRF_seed03xyzabcde',
      status: 'completed',
      failureReason: null,
      processedAt: daysAgo(5),
      createdAt: daysAgo(6),
    },
    {
      walletId: pick(0).wallet_id,
      amount: 50000_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(0).user_name,
      paystackRecipientCode: 'RCP_seed04xyzabcde',
      paystackTransferCode: 'TRF_seed04xyzabcde',
      status: 'completed',
      failureReason: null,
      processedAt: daysAgo(8),
      createdAt: daysAgo(9),
    },
    // failed
    {
      walletId: pick(5).wallet_id,
      amount: 10000_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(5).user_name,
      paystackRecipientCode: 'RCP_seed05xyzabcde',
      paystackTransferCode: 'TRF_seed05xyzabcde',
      status: 'failed',
      failureReason: 'Account number does not match account name',
      processedAt: daysAgo(1),
      createdAt: daysAgo(2),
    },
    {
      walletId: pick(1).wallet_id,
      amount: 7500_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(1).user_name,
      paystackRecipientCode: null,
      paystackTransferCode: null,
      status: 'failed',
      failureReason: 'Exhausted retries — manual re-credit required',
      processedAt: null,
      createdAt: daysAgo(4),
    },
    // reversed
    {
      walletId: pick(6).wallet_id,
      amount: 15000_00,
      bankCode: randomBank().bankCode,
      accountNumber: fakeAccountNumber(),
      accountName: pick(6).user_name,
      paystackRecipientCode: 'RCP_seed06xyzabcde',
      paystackTransferCode: 'TRF_seed06xyzabcde',
      status: 'reversed',
      failureReason: 'Transfer reversed by bank',
      processedAt: daysAgo(3),
      createdAt: daysAgo(4),
    },
  ];

  let inserted = 0;
  for (const p of payouts) {
    await sql`
      INSERT INTO payout_requests (
        wallet_id, amount, bank_code, account_number, account_name,
        paystack_recipient_code, paystack_transfer_code,
        status, failure_reason, processed_at, created_at
      ) VALUES (
        ${p.walletId}, ${p.amount}, ${p.bankCode}, ${p.accountNumber}, ${p.accountName},
        ${p.paystackRecipientCode}, ${p.paystackTransferCode},
        ${p.status}, ${p.failureReason}, ${p.processedAt}, ${p.createdAt}
      )
    `;
    console.log(
      `  ✓ ${p.status.padEnd(12)} ₦${(p.amount / 100).toLocaleString('en-NG').padStart(9)} — ${p.accountName}`,
    );
    inserted++;
  }

  console.log(`\nDone. Inserted ${inserted} payout request(s).\n`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
