import type { ProviderResult } from './types';

export async function fetchNeonCost(date: string): Promise<ProviderResult> {
  const projectId = process.env.CRON_NEON_PROJECT_ID;
  const url = `https://console.neon.tech/api/v2/consumption_history/projects?project_ids=${projectId}&from=${date}T00:00:00Z&to=${date}T23:59:59Z&granularity=daily`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.CRON_NEON_API_KEY}` },
  });
  if (!res.ok) throw new Error(`Neon API ${res.status}`);
  const json = await res.json() as { periods: Array<{ consumption: { active_time_seconds: number } }> };
  // Approximate: $0.102/compute-hour; active_time in seconds
  const seconds = json.periods?.[0]?.consumption?.active_time_seconds ?? 0;
  const amountUsd = (seconds / 3600) * 0.102;
  return { amountUsd, rawResponse: json };
}
