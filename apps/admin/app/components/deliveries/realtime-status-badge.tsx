import { useEffect, useRef, useState } from 'react';
import type { DeliveryStatus, StatusUpdatePayload } from '@surewaka/shared';
import { createAblyProvider, CHANNELS, EVENTS } from '@surewaka/realtime';
import type { Unsubscribe } from '@surewaka/realtime';
import { cn } from '~/lib/utils';

type RealtimeStatusBadgeProps = {
  deliveryId: string;
  initialStatus: DeliveryStatus;
  onStatusChange?: (newStatus: DeliveryStatus) => void;
  onTerminalStatus?: () => void;
};

const TERMINAL_STATUSES: DeliveryStatus[] = ['delivered', 'cancelled', 'failed'];

/**
 * Maps each delivery status to its corresponding badge color classes.
 * Uses same colors as delivery-row.tsx for consistency.
 */
function getStatusBadgeClasses(status: DeliveryStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-700';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    case 'accepted':
      return 'bg-blue-100 text-blue-700';
    case 'en_route_pickup':
    case 'arrived_pickup':
    case 'picked_up':
      return 'bg-orange-100 text-orange-700';
    case 'en_route_dropoff':
    case 'arrived_dropoff':
      return 'bg-purple-100 text-purple-700';
    case 'delivered':
      return 'bg-green-100 text-green-700';
    case 'cancelled':
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'returned':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/** Formats status by replacing underscores with spaces and capitalizing first letter. */
function formatStatus(status: DeliveryStatus): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Realtime-updating status badge for a delivery.
 *
 * Subscribes to `delivery:{id}` channel for `status-update` events.
 * Updates displayed status immediately on receiving events.
 * On terminal status (delivered, cancelled, failed): unsubscribes and
 * notifies parent via onTerminalStatus callback.
 *
 * Validates: Requirements 8.2, 8.10
 */
export function RealtimeStatusBadge({
  deliveryId,
  initialStatus,
  onStatusChange,
  onTerminalStatus,
}: RealtimeStatusBadgeProps) {
  const [status, setStatus] = useState<DeliveryStatus>(initialStatus);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const providerRef = useRef<ReturnType<typeof createAblyProvider> | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onTerminalStatusRef = useRef(onTerminalStatus);

  // Keep callback refs current without triggering re-subscriptions
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onTerminalStatusRef.current = onTerminalStatus;
  }, [onTerminalStatus]);

  useEffect(() => {
    // Reset status when deliveryId or initialStatus changes
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    // Don't subscribe if already in a terminal state
    if (TERMINAL_STATUSES.includes(initialStatus)) {
      return;
    }

    // Create the realtime provider (client-side subscription)
    const provider = createAblyProvider();
    providerRef.current = provider;

    const channel = CHANNELS.deliveryTracking(deliveryId);

    const unsubscribe = provider.subscribe(
      channel,
      EVENTS.statusUpdate,
      (data: unknown) => {
        const payload = data as StatusUpdatePayload;

        if (payload.deliveryId !== deliveryId) return;

        setStatus(payload.newStatus);
        onStatusChangeRef.current?.(payload.newStatus);

        // On terminal status: unsubscribe and notify parent
        if (TERMINAL_STATUSES.includes(payload.newStatus)) {
          unsubscribeRef.current?.();
          unsubscribeRef.current = null;
          onTerminalStatusRef.current?.();
        }
      },
    );

    unsubscribeRef.current = unsubscribe;

    // Cleanup on unmount or when deliveryId changes
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      providerRef.current?.close();
      providerRef.current = null;
    };
  }, [deliveryId, initialStatus]);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        'transition-colors duration-200',
        getStatusBadgeClasses(status),
      )}
    >
      {formatStatus(status)}
    </span>
  );
}
