import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useBookingStore } from '@surewaka/mobile-shared';

const mockCarriers = [
  { id: '1', name: 'GIG Logistics', price: 3500, eta: '1-2 days', rating: 4.5 },
  { id: '2', name: 'DHL Express', price: 5200, eta: 'Same day', rating: 4.8 },
  { id: '3', name: 'SpeedForce', price: 2800, eta: '2-3 days', rating: 4.2 },
];

export default function CarriersScreen() {
  const router = useRouter();
  const setStep = useBookingStore((s) => s.setStep);
  const setSelectedCarrier = useBookingStore((s) => s.setSelectedCarrier);

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Choose a Service
      </Text>
      <Text className="text-base text-gray-500 mb-6">
        Compare prices and delivery times
      </Text>

      <Pressable
        onPress={() => {
          setSelectedCarrier('instant');
          setStep(4);
          router.push('/booking/review');
        }}
        className="bg-primary-light rounded-xl p-4 mb-4 border-2 border-primary"
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-bold text-primary">Instant Match</Text>
            <Text className="text-sm text-gray-500 mt-1">
              Get a driver in ~15 minutes
            </Text>
          </View>
          <Text className="text-xl font-bold text-primary">₦3,000</Text>
        </View>
      </Pressable>

      <Text className="text-base font-semibold text-gray-900 mb-3 mt-2">
        Registered Carriers
      </Text>

      {mockCarriers.map((carrier) => (
        <Pressable
          key={carrier.id}
          onPress={() => {
            setSelectedCarrier(carrier.id);
            setStep(4);
            router.push('/booking/review');
          }}
          className="bg-gray-50 rounded-xl p-4 mb-3"
        >
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-base font-semibold text-gray-900">
                {carrier.name}
              </Text>
              <Text className="text-sm text-gray-500 mt-0.5">
                ⭐ {carrier.rating} · {carrier.eta}
              </Text>
            </View>
            <Text className="text-lg font-bold text-gray-900">
              ₦{carrier.price.toLocaleString()}
            </Text>
          </View>
        </Pressable>
      ))}

      <View className="h-8" />
    </ScrollView>
  );
}
