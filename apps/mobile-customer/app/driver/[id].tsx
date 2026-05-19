import { View, Text, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function DriverScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View className="flex-1 bg-white px-6 pt-6">
      <View className="items-center mb-8">
        <View className="w-24 h-24 rounded-full bg-primary-light items-center justify-center mb-4">
          <Text className="text-4xl">🚗</Text>
        </View>
        <Text className="text-2xl font-bold text-gray-900">Driver Name</Text>
        <Text className="text-base text-gray-500 mt-1">⭐ 4.8 · 152 deliveries</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Vehicle
        </Text>
        <Text className="text-base text-gray-900">Toyota Camry</Text>
        <Text className="text-sm text-gray-500">License: ABC 123</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-8">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Status
        </Text>
        <Text className="text-base text-primary font-semibold">On the way</Text>
      </View>

      <View className="flex-row gap-3">
        <Pressable className="flex-1 bg-primary py-4 rounded-xl items-center">
          <Text className="text-white text-base font-semibold">📞 Call</Text>
        </Pressable>
        <Pressable className="flex-1 bg-primary-light py-4 rounded-xl items-center">
          <Text className="text-primary text-base font-semibold">💬 Chat</Text>
        </Pressable>
      </View>
    </View>
  );
}
