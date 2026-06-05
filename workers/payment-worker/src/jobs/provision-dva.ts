import { db, wallets } from '@surewaka/db';
import { eq } from 'drizzle-orm';
import type { ProvisionDvaJobData } from '../queue';

async function paystackPost(path: string, body: unknown) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ status: boolean; data: Record<string, unknown> }>;
}

export async function handleProvisionDva(data: ProvisionDvaJobData) {
  const customerRes = await paystackPost('/customer', {
    email: data.email,
    first_name: data.firstName,
    last_name: data.lastName,
  });
  if (!customerRes.status) throw new Error('Failed to create Paystack customer');
  const customerCode = customerRes.data.customer_code as string;

  const dvaRes = await paystackPost('/dedicated_account', {
    customer: customerCode,
    preferred_bank: 'wema-bank',
  });
  if (!dvaRes.status) throw new Error('Failed to create DVA');

  const dvaData = dvaRes.data as { bank: { name: string }; account_number: string };

  const [wallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, data.userId));

  if (!wallet) throw new Error(`Wallet not found for userId: ${data.userId}`);

  await db
    .update(wallets)
    .set({
      dvaBank: dvaData.bank.name,
      dvaAccountNo: dvaData.account_number,
      dvaCustomerCode: customerCode,
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, wallet.id));

  return { account_number: dvaData.account_number };
}
