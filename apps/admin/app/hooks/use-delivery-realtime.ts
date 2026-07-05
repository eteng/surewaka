import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNELS, EVENTS, type Unsubscribe } from '@surewaka/realtime';
import type { DeliveryStatus, LocationUpdatePayload, StatusUpdatePayload } from '@surewaka/shared';
import { createAblyProvider } from '@surewaka/realtime';

const TERMINAL_STATUSES: DeliveryStatus[] = ['delivered', 'cancelled', 'failed'];
const RECONNECT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 30;

type UseDeliveryRealtimeOptions = {
  deliveryId: string | null | undefined;
  driverId: string | null | undefined;
  onStatusUpdate: (payload: StatusUpdatePayload) => void;
  onLocationUpdate: (payload: LocationUpdatePayload) => void;
  refetchDelivery: () => Promise<void> | void;
};

type UseDeliveryRealtimeReturn = {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectExhausted: boolean;
  manualRetry: () => void;
};

/**
 * Manages realtime subscriptions for a delivery detail view.
 *
 * Subscribes to the delivery channel and optionally the driver location channel.
 * Handles disconnection with auto-reconnect (5s interval, max 30 attempts),
 * re-fetches delivery state on reconnection, and unsubscribes on terminal status
 * or navigation away.
 */
