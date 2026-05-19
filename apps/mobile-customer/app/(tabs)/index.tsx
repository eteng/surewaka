import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@surewaka/mobile-shared';

export default function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="px-6 pt-6 pb-4 bg-primary">
        <Text className="text-white text-xl font-bold">
          Hi, {user?.user_metadata?.name ?? 'there'} 👋
        </Text>
        <Text className="text-white/80 text-base mt-1">
          Move goods across Nigeria
        </Text>
      </View>

      <View className="px-6 py-6">
        <Text className="text-lg font-semibold text-gray-900 mb-4">
          What do you want to do?
        </Text>

        <Pressable
          onPress={() => router.push('/booking')}
          className="bg-primary-light rounded-xl p-5 mb-3"
        >
          <View className="flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-primary items-center justify-center mr-4">
              <Text className="text-white text-xl">📦</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900">
                Send a Package
              </Text>
              <Text className="text-sm text-gray-500 mt-0.5">
                Book a delivery now
              </Text>
            </View>
          </View>
        </Pressable>

        <Pressable
          onPress={() => router.push('/booking')}
          className="bg-primary-light rounded-xl p-5 mb-6"
        >
          <View className="flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-primary items-center justify-center mr-4">
              <Text className="text-white text-xl">📅</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900">
                Schedule Delivery
              </Text>
              <Text className="text-sm text-gray-500 mt-0.5">
                Plan for later
              </Text>
            </View>
          </View>
        </Pressable>

        <Text className="text-base font-semibold text-gray-900 mb-3">
          Recent Addresses
        </Text>

        <View className="bg-gray-50 rounded-xl p-4 mb-3">
          <View className="flex-row items-center">
            <Text className="text-lg mr-3">🏠</Text>
            <View>
              <Text className="text-sm font-medium text-gray-900">Home</Text>
              <Text className="text-xs text-gray-500">Add your home address</Text>
            </View>
          </View>
        </View>

        <View className="bg-gray-50 rounded-xl p-4">
          <View className="flex-row items-center">
            <Text className="text-lg mr-3">🏢</Text>
            <View>
              <Text className="text-sm font-medium text-gray-900">Office</Text>
              <Text className="text-xs text-gray-500">Add your office address</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
