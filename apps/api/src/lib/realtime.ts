/**
 * Supabase Realtime — delivery tracking.
 *
 * Clients subscribe to delivery status changes via Supabase Realtime.
 * The API updates the delivery row in Postgres, and Supabase broadcasts
 * the change to all subscribed clients automatically.
 *
 * Client-side usage (in web/mobile apps):
 *
 * ```ts
 * const supabase = createBrowserClient();
 *
 * const channel = supabase
 *   .channel('delivery-tracking')
 *   .on('postgres_changes', {
 *     event: 'UPDATE',
 *     schema: 'public',
 *     table: 'deliveries',
 *     filter: `id=eq.${deliveryId}`,
 *   }, (payload) => {
 *     // Update UI with new delivery status/location
 *     console.log('Delivery updated:', payload.new);
 *   })
 *   .subscribe();
 * ```
 *
 * No server-side code needed for realtime — Supabase handles the
 * WebSocket connections and broadcasts DB changes automatically.
 *
 * For driver location updates (high frequency), consider using
 * Supabase Realtime Broadcast (no DB write) instead:
 *
 * ```ts
 * // Driver sends location
 * channel.send({
 *   type: 'broadcast',
 *   event: 'location',
 *   payload: { lat: 6.5244, lng: 3.3792 },
 * });
 * ```
 */

export const REALTIME_CHANNELS = {
  deliveryTracking: (deliveryId: string) => `delivery:${deliveryId}`,
  driverLocation: (driverId: string) => `driver-location:${driverId}`,
} as const;
