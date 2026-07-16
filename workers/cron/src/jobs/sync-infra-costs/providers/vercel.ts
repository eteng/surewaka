import type { ProviderResult } from './types';

export async function fetchVercelCost(date: string): Promise<ProviderResult> {
  const url = `https://api.vercel.com/v2/billing/invoices?teamId=${process.env.CRON_VERCEL_TEAM_ID}&limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.CRON_VERCEL_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const json = await res.json() as { invoices: Array<{ total: number; periodStart: string; periodEnd: string }> };
  const invoice = json.invoices?.[0];
  if (!invoice) return { amountUsd: 0, rawResponse: json };
  const days = Math.max(1, Math.ceil((new Date(invoice.periodEnd).getTime() - new Date(invoice.periodStart).getTime()) / 86400000));
  return { amountUsd: invoice.total / days, rawResponse: json };
}
