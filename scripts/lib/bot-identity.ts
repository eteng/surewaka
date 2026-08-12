/**
 * Actor Simulator — shared bot identity conventions.
 *
 * Used by the simulator CLI (scripts/simulate-actors.ts and its lib/*) that
 * drives bot accounts. Bot accounts are identified purely by the
 * `bot+*@surewaka.test` email convention — no DB schema change.
 *
 * NOTE: apps/api/scripts/seed-bot-actors.ts (which creates the bot accounts)
 * keeps its own copy of these same conventions rather than importing this
 * file — it lives inside the apps/api package ("type": "module") while this
 * file sits under a plain, unpackaged scripts/ directory, and a relative
 * import across that boundary breaks Node's CJS/ESM named-export interop
 * under pnpm's workspace node_modules layout. Keep both copies in sync by
 * hand if you change the email convention or coordinate list.
 *
 * See .kiro/specs/actor-simulator/design.md.
 */

export const BOT_EMAIL_DOMAIN = 'surewaka.test';

/** SQL LIKE pattern matching every bot account's email. */
export const BOT_EMAIL_LIKE = `bot+%@${BOT_EMAIL_DOMAIN}`;

export function driverBotEmail(n: number): string {
  return `bot+driver-${n}@${BOT_EMAIL_DOMAIN}`;
}

export function carrierBotEmail(n: number): string {
  return `bot+carrier-${n}@${BOT_EMAIL_DOMAIN}`;
}

/** True for any email produced by driverBotEmail/carrierBotEmail. */
export function isBotEmail(email: string | null | undefined): boolean {
  return !!email && email.startsWith('bot+') && email.endsWith(`@${BOT_EMAIL_DOMAIN}`);
}

/** Extracts the bot's numeric index and kind from its email, or null if not a bot email. */
export function parseBotEmail(email: string): { kind: 'driver' | 'carrier'; n: number } | null {
  const match = /^bot\+(driver|carrier)-(\d+)@surewaka\.test$/.exec(email);
  if (!match) return null;
  return { kind: match[1] as 'driver' | 'carrier', n: Number(match[2]) };
}

export type LagosPoint = { lat: number; lng: number; label: string };

/**
 * Starting coordinates spread across Lagos zones, so at least one driver bot
 * is plausibly near wherever a real booking's pickup point is, without
 * requiring manual per-session setup.
 */
export const LAGOS_BOT_START_POINTS: LagosPoint[] = [
  { lat: 6.6018, lng: 3.3515, label: 'Ikeja' },
  { lat: 6.4483, lng: 3.4746, label: 'Lekki Phase 1' },
  { lat: 6.5095, lng: 3.3711, label: 'Yaba' },
  { lat: 6.5, lng: 3.3548, label: 'Surulere' },
  { lat: 6.4281, lng: 3.4219, label: 'Victoria Island' },
  { lat: 6.4698, lng: 3.5852, label: 'Ajah' },
  { lat: 6.6432, lng: 3.3089, label: 'Agege' },
  { lat: 6.55, lng: 3.36, label: 'Ikoyi' },
];

export const BOT_VEHICLE_TYPES = ['motorcycle', 'car', 'van', 'truck'] as const;
