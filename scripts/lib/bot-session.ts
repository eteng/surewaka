/**
 * Actor Simulator — bot session tokens + a thin authenticated API client.
 *
 * Gives each bot a real Clerk session JWT — the same shape `requireAuth`
 * verifies for any other client — obtained purely through the Clerk Backend
 * API (`sessions.createSession` + `sessions.getToken`), no sign-in UI, no
 * auth bypass.
 *
 * One session is created per bot at startup; `getToken()` mints a fresh JWT
 * from that session on demand, refreshing lazily whenever the cached one is
 * old enough that it might have expired (Clerk session JWTs are short-lived,
 * on the order of a minute) rather than running a background timer — every
 * bot HTTP call already goes through `getToken()`, so this keeps the token
 * fresh with no interval handles to track or clean up on shutdown.
 *
 * See .kiro/specs/actor-simulator/design.md, Component 2.
 */

import { getClerkClient } from '@surewaka/auth';

const TOKEN_REFRESH_INTERVAL_MS = 50_000; // Clerk session JWTs last ~60s

export type BotSession = {
  clerkUserId: string;
  /** Returns a valid bearer token, minting a fresh one if the cached one is stale. */
  getToken: () => Promise<string>;
};

export async function createBotSession(clerkUserId: string): Promise<BotSession> {
  const clerk = getClerkClient();
  const session = await clerk.sessions.createSession({ userId: clerkUserId });

  let cachedToken: string | null = null;
  let cachedAt = 0;

  async function getToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && now - cachedAt < TOKEN_REFRESH_INTERVAL_MS) {
      return cachedToken;
    }
    const token = await clerk.sessions.getToken(session.id);
    cachedToken = token.jwt;
    cachedAt = now;
    return cachedToken;
  }

  return { clerkUserId, getToken };
}

// ─── Authenticated API client ──────────────────────────────────────────────

export const SIM_API_URL = process.env.SIM_API_URL ?? 'http://localhost:4000';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: { code: string; message: string } | null };

/**
 * Calls the real API as the given bot session. Mirrors the API's
 * `{ data, error, meta }` response envelope — never throws on a non-2xx
 * response, so callers can branch on `ok` without wrapping every call in
 * try/catch. Network-level failures (API not reachable) still throw, since
 * there's no envelope to report them through.
 */
export async function apiFetch<T>(
  session: BotSession,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const token = await session.getToken();
  const res = await fetch(`${SIM_API_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const json = (await res.json().catch(() => null)) as
    | { data: T; error: null }
    | { data: null; error: { code: string; message: string } }
    | null;

  if (res.ok && json) {
    return { ok: true, status: res.status, data: json.data };
  }
  return { ok: false, status: res.status, error: json?.error ?? null };
}
