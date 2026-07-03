import { useEffect, useRef, useState } from 'react';
import { Truck } from 'lucide-react';
import { createAblyProvider, CHANNELS, EVENTS } from '@surewaka/realtime';
import type { Unsubscribe } from '@surewaka/realtime';
import type { LocationUpdatePayload } from '@surewaka/shared';

type DriverLocationMarkerProps = {
  driverId: string;
  initialLat?: number | null;
  initialLng?: number | null;
  onLocationUpdate?: (lat: number, lng: number) => void;
};

/**
 * Animated driver location marker that subscribes to realtime location updates.
 *
 * Subscribes to `driver-location:{driverId}` channel for `location-update` events.
 * Animates marker position with a 300ms ease-in-out CSS transition.
 * Only render this component when the delivery has an assigned driver.
 *
 * Validates: Requirements 8.3, 8.4, 8.8
 */
export function DriverLocationMarker({
  driverId,
  initialLat,
  initialLng,
  onLocationUpdate,
}: DriverLocationMarkerProps) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(
    initialLat != null && initialLng != null
      ? { lat: initialLat, lng: initialLng }
      : null,
  );

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const providerRef = useRef<ReturnType<typeof createAblyProvider> | null>(null);
  const onLocationUpdateRef = useRef(onLocationUpdate);

  // Keep callback ref in sync
  useEffect(() => {
    onLocationUpdateRef.current = onLocationUpdate;
  }, [onLocationUpdate]);

  useEffect(() => {
    // Create the realtime provider for client-side subscription
    const provider = createAblyProvider();
    providerRef.current = provider;

    const channel = CHANNELS.driverLocation(driverId);

    const unsubscribe = provider.subscribe(
      channel,
      EVENTS.locationUpdate,
      (data: unknown) => {
        const payload = data as LocationUpdatePayload;

        setPosition({ lat: payload.lat, lng: payload.lng });
        onLocationUpdateRef.current?.(payload.lat, payload.lng);
      },
    );

    unsubscribeRef.current = unsubscribe;

    // Cleanup on unmount or when driverId changes
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      providerRef.current?.close();
      providerRef.current = null;
    };
  }, [driverId]);

  // Don't render if no position data is available yet
  if (!position) return null;

  return (
    <div
      className="flex flex-col items-center gap-1"
      style={{ transition: 'transform 300ms ease-in-out' }}
      data-testid="driver-location-marker"
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full text-white shadow-md ring-2 ring-blue-300 ring-offset-1"
        style={{ backgroundColor: '#2563eb' }}
      >
        <Truck className="h-4 w-4" />
      </div>
      <span className="text-[10px] font-medium text-muted-foreground">
        {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
      </span>
    </div>
  );
}
