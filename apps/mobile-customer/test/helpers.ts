// Shared test helpers for the recipient screen tests.
//
// The screens use the REAL mobile-shared Zustand stores (useBookingStore,
// useRecipientStore) and the REAL API client (createRecipientsClient / the
// store's apiClient). The client's transport calls global.fetch, which we stub
// here so nothing hits the network and tests control every response.
import type { SavedRecipient } from '@surewaka/shared';
import { useRecipientStore, useBookingStore } from '@surewaka/mobile-shared';

const RECIPIENT_STORE_INITIAL = { recipients: [] as SavedRecipient[], fetched: false };

/** Reset the shared Zustand stores + router mock + spies between tests. */
export function resetStores() {
  useRecipientStore.setState({ ...RECIPIENT_STORE_INITIAL });
  useBookingStore.getState().reset();
  (global as any).__resetRouterMock();
  const sentry = require('@sentry/react-native');
  sentry.captureException.mockClear();
  // Reset the Alert spy + restore the default auto-press-destructive behaviour.
  const { Alert } = require('react-native');
  if ((Alert.alert as jest.Mock).mockClear) (Alert.alert as jest.Mock).mockClear();
  (global as any).__setAlertAutoPress?.(true);
}

/** Build a SavedRecipient with sensible defaults. */
export function makeRecipient(overrides: Partial<SavedRecipient> = {}): SavedRecipient {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    recipientName: 'Bola Ade',
    recipientPhone: '08012345678',
    deliveryNotes: 'Leave at gate',
    label: 'Home',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type FetchCall = { url: string; method: string; body: unknown };

export type FetchStub = {
  fn: jest.Mock;
  calls: FetchCall[];
  /** Queue a JSON `{ data, error, meta }` body for the next matching request. */
  enqueue: (body: unknown, init?: { ok?: boolean; status?: number }) => void;
  /** Make every request resolve to a network error (transport-level failure). */
  failNetwork: () => void;
};

/**
 * Install a fresh global.fetch stub. Requests are recorded; responses are drawn
 * from a FIFO queue. This mirrors the shape apiClient/request() expects:
 * response.ok + response.json() -> ApiResponse<T> ({ data, error, meta }).
 */
export function installFetch(): FetchStub {
  const calls: FetchCall[] = [];
  const queue: Array<{ body: unknown; ok: boolean; status: number }> = [];
  let networkError = false;

  const fn = jest.fn(async (url: string, init?: any) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    if (networkError) {
      throw new TypeError('Network request failed');
    }
    const next = queue.shift() ?? { body: { data: null, error: null, meta: null }, ok: true, status: 200 };
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body,
    } as Response;
  });
  (fn as any)._isJestStub = true;
  global.fetch = fn as any;

  return {
    fn,
    calls,
    enqueue: (body, initOpt) =>
      queue.push({ body, ok: initOpt?.ok ?? true, status: initOpt?.status ?? 200 }),
    failNetwork: () => {
      networkError = true;
    },
  };
}

/** A successful `{ data }` envelope. */
export function ok<T>(data: T) {
  return { data, error: null, meta: null };
}

/** An error `{ error }` envelope (server returns this in the body on !ok). */
export function errBody(code = 'SERVER_ERROR', message = 'boom') {
  return { data: null, error: { code, message }, meta: null };
}

/**
 * Terminal async drain used at the very end of a test that performed an async
 * event-handler interaction (e.g. the Save nudge). It flushes any trailing
 * store/setState continuations inside an act scope. NOTE: this does NOT fully
 * insulate a *subsequent* render in the same file from the known
 * test-renderer@1.x + React 19.2 reconciler carry-over, so mutation-style
 * screen tests are each kept in their own file (one async interaction per file)
 * — see the __tests__/*.save.*.test.tsx and *.delete.*.test.tsx files.
 */
export async function flushAsync(actFn: (cb: () => Promise<void>) => Promise<void>) {
  await actFn(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