export function useDeliveryRealtime({
  deliveryId,
  driverId,
  onStatusUpdate,
  onLocationUpdate,
  refetchDelivery,
}: UseDeliveryRealtimeOptions): UseDeliveryRealtimeReturn {
  const [isConnected, setIsConnected] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectExhausted, setReconnectExhausted] = useState(false);

  // Store unsubscribe functions for cleanup
  const unsubscribeRefs = useRef<Unsubscribe[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const providerRef = useRef<ReturnType<typeof createAblyProvider> | null>(null);

  // Use refs for callbacks to avoid re-subscribing on every render
  const onStatusUpdateRef = useRef(onStatusUpdate);
  const onLocationUpdateRef = useRef(onLocationUpdate);
  const refetchDeliveryRef = useRef(refetchDelivery);

  // Keep refs in sync
  useEffect(() => {
    onStatusUpdateRef.current = onStatusUpdate;
  }, [onStatusUpdate]);

  useEffect(() => {
    onLocationUpdateRef.current = onLocationUpdate;
  }, [onLocationUpdate]);

  useEffect(() => {
    refetchDeliveryRef.current = refetchDelivery;
  }, [refetchDelivery]);

  // Cleanup all subscriptions
  const cleanupSubscriptions = useCallback(() => {
    for (const unsub of unsubscribeRefs.current) {
      try {
        unsub();
      } catch {
        // Ignore errors during cleanup
      }
    }
    unsubscribeRefs.current = [];
  }, []);

  // Stop reconnection timer
  const stopReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Subscribe to channels
  const subscribe = useCallback(() => {
    if (!deliveryId) return;

    // Clean up any existing subscriptions first
    cleanupSubscriptions();

    try {
      if (!providerRef.current) {
        providerRef.current = createAblyProvider();
      }

      const provider = providerRef.current;

      // Subscribe to delivery channel
      const deliveryChannel = CHANNELS.deliveryTracking(deliveryId);
      const unsubDelivery = provider.subscribe(
        deliveryChannel,
        EVENTS.statusUpdate,
        (data: unknown) => {
          const payload = data as StatusUpdatePayload;
          onStatusUpdateRef.current(payload);

          // On terminal status, unsubscribe all
          if (TERMINAL_STATUSES.includes(payload.newStatus)) {
            cleanupSubscriptions();
            stopReconnectTimer();
          }
        },
      );
      unsubscribeRefs.current.push(unsubDelivery);

      // Subscribe to driver location channel if driver assigned
      if (driverId) {
        const driverChannel = CHANNELS.driverLocation(driverId);
        const unsubDriver = provider.subscribe(
          driverChannel,
          EVENTS.locationUpdate,
          (data: unknown) => {
            const payload = data as LocationUpdatePayload;
            onLocationUpdateRef.current(payload);
          },
        );
        unsubscribeRefs.current.push(unsubDriver);
      }

      setIsConnected(true);
      setIsReconnecting(false);
      setReconnectExhausted(false);
      stopReconnectTimer();
      reconnectAttemptsRef.current = 0;
    } catch {
      setIsConnected(false);
      startReconnection();
    }
  }, [deliveryId, driverId, cleanupSubscriptions, stopReconnectTimer]);

  // Reconnection logic
  const startReconnection = useCallback(() => {
    if (reconnectTimerRef.current) return; // Already reconnecting

    setIsConnected(false);
    setIsReconnecting(true);
    setReconnectExhausted(false);
    reconnectAttemptsRef.current = 0;

    reconnectTimerRef.current = setInterval(async () => {
      reconnectAttemptsRef.current += 1;

      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        // Exhausted all attempts
        stopReconnectTimer();
        setIsReconnecting(false);
        setReconnectExhausted(true);
        return;
      }

      try {
        // Attempt to re-subscribe
        cleanupSubscriptions();

        // Close and recreate the provider
        if (providerRef.current) {
          providerRef.current.close();
          providerRef.current = null;
        }

        providerRef.current = createAblyProvider();

        if (!deliveryId) return;

        const provider = providerRef.current;

        // Re-subscribe to delivery channel
        const deliveryChannel = CHANNELS.deliveryTracking(deliveryId);
        const unsubDelivery = provider.subscribe(
          deliveryChannel,
          EVENTS.statusUpdate,
          (data: unknown) => {
            const payload = data as StatusUpdatePayload;
            onStatusUpdateRef.current(payload);

            if (TERMINAL_STATUSES.includes(payload.newStatus)) {
              cleanupSubscriptions();
              stopReconnectTimer();
            }
          },
        );
        unsubscribeRefs.current.push(unsubDelivery);

        // Re-subscribe to driver location channel if driver assigned
        if (driverId) {
          const driverChannel = CHANNELS.driverLocation(driverId);
          const unsubDriver = provider.subscribe(
            driverChannel,
            EVENTS.locationUpdate,
            (data: unknown) => {
              const payload = data as LocationUpdatePayload;
              onLocationUpdateRef.current(payload);
            },
          );
          unsubscribeRefs.current.push(unsubDriver);
        }

        // Re-fetch delivery state from API
        try {
          await refetchDeliveryRef.current();
        } catch {
          // Re-fetch failed: retain last known data, error shown by caller
          // We still consider the reconnection successful for the realtime channels
        }

        // Successfully reconnected
        stopReconnectTimer();
        setIsConnected(true);
        setIsReconnecting(false);
        setReconnectExhausted(false);
        reconnectAttemptsRef.current = 0;
      } catch {
        // Attempt failed, continue with next interval
      }
    }, RECONNECT_INTERVAL_MS);
  }, [deliveryId, driverId, cleanupSubscriptions, stopReconnectTimer]);

  // Manual retry (used when reconnection is exhausted or re-fetch fails)
  const manualRetry = useCallback(() => {
    setReconnectExhausted(false);
    setIsReconnecting(true);
    reconnectAttemptsRef.current = 0;
    stopReconnectTimer();

    // Start a fresh reconnection cycle
    startReconnection();
  }, [startReconnection, stopReconnectTimer]);

  // Main effect: subscribe on mount, cleanup on unmount/navigation
  useEffect(() => {
    if (!deliveryId) return;

    subscribe();

    return () => {
      cleanupSubscriptions();
      stopReconnectTimer();

      if (providerRef.current) {
        providerRef.current.close();
        providerRef.current = null;
      }
    };
  }, [deliveryId, driverId, subscribe, cleanupSubscriptions, stopReconnectTimer]);

  return {
    isConnected,
    isReconnecting,
    reconnectExhausted,
    manualRetry,
  };
}
