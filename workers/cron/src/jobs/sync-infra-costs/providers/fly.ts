import type { ProviderResult } from './types';

const FLY_GQL = 'https://api.fly.io/graphql';

export async function fetchFlyCost(date: string): Promise<ProviderResult> {
  const query = `
    query {
      organization(slug: "${process.env.CRON_FLY_ORG_SLUG}") {
        billable { amount }
      }
    }
  `;
  const res = await fetch(FLY_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_FLY_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Fly API ${res.status}`);
  const json = await res.json() as { data: { organization: { billable: { amount: number } } } };
  // Fly returns month-to-date; divide by day-of-month for daily estimate
  const dayOfMonth = new Date(date).getDate();
  const mtd = json.data.organization.billable.amount;
  return { amountUsd: mtd / dayOfMonth, rawResponse: json };
}
