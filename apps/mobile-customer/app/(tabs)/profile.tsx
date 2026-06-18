import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { GENDER_LABELS } from '@surewaka/shared';
import { useCustomerProfile } from '~/hooks/use-customer-profile';

type MenuItem = {
  icon: string;
  label: string;
  route?: string;
};

const menuItems: MenuItem[] = [
  { icon: '👤', label: 'Edit Profile', route: '/profile/edit' },
  { icon: '📍', label: 'Saved Addresses', route: '/profile/addresses' },
  { icon: '💳', label: 'Payment Methods', route: '/profile/payments' },
  { icon: '📋', label: 'Delivery History', route: '/profile/history' },
  { icon: '❓', label: 'Help & Support', route: '/profile/help' },
  { icon: '⚙️', label: 'Settings', route: '/profile/settings' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { profile, isLoading, error, refetch } = useCustomerProfile();
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  // Re-fetch whenever the tab comes back into focus (e.g. returning from edit screen)
  useFocusEffect(
    useCallback(() => {
      refetch();
      setAvatarLoadError(false);
    }, [refetch]),
  );

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-base text-gray-500 text-center mb-4">{error}</Text>
        <Pressable onPress={refetch} className="bg-primary px-6 py-3 rounded-xl">
          <Text className="text-white font-semibold">Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      {/* Identity header */}
      <View className="items-center py-8 px-6 border-b border-gray-100">
        <View className="w-20 h-20 rounded-full bg-green-100 items-center justify-center mb-3 overflow-hidden">
          {profile?.avatarUrl && !avatarLoadError ? (
            <Image
              source={{ uri: profile.avatarUrl }}
              style={{ width: 80, height: 80 }}
              cachePolicy="disk"
              contentFit="cover"
              onError={() => setAvatarLoadError(true)}
            />
          ) : (
            <Text className="text-3xl">👤</Text>
          )}
        </View>

        <Text className="text-xl font-bold text-gray-900">{profile?.name ?? '—'}</Text>
        <Text className="text-sm text-gray-500 mt-1">{profile?.phone ?? ''}</Text>

        {/* Email row */}
        {profile?.pendingEmail ? (
          <View className="mt-2 flex-row items-center gap-1">
            <Text className="text-xs text-amber-600">Verifying {profile.pendingEmail}</Text>
            <View className="bg-amber-100 rounded px-1.5 py-0.5">
              <Text className="text-xs text-amber-700 font-medium">Pending</Text>
            </View>
          </View>
        ) : profile?.email ? (
          <Text className="text-sm text-gray-400 mt-1">{profile.email}</Text>
        ) : null}

        {/* Gender */}
        {profile?.gender ? (
          <Text className="text-xs text-gray-400 mt-1">{GENDER_LABELS[profile.gender]}</Text>
        ) : null}
      </View>

      {/* Menu */}
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
            <Text className="flex-1 text-base text-gray-900">{item.label}</Text>
            <Text className="text-gray-400">›</Text>
          </Pressable>
        ))}
      </View>

      {/* Sign out */}
      <View className="px-6 py-4">
        <Pressable
          onPress={() => signOut()}
          className="py-4 rounded-xl items-center border border-red-500"
        >
          <Text className="text-red-500 text-base font-semibold">Sign Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
