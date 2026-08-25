import { useAuth } from '@clerk/expo';
import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, AppState, type AppStateStatus } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { createAuthClient, useRealtimeChannel, EVENTS } from '@surewaka/mobile-shared';
import type { DeliveryStatus, StatusUpdatePayload } from '@surewaka/shared';

type Delivery = {
  id: string;
  customerId: string;
  driverId: string | null;
  carrierId: string | null;
  status: DeliveryStatus;
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  packageDescription: string;
  packageWeight: number;
  packageCategory: string;
  priceKobo: number | null;
  deliveryMode: string | null;
  cancellationDeadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Real backend delivery_status progression (Requirement 8.1) — the previous
// pending/matched/picked_up/in_transit/delivered/cancelled set didn't match
// any actual status the backend ever writes, so the stepper silently failed
// to highlight (indexOf returning -1) for nearly every real delivery.
const statusSteps: { label: string; value: DeliveryStatus }[] = [
  { label: 'Driver Assigned', value: 'accepted' },
  { label: 'Heading to Pickup', value: 'en_route_pickup' },
  { label: 'Arrived at Pickup', value: 'arrived_pickup' },
  { label: 'Picked Up', value: 'picked_up' },
  { label: 'Heading to Drop-off', value: 'en_route_dropoff' },
  { label: 'Arrived at Drop-off', value: 'arrived_dropoff' },
  { label: 'Delivered', value: 'delivered' },
];

const statusOrder: DeliveryStatus[] = statusSteps.map((s) => s.value);

const STATUS_LABELS: Partial<Record<DeliveryStatus, string>> = Object.fromEntries(
  statusSteps.map((s) => [s.value, s.label]),
);

// Terminal, non-progressing states — the stepper doesn't meaningfully apply
// to any of these, unlike the old code's cancelled-only handling.
const TERMINAL_FAILURE_STATUSES = new Set<DeliveryStatus>(['cancelled', 'failed', 'returned']);

// Resilience safety net (Requirement 6.4) — stays active even while the
// realtime subscription is connected, since a dropped connection on
// Nigerian mobile networks is common, not an edge case.
const FALLBACK_POLL_INTERVAL_MS = 60_000;

function isTerminal(status: DeliveryStatus): boolean {
  return status === 'delivered' || TERMINAL_FAILURE_STATUSES.has(status);
}

export default function TrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // getToken is read via a ref rather than a fetchDelivery dependency —
  // if its identity isn't stable across renders (observed on-device: a
  // burst of ~7 identical fetches within one second, right before Clerk's
  // dev-mode rate limit started rejecting tokens as "Invalid token"),
  // depending on it directly would re-create fetchDelivery every render
  // and re-fire the mount effect below in a tight loop.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const fetchDelivery = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token || !id) return;

    const client = createAuthClient(token);
    const { data, error: apiError } = await client.get<Delivery>(`/api/v1/deliveries/${id}`);

    if (apiError) {
      setError(apiError.message);
    } else if (data) {
      setDelivery(data);
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  // Initial fetch (Requirement 6.2) — first paint before any subscription exists
  useEffect(() => {
    fetchDelivery();
  }, [fetchDelivery]);

  // Realtime (Requirement 6.1): update local state directly from the pushed
  // payload rather than re-fetching on every event — legStatus is the live
  // per-leg progress this stepper tracks; newStatus is the delivery-level
  // status, used when a leg-level value isn't present.
  const handleStatusUpdate = useCallback((data: unknown) => {
    const payload = data as StatusUpdatePayload;
    setDelivery((prev) => {
      if (!prev || prev.id !== payload.deliveryId) return prev;
      return { ...prev, status: payload.legStatus ?? payload.newStatus };
    });
  }, []);

  useRealtimeChannel({
    // Skip (or tear down) the subscription once the delivery is terminal —
    // nothing further will ever be published for it. Otherwise a
    // completed delivery's tracking screen, if left mounted in the nav
    // stack (expo-router's default Stack behavior — screens aren't
    // unmounted just by navigating past them), keeps its Ably connection
    // alive and keeps re-authenticating in the background indefinitely.
    deliveryId: delivery && isTerminal(delivery.status) ? null : id,
    events: { [EVENTS.statusUpdate]: handleStatusUpdate },
    // Requirement 2.4 / 6.1 — a reconnect may have missed an event while down
    onReconnect: fetchDelivery,
  });

  // Resilience fallback poll (Requirement 6.4) — active alongside the
  // realtime subscription, not instead of it. Stops once the delivery
  // reaches a terminal state.
  useEffect(() => {
    if (!delivery || isTerminal(delivery.status)) return;

    const interval = setInterval(fetchDelivery, FALLBACK_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [delivery?.status, fetchDelivery]);

  // Re-sync on app foreground (Requirement 6.5) — events may have been
  // missed entirely while backgrounded.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        fetchDelivery();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [fetchDelivery]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDelivery();
  };

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-500 mt-4">Loading delivery details...</Text>
      </View>
    );
  }

  if (error || !delivery) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-5xl mb-4">⚠️</Text>
        <Text className="text-xl font-semibold text-gray-900 mb-2">
          {error ?? 'Delivery not found'}
        </Text>
        <Text className="text-base text-gray-500 text-center">
          {error ?? 'This delivery does not exist or you do not have access.'}
        </Text>
      </View>
    );
  }

  const failed = TERMINAL_FAILURE_STATUSES.has(delivery.status);
  const currentStatusIndex = statusOrder.indexOf(delivery.status);
  const statusLabel = STATUS_LABELS[delivery.status] ?? delivery.status.replace(/_/g, ' ');

  return (
    <ScrollView
      className="flex-1 bg-white"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
      }
    >
      <View className="h-48 bg-primary-light items-center justify-center">
        <Text className="text-gray-500 text-base">Map view coming soon</Text>
      </View>

      <View className="px-6 py-4">
        <Text className="text-lg font-bold text-gray-900 mb-1">
          Delivery #{delivery.id.slice(0, 8)}
        </Text>
        <Text
          className={`text-sm font-semibold mb-6 capitalize ${failed ? 'text-error' : 'text-primary'}`}
        >
          {statusLabel}
        </Text>

        <View className="bg-gray-50 rounded-xl p-4 mb-4">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">Route</Text>
          <View className="flex-row items-start">
            <View className="w-3 h-3 rounded-full bg-primary mt-1 mr-3" />
            <View className="flex-1">
              <Text className="text-sm text-gray-900">{delivery.pickupAddress}</Text>
              <Text className="text-xs text-gray-500">{delivery.pickupCity}</Text>
            </View>
          </View>
          <View className="w-0.5 h-6 bg-gray-300 ml-1.5 my-1" />
          <View className="flex-row items-start">
            <View className="w-3 h-3 rounded-full bg-gray-400 mt-1 mr-3" />
            <View className="flex-1">
              <Text className="text-sm text-gray-900">{delivery.dropoffAddress}</Text>
              <Text className="text-xs text-gray-500">{delivery.dropoffCity}</Text>
            </View>
          </View>
        </View>

        {failed ? (
          <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <Text className="text-sm font-semibold text-error uppercase mb-1">{statusLabel}</Text>
            <Text className="text-sm text-gray-600">
              {delivery.status === 'cancelled'
                ? 'This delivery was cancelled.'
                : delivery.status === 'returned'
                  ? 'This delivery was returned to the sender.'
                  : 'This delivery could not be completed.'}
            </Text>
          </View>
        ) : (
          <View className="mb-6">
            {statusSteps.map((step) => {
              const stepIndex = statusOrder.indexOf(step.value);
              const isDone = stepIndex <= currentStatusIndex;

              return (
                <View key={step.label} className="flex-row items-center mb-4">
                  <View
                    className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
                      isDone ? 'bg-primary' : 'bg-gray-200'
                    }`}
                  >
                    <Text className="text-white text-xs">{isDone ? '✓' : stepIndex + 1}</Text>
                  </View>
                  <Text
                    className={`text-base ${isDone ? 'text-gray-900 font-medium' : 'text-gray-400'}`}
                  >
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {delivery.priceKobo ? (
          <View className="bg-gray-50 rounded-xl p-4 mb-4">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-1">Price</Text>
            <Text className="text-xl font-bold text-primary">
              ₦{(delivery.priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        ) : null}

        {delivery.cancellationDeadlineAt &&
          delivery.status === 'pending' &&
          delivery.deliveryMode === 'surewaka_way' && (
          <View className="bg-amber-50 rounded-xl p-4 mb-4 border border-amber-200">
            <Text className="text-sm font-semibold text-amber-700 uppercase mb-1">
              Free cancellation until
            </Text>
            <Text className="text-base font-bold text-amber-900">
              {new Date(delivery.cancellationDeadlineAt).toLocaleString('en-NG', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </Text>
            <Text className="text-xs text-amber-600 mt-1">
              {new Date(delivery.cancellationDeadlineAt) > new Date()
                ? 'Cancel for free before this time. After this, a cancellation fee applies.'
                : 'Free cancellation window has passed. Cancellation fee applies.'}
            </Text>
          </View>
        )}

        {delivery.driverId && (
          <View className="bg-gray-50 rounded-xl p-4">
            <Text className="text-sm font-semibold text-gray-700 mb-2">Driver Info</Text>
            <View className="flex-row items-center">
              <View className="w-10 h-10 rounded-full bg-primary-light items-center justify-center mr-3">
                <Text className="text-lg">🚗</Text>
              </View>
              <View>
                <Text className="text-base font-medium text-gray-900">Driver Assigned</Text>
                <Text className="text-sm text-gray-500">Details coming soon</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
