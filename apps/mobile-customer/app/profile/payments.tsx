import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

export default function PaymentsScreen() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Payment Methods</Text>
      </View>

      <View className="bg-primary rounded-xl p-4 mb-4">
        <Text className="text-white text-sm font-medium mb-1">Wallet Balance</Text>
        <Text className="text-white text-3xl font-bold">₦0.00</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-6">
        <Text className="text-base text-gray-500 text-center">
          No payment methods saved yet
        </Text>
      </View>

      <Pressable className="border-2 border-dashed border-gray-300 rounded-xl p-4 items-center">
        <Text className="text-primary text-base font-semibold">+ Add Payment Method</Text>
      </Pressable>
    </ScrollView>
  );
}
