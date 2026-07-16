import type { ProviderResult } from './types';

export async function fetchClerkCost(_date: string): Promise<ProviderResult> {
  const res = await fetch('https://api.clerk.com/v1/billing/invoices?limit=1', {
    headers: { Authorization: `Bearer ${process.env.CRON_CLERK_SECRET_KEY}` },
  });
  if (!res.ok) throw new Error(`Clerk API ${res.status}`);
  const json = await res.json() as { data: Array<{ total: number; period_end: string; period_start: string }> };
  const invoice = json.data?.[0];
  if (!invoice) return { amountUsd: 0, rawResponse: json };
  const days = Math.max(1, Math.ceil((new Date(invoice.period_end).getTime() - new Date(invoice.period_start).getTime()) / 86400000));
  return { amountUsd: invoice.total / days / 100, rawResponse: json };  // Clerk amounts in cents
}
