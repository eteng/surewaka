import { createHmac } from 'crypto';

const BASE = 'https://api.paystack.co';
const DVA_DEFAULT_BANK = 'wema-bank' as const;

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return key;
}

function headers() {
  return {
    Authorization: `Bearer ${getSecretKey()}`,
    'Content-Type': 'application/json',
  };
}

export type PaystackChargeData = {
  reference: string;
  amount: number;
  status: 'success' | 'failed' | 'abandoned';
  customer: { email: string };
  metadata: Record<string, unknown>;
};

export type DVAData = {
  bank: { name: string };
  account_number: string;
  account_name: string;
};

export async function initializeTransaction(
  amount: number,
  email: string,
  metadata: Record<string, unknown> = {},
): Promise<{ reference: string; authorization_url: string }> {
  const res = await fetch(`${BASE}/transaction/initialize`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ amount, email, metadata }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message?: string;
    data: { reference: string; authorization_url: string };
  };
  if (!json.status) throw new Error(`Paystack initialization failed: ${json.message ?? res.status}`);
  return json.data;
}

export async function verifyTransaction(reference: string): Promise<PaystackChargeData> {
  const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers(),
  });
  const json = (await res.json()) as { status: boolean; data: PaystackChargeData };
  if (!json.status) throw new Error('Paystack verification failed');
  return json.data;
}

export async function createCustomer(
  email: string,
  firstName: string,
  lastName: string,
): Promise<{ customer_code: string }> {
  const res = await fetch(`${BASE}/customer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, first_name: firstName, last_name: lastName }),
  });
  const json = (await res.json()) as { status: boolean; data: { customer_code: string } };
  if (!json.status) throw new Error('Paystack customer creation failed');
  return json.data;
}

export async function createDedicatedVirtualAccount(
  customerCode: string,
  preferredBank: string = DVA_DEFAULT_BANK,
): Promise<DVAData> {
  const res = await fetch(`${BASE}/dedicated_account`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ customer: customerCode, preferred_bank: preferredBank }),
  });
  const json = (await res.json()) as { status: boolean; data: DVAData };
  if (!json.status) throw new Error('Paystack DVA creation failed');
  return json.data;
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const hash = createHmac('sha512', getSecretKey())
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}
