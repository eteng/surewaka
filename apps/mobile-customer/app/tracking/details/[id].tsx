import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function TrackingDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-6">
        Delivery Details
      </Text>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Tracking ID
        </Text>
        <Text className="text-base text-gray-900 font-mono">{id}</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Route
        </Text>
        <Text className="text-base text-gray-900">Lagos → Abuja</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Cost
        </Text>
        <Text className="text-base text-gray-900">₦3,500</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Status
        </Text>
        <Text className="text-base text-primary font-semibold">In Transit</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-8">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Estimated Delivery
        </Text>
        <Text className="text-base text-gray-900">Tomorrow by 2:00 PM</Text>
      </View>
    </ScrollView>
  );
}
