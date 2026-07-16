import type { ProviderResult } from './types';

export async function fetchAblyCost(date: string): Promise<ProviderResult> {
  const url = `https://rest.ably.io/stats?start=${date}T00:00:00Z&end=${date}T23:59:59Z&unit=day`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(process.env.CRON_ABLY_API_KEY ?? '').toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Ably API ${res.status}`);
  const json = await res.json() as Array<{ messages: { count: number } }>;
  const messages = json?.[0]?.messages?.count ?? 0;
  const ratePerMillion = parseFloat(process.env.ABLY_COST_PER_MILLION_MESSAGES_USD ?? '0.25');
  return { amountUsd: (messages / 1_000_000) * ratePerMillion, rawResponse: json };
}
