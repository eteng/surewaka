import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

export default function AddressesScreen() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Saved Addresses</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-3">
        <View className="flex-row items-center">
          <Text className="text-2xl mr-3">🏠</Text>
          <View className="flex-1">
            <Text className="text-base font-medium text-gray-900">Home</Text>
            <Text className="text-sm text-gray-500">No address saved yet</Text>
          </View>
          <Pressable>
            <Text className="text-primary text-sm font-medium">Edit</Text>
          </Pressable>
        </View>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-6">
        <View className="flex-row items-center">
          <Text className="text-2xl mr-3">🏢</Text>
          <View className="flex-1">
            <Text className="text-base font-medium text-gray-900">Office</Text>
            <Text className="text-sm text-gray-500">No address saved yet</Text>
          </View>
          <Pressable>
            <Text className="text-primary text-sm font-medium">Edit</Text>
          </Pressable>
        </View>
      </View>

      <Pressable className="border-2 border-dashed border-gray-300 rounded-xl p-4 items-center">
        <Text className="text-primary text-base font-semibold">+ Add New Address</Text>
      </Pressable>
    </ScrollView>
  );
}
