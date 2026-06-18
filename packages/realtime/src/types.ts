/**
 * Realtime provider abstraction.
 *
 * Both Ably (current) and a future Cloudflare DO implementation
 * will satisfy this interface. App code imports from @surewaka/realtime
 * and never depends on the underlying provider directly.
 */

export type Unsubscribe = () => void;

export type RealtimeProvider = {
  /** Publish an event to a channel (server-side). */
  publish(channel: string, event: string, data: unknown): Promise<void>;

  /** Subscribe to events on a channel (client-side). */
  subscribe(channel: string, event: string, callback: (data: unknown) => void): Unsubscribe;

  /** Close all connections and clean up resources. */
  close(): void;
};

/**
 * Well-known channel patterns for SureWaka realtime.
 */
export const CHANNELS = {
  deliveryTracking: (deliveryId: string) => `delivery:${deliveryId}`,
  driverLocation: (driverId: string) => `driver-location:${driverId}`,
} as const;

/**
 * Well-known event names.
 */
export const EVENTS = {
  statusUpdate: 'status-update',
  locationUpdate: 'location-update',
} as const;
