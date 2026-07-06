import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useBookingStore, carriersApi } from '@surewaka/mobile-shared';
import type { Carrier } from '@surewaka/shared';

export default function CarriersScreen() {
  const router = useRouter();
  const setStep = useBookingStore((s) => s.setStep);
  const setSelectedCarrier = useBookingStore((s) => s.setSelectedCarrier);

  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadCarriers() {
    setLoading(true);
    setError(null);
    const res = await carriersApi.list();
    if (res.error || !res.data) {
      setError('Could not load carriers. Please try again.');
    } else {
      setCarriers(res.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCarriers();
  }, []);

  function selectCarrier(id: string) {
    setSelectedCarrier(id);
    setStep(4);
    router.push('/booking/review');
  }

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">Choose a Service</Text>
      <Text className="text-base text-gray-500 mb-6">Compare prices and delivery times</Text>

      <Pressable
        onPress={() => selectCarrier('instant')}
        className="bg-primary-light rounded-xl p-4 mb-4 border-2 border-primary"
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-bold text-primary">Instant Match</Text>
            <Text className="text-sm text-gray-500 mt-1">Get a driver in ~15 minutes</Text>
          </View>
          <Text className="text-xl font-bold text-primary">₦3,000</Text>
        </View>
      </Pressable>

      <Text className="text-base font-semibold text-gray-900 mb-3 mt-2">Registered Carriers</Text>

      {loading && (
        <View className="py-10 items-center">
          <ActivityIndicator size="large" color="#16a34a" />
        </View>
      )}

      {!loading && error && (
        <View className="py-8 items-center gap-3">
          <Text className="text-gray-500 text-sm text-center">{error}</Text>
          <Pressable onPress={loadCarriers} className="px-4 py-2 bg-primary rounded-lg">
            <Text className="text-white font-semibold text-sm">Retry</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && carriers.length === 0 && (
        <View className="py-8 items-center">
          <Text className="text-gray-400 text-sm">No carriers available at the moment.</Text>
        </View>
      )}

      {!loading &&
        !error &&
        carriers.map((carrier) => (
          <Pressable
            key={carrier.id}
            onPress={() => selectCarrier(carrier.id)}
            className="bg-gray-50 rounded-xl p-4 mb-3"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-4">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-gray-900">{carrier.name}</Text>
                  {carrier.isVerified && (
                    <Text className="text-xs text-green-600 font-medium">✓ Verified</Text>
                  )}
                </View>
                <Text className="text-sm text-gray-500 mt-0.5">
                  {carrier.rating != null ? `⭐ ${carrier.rating.toFixed(1)}` : 'No ratings yet'}
                  {carrier.deliveryCount != null && carrier.deliveryCount > 0
                    ? ` · ${carrier.deliveryCount.toLocaleString()} deliveries`
                    : ''}
                </Text>
              </View>
              {carrier.basePrice != null && (
                <Text className="text-lg font-bold text-gray-900 shrink-0">
                  From ₦{(carrier.basePrice / 100).toLocaleString()}
                </Text>
              )}
            </View>
          </Pressable>
        ))}

      <View className="h-8" />
    </ScrollView>
  );
}
