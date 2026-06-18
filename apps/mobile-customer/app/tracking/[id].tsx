import { useAuth } from '@clerk/expo';
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore, createAuthClient } from '@surewaka/mobile-shared';

type Delivery = {
  id: string;
  customerId: string;
  driverId: string | null;
  carrierId: string | null;
  status: 'pending' | 'matched' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  packageDescription: string;
  packageWeight: number;
  packageCategory: string;
  price: number | null;
  createdAt: string;
  updatedAt: string;
};

const statusSteps: { label: string; value: Delivery['status'] }[] = [
  { label: 'Booked', value: 'pending' },
  { label: 'Matched', value: 'matched' },
  { label: 'Picked Up', value: 'picked_up' },
  { label: 'In Transit', value: 'in_transit' },
  { label: 'Delivered', value: 'delivered' },
];

const statusOrder: Delivery['status'][] = ['pending', 'matched', 'picked_up', 'in_transit', 'delivered', 'cancelled'];

export default function TrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDelivery = useCallback(async () => {
    const token = await getToken();
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
  }, [id, getToken]);

  useEffect(() => {
    fetchDelivery();
  }, [fetchDelivery]);

  useEffect(() => {
    if (!delivery || delivery.status === 'delivered' || delivery.status === 'cancelled') return;

    const interval = setInterval(fetchDelivery, 30000);
    return () => clearInterval(interval);
  }, [delivery?.status, fetchDelivery]);

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

  const currentStatusIndex = statusOrder.indexOf(delivery.status);

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
        <Text className="text-sm text-primary font-semibold mb-6 capitalize">
          {delivery.status.replace('_', ' ')}
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

        <View className="mb-6">
          {statusSteps.map((step) => {
            const stepIndex = statusOrder.indexOf(step.value);
            const isDone = stepIndex <= currentStatusIndex && delivery.status !== 'cancelled';
            const isCancelled = delivery.status === 'cancelled' && step.value === 'pending';

            return (
              <View key={step.label} className="flex-row items-center mb-4">
                <View
                  className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
                    isCancelled
                      ? 'bg-error'
                      : isDone
                        ? 'bg-primary'
                        : 'bg-gray-200'
                  }`}
                >
                  <Text className="text-white text-xs">
                    {isCancelled ? '✕' : isDone ? '✓' : stepIndex + 1}
                  </Text>
                </View>
                <Text
                  className={`text-base ${
                    isDone ? 'text-gray-900 font-medium' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>

        {delivery.price && (
          <View className="bg-gray-50 rounded-xl p-4 mb-4">
            <Text className="text-sm font-semibold text-gray-500 uppercase mb-1">Price</Text>
            <Text className="text-xl font-bold text-primary">₦{delivery.price.toLocaleString()}</Text>
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
