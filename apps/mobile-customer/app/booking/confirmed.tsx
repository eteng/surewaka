import { View, Text, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useBookingStore } from '@surewaka/mobile-shared';

export default function ConfirmedScreen() {
  const router = useRouter();
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const reset = useBookingStore((s) => s.reset);

  const handleTrack = () => {
    router.push(`/tracking/${deliveryId}`);
  };

  const handleDone = () => {
    reset();
    router.replace('/(tabs)');
  };

  return (
    <View className="flex-1 bg-white items-center justify-center px-8">
      <View className="w-24 h-24 rounded-full bg-primary-light items-center justify-center mb-6">
        <Text className="text-4xl">✓</Text>
      </View>

      <Text className="text-2xl font-bold text-gray-900 text-center mb-3">
        Booking Confirmed!
      </Text>

      <Text className="text-base text-gray-500 text-center mb-2 leading-6">
        Your delivery has been booked successfully. You can track it in real time.
      </Text>

      {deliveryId && (
        <Text className="text-sm text-gray-400 text-center mb-8 font-mono">
          ID: {deliveryId}
        </Text>
      )}

      <Pressable
        onPress={handleTrack}
        className="bg-primary py-4 px-12 rounded-xl mb-3 w-full"
      >
        <Text className="text-white text-lg font-semibold text-center">
          Track Package
        </Text>
      </Pressable>

      <Pressable
        onPress={handleDone}
        className="py-4 px-12 w-full"
      >
        <Text className="text-gray-500 text-base text-center">
          Back to Home
        </Text>
      </Pressable>
    </View>
  );
}
