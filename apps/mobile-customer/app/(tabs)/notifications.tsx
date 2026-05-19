import { View, Text } from 'react-native';

export default function NotificationsScreen() {
  return (
    <View className="flex-1 bg-white items-center justify-center px-6">
      <Text className="text-5xl mb-4">🔔</Text>
      <Text className="text-xl font-semibold text-gray-900 mb-2">
        No notifications
      </Text>
      <Text className="text-base text-gray-500 text-center">
        Delivery updates and alerts will appear here
      </Text>
    </View>
  );
}
