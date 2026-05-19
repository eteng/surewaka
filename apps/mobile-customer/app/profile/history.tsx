import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

export default function HistoryScreen() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Delivery History</Text>
      </View>

      <View className="items-center justify-center py-16">
        <Text className="text-5xl mb-4">📦</Text>
        <Text className="text-lg font-semibold text-gray-900 mb-2">
          No delivery history
        </Text>
        <Text className="text-base text-gray-500 text-center">
          Your past deliveries will appear here
        </Text>
      </View>
    </ScrollView>
  );
}
