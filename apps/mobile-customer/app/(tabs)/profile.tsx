import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore, useTheme } from '@surewaka/mobile-shared';

type MenuItem = {
  icon: string;
  label: string;
  route?: string;
  danger?: boolean;
};

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const { theme } = useTheme();

  const menuItems: MenuItem[] = [
    { icon: '👤', label: 'Edit Profile', route: '/profile/edit' },
    { icon: '📍', label: 'Saved Addresses', route: '/profile/addresses' },
    { icon: '💳', label: 'Payment Methods', route: '/profile/payments' },
    { icon: '📋', label: 'Delivery History', route: '/profile/history' },
    { icon: '❓', label: 'Help & Support', route: '/profile/help' },
    { icon: '⚙️', label: 'Settings', route: '/profile/settings' },
  ];

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="items-center py-8 px-6 border-b border-gray-100">
        <View className="w-20 h-20 rounded-full bg-primary-light items-center justify-center mb-3">
          <Text className="text-3xl">👤</Text>
        </View>
        <Text className="text-xl font-bold text-gray-900">
          {user?.user_metadata?.name ?? 'User'}
        </Text>
        <Text className="text-sm text-gray-500 mt-1">
          {user?.phone ?? 'No phone'}
        </Text>
      </View>

      <View className="px-6 py-4">
        {menuItems.map((item, index) => (
          <Pressable
            key={item.label}
            onPress={() => item.route && router.push(item.route)}
            className={`flex-row items-center py-4 ${
              index < menuItems.length - 1 ? 'border-b border-gray-100' : ''
            }`}
          >
            <Text className="text-xl mr-4">{item.icon}</Text>
            <Text
              className={`flex-1 text-base ${
                item.danger ? 'text-error' : 'text-gray-900'
              }`}
            >
              {item.label}
            </Text>
            <Text className="text-gray-400">›</Text>
          </Pressable>
        ))}
      </View>

      <View className="px-6 py-4">
        <Pressable
          onPress={handleSignOut}
          className="py-4 rounded-xl items-center border border-error"
        >
          <Text className="text-error text-base font-semibold">Sign Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
