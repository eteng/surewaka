import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function ReceiptScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-6">
        Receipt
      </Text>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm text-gray-500">Delivery ID</Text>
        <Text className="text-base font-mono text-gray-900">{id}</Text>
      </View>

      <View className="border-b border-gray-100 py-3">
        <View className="flex-row justify-between">
          <Text className="text-gray-500">Base fare</Text>
          <Text className="text-gray-900">₦2,500</Text>
        </View>
      </View>
      <View className="border-b border-gray-100 py-3">
        <View className="flex-row justify-between">
          <Text className="text-gray-500">Service fee</Text>
          <Text className="text-gray-900">₦500</Text>
        </View>
      </View>
      <View className="border-b border-gray-100 py-3">
        <View className="flex-row justify-between">
          <Text className="text-gray-500">Platform fee</Text>
          <Text className="text-gray-900">₦500</Text>
        </View>
      </View>
      <View className="py-4">
        <View className="flex-row justify-between">
          <Text className="text-lg font-bold text-gray-900">Total</Text>
          <Text className="text-lg font-bold text-primary">₦3,500</Text>
        </View>
      </View>

      <View className="bg-primary-light rounded-xl p-4 mb-8">
        <Text className="text-sm text-gray-700 text-center">
          Paid via Bank Transfer
        </Text>
      </View>

      <Pressable
        onPress={() => router.back()}
        className="bg-primary py-4 rounded-xl items-center mb-8"
      >
        <Text className="text-white text-lg font-semibold">Done</Text>
      </Pressable>
    </ScrollView>
  );
}
