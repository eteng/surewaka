import { useAuth } from '@clerk/expo';
import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore, createAuthClient } from '@surewaka/mobile-shared';
import type { DeliveryStatus } from '@surewaka/shared';

type Delivery = {
  id: string;
  status: DeliveryStatus;
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  priceKobo: number | null;
  createdAt: string;
};

// Mirrors the full delivery_status enum (packages/db/src/schema/enums.ts) — the
// previous pending/matched/picked_up/in_transit/delivered/cancelled set only
// covered 4 of 14 real statuses, so most in-progress deliveries rendered an
// uncolored badge with raw snake_case text. Same bug already fixed once in
// tracking/[id].tsx; label wording kept in sync with it where they overlap.
const STATUS_LABELS: Record<DeliveryStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  pending_routing: 'Finding Route',
  routing_failed: 'Routing Failed',
  accepted: 'Driver Assigned',
  en_route_pickup: 'Heading to Pickup',
  arrived_pickup: 'Arrived at Pickup',
  picked_up: 'Picked Up',
  en_route_dropoff: 'Heading to Drop-off',
  arrived_dropoff: 'Arrived at Drop-off',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Failed',
  returned: 'Returned',
};

const statusColors: Record<DeliveryStatus, string> = {
  draft: 'bg-gray-100 text-gray-500',
  pending: 'bg-yellow-100 text-yellow-700',
  pending_routing: 'bg-yellow-100 text-yellow-700',
  routing_failed: 'bg-red-100 text-red-700',
  accepted: 'bg-blue-100 text-blue-700',
  en_route_pickup: 'bg-blue-100 text-blue-700',
  arrived_pickup: 'bg-purple-100 text-purple-700',
  picked_up: 'bg-purple-100 text-purple-700',
  en_route_dropoff: 'bg-primary-light text-primary',
  arrived_dropoff: 'bg-primary-light text-primary',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  returned: 'bg-red-100 text-red-700',
};

export default function DeliveriesScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stabilize getToken — @clerk/expo v4 returns a new reference each render
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const fetchDeliveries = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return;

    const client = createAuthClient(token);
    const { data } = await client.get<{ deliveries: Delivery[]; total: number }>('/api/v1/deliveries');

    if (data?.deliveries) {
      setDeliveries(data.deliveries);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDeliveries();
  };

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  if (deliveries.length === 0) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-5xl mb-4">📦</Text>
        <Text className="text-xl font-semibold text-gray-900 mb-2">
          No deliveries yet
        </Text>
        <Text className="text-base text-gray-500 text-center mb-8">
          Your booked deliveries will appear here
        </Text>
        <Pressable
          onPress={() => router.push('/booking')}
          className="bg-primary py-3 px-8 rounded-xl"
        >
          <Text className="text-white text-base font-semibold">Book a Delivery</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
      }
    >
      <View className="px-6 py-4">
        {deliveries.map((delivery) => (
          <Pressable
            key={delivery.id}
            onPress={() => router.push(`/tracking/${delivery.id}`)}
            className="bg-gray-50 rounded-xl p-4 mb-3"
          >
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs text-gray-400 font-mono">
                #{delivery.id.slice(0, 8)}
              </Text>
              <View className={`px-2 py-1 rounded-full ${statusColors[delivery.status]}`}>
                <Text className="text-xs font-medium">
                  {STATUS_LABELS[delivery.status]}
                </Text>
              </View>
            </View>

            <View className="flex-row items-start mb-2">
              <View className="w-2 h-2 rounded-full bg-primary mt-1.5 mr-2" />
              <View className="flex-1">
                <Text className="text-sm text-gray-900" numberOfLines={1}>
                  {delivery.pickupAddress}
                </Text>
              </View>
            </View>

            <View className="flex-row items-start">
              <View className="w-2 h-2 rounded-full bg-gray-400 mt-1.5 mr-2" />
              <View className="flex-1">
                <Text className="text-sm text-gray-900" numberOfLines={1}>
                  {delivery.dropoffAddress}
                </Text>
              </View>
            </View>

            <View className="flex-row justify-between items-center mt-3 pt-3 border-t border-gray-200">
              <Text className="text-xs text-gray-400">
                {new Date(delivery.createdAt).toLocaleDateString()}
              </Text>
              {delivery.priceKobo ? (
                <Text className="text-sm font-bold text-primary">
                  ₦{(delivery.priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                </Text>
              ) : (
                <Text className="text-xs text-gray-400 italic">Calculating price…</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
