import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore, createAuthClient } from '@surewaka/mobile-shared';

type Delivery = {
  id: string;
  status: 'pending' | 'matched' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  price: number | null;
  createdAt: string;
};

const statusColors: Record<Delivery['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  matched: 'bg-blue-100 text-blue-700',
  picked_up: 'bg-purple-100 text-purple-700',
  in_transit: 'bg-primary-light text-primary',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function DeliveriesScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDeliveries = useCallback(async () => {
    if (!session?.access_token) return;

    const client = createAuthClient(session.access_token);
    const { data } = await client.get<Delivery[]>('/api/v1/deliveries');

    if (data) {
      setDeliveries(data);
    }
    setLoading(false);
    setRefreshing(false);
  }, [session?.access_token]);

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
                <Text className="text-xs font-medium capitalize">
                  {delivery.status.replace('_', ' ')}
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

            {delivery.price && (
              <View className="flex-row justify-between items-center mt-3 pt-3 border-t border-gray-200">
                <Text className="text-xs text-gray-400">
                  {new Date(delivery.createdAt).toLocaleDateString()}
                </Text>
                <Text className="text-sm font-bold text-primary">
                  ₦{delivery.price.toLocaleString()}
                </Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
