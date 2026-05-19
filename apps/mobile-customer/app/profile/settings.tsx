import { View, Text, Pressable, Switch, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@surewaka/mobile-shared';

export default function SettingsScreen() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Settings</Text>
      </View>

      <View className="mb-6">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">
          Appearance
        </Text>
        <View className="flex-row items-center justify-between bg-gray-50 rounded-xl p-4">
          <Text className="text-base text-gray-900">Dark Mode</Text>
          <Switch
            value={theme.isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: '#d1d5db', true: '#16a34a' }}
          />
        </View>
      </View>

      <View className="mb-6">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">
          Notifications
        </Text>
        <View className="bg-gray-50 rounded-xl">
          <View className="flex-row items-center justify-between p-4 border-b border-gray-100">
            <Text className="text-base text-gray-900">Push Notifications</Text>
            <Switch value={true} trackColor={{ false: '#d1d5db', true: '#16a34a' }} />
          </View>
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-base text-gray-900">SMS Notifications</Text>
            <Switch value={false} trackColor={{ false: '#d1d5db', true: '#16a34a' }} />
          </View>
        </View>
      </View>

      <View className="mb-8">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">
          About
        </Text>
        <View className="bg-gray-50 rounded-xl p-4">
          <View className="flex-row justify-between">
            <Text className="text-base text-gray-500">Version</Text>
            <Text className="text-base text-gray-900">0.1.0</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
