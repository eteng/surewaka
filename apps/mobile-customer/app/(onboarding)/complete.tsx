import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

export default function OnboardingCompleteScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-white items-center justify-center px-8">
      <View className="w-24 h-24 rounded-full bg-primary-light items-center justify-center mb-6">
        <Text className="text-4xl">✓</Text>
      </View>

      <Text className="text-2xl font-bold text-gray-900 text-center mb-3">
        You are all set!
      </Text>

      <Text className="text-base text-gray-500 text-center leading-6 mb-8">
        Start booking deliveries and track your packages in real time.
      </Text>

      <Pressable
        onPress={() => router.replace('/(tabs)')}
        className="bg-primary py-4 px-12 rounded-xl"
      >
        <Text className="text-white text-lg font-semibold">Start Shipping</Text>
      </Pressable>
    </View>
  );
}
