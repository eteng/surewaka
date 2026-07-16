import { db, costSnapshots } from '@surewaka/db';
import { getUsdToNgnRate } from '../../lib/exchange-rate';
import { fetchFlyCost } from './providers/fly';
import { fetchNeonCost } from './providers/neon';
import { fetchVercelCost } from './providers/vercel';
import { fetchClerkCost } from './providers/clerk';
import { fetchAblyCost } from './providers/ably';

type Provider = 'vercel' | 'fly' | 'neon' | 'clerk' | 'ably';

const PROVIDERS: Record<Provider, (date: string) => Promise<{ amountUsd: number; rawResponse: unknown }>> = {
  vercel: fetchVercelCost,
  fly: fetchFlyCost,
  neon: fetchNeonCost,
  clerk: fetchClerkCost,
  ably: fetchAblyCost,
};

export async function handleSyncInfraCosts(): Promise<void> {
  // Pull yesterday's costs
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const date = yesterday.toISOString().split('T')[0]!;

  console.log(`[SyncInfraCosts] Syncing costs for ${date}`);

  const rate = await getUsdToNgnRate();
  console.log(`[SyncInfraCosts] USD/NGN rate: ${rate}`);

  for (const [provider, fetcher] of Object.entries(PROVIDERS) as [Provider, (date: string) => Promise<{ amountUsd: number; rawResponse: unknown }>][]) {
    try {
      const { amountUsd, rawResponse } = await fetcher(date);
      const amountKobo = Math.round(amountUsd * rate * 100);

      await db.insert(costSnapshots).values({
        provider,
        amountUsd: String(amountUsd),
        usdToNgnRate: String(rate),
        amountKobo,
        snapshotDate: date,
        rawResponse: rawResponse as Record<string, unknown>,
      }).onConflictDoUpdate({
        target: [costSnapshots.provider, costSnapshots.snapshotDate],
        set: { amountUsd: String(amountUsd), usdToNgnRate: String(rate), amountKobo, rawResponse: rawResponse as Record<string, unknown> },
      });

      console.log(`[SyncInfraCosts] ✅ ${provider}: $${amountUsd.toFixed(4)} → ₦${(amountKobo / 100).toFixed(2)}`);
    } catch (err) {
      console.error(`[SyncInfraCosts] ❌ ${provider} failed — skipping:`, err);
    }
  }
}
