import { createAblyProvider, CHANNELS, EVENTS } from '@surewaka/realtime';
import type { RealtimeProvider } from '@surewaka/realtime';

/**
 * Server-side realtime instance.
 *
 * Used by route handlers and services to publish delivery status updates
 * and driver location broadcasts. Clients subscribe from their own apps
 * using @surewaka/realtime directly.
 *
 * Current provider: Ably (will migrate to Cloudflare Durable Objects later).
 */
let provider: RealtimeProvider | null = null;

export function getRealtime(): RealtimeProvider {
  if (!provider) {
    provider = createAblyProvider();
  }
  return provider;
}

export { CHANNELS, EVENTS };
