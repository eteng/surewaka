import Ably from 'ably';
import type { RealtimeProvider, Unsubscribe } from './types';

/**
 * Ably-backed realtime provider.
 *
 * Server-side: uses REST client for publishing (no persistent connection).
 * Client-side: uses Realtime client for subscriptions (WebSocket).
 */
export function createAblyProvider(options?: { apiKey?: string; clientId?: string }): RealtimeProvider {
  // process.env works in Node; in browser environments it is injected at build time via Vite define
  const apiKey = options?.apiKey || (typeof process !== 'undefined' ? process.env.ABLY_API_KEY : undefined);

  if (!apiKey) {
    throw new Error('ABLY_API_KEY must be set');
  }

  // Lazy-init clients — only create what's needed
  let restClient: Ably.Rest | null = null;
  let realtimeClient: Ably.Realtime | null = null;

  function getRest(): Ably.Rest {
    if (!restClient) {
      restClient = new Ably.Rest({ key: apiKey });
    }
    return restClient;
  }

  function getRealtime(): Ably.Realtime {
    if (!realtimeClient) {
      realtimeClient = new Ably.Realtime({
        key: apiKey,
        clientId: options?.clientId ?? undefined,
      });
    }
    return realtimeClient;
  }

  return {
    async publish(channel: string, event: string, data: unknown): Promise<void> {
      const ch = getRest().channels.get(channel);
      await ch.publish(event, data);
    },

    subscribe(channel: string, event: string, callback: (data: unknown) => void): Unsubscribe {
      const ch = getRealtime().channels.get(channel);
      const listener = (message: Ably.Message) => {
        callback(message.data);
      };
      ch.subscribe(event, listener);

      return () => {
        ch.unsubscribe(event, listener);
      };
    },

    close(): void {
      if (realtimeClient) {
        realtimeClient.close();
        realtimeClient = null;
      }
      restClient = null;
    },
  };
}
