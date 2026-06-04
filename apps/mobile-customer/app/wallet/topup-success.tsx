import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore, useAuthStore } from '@surewaka/mobile-shared';

export default function TopupSuccessScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const fetchBalance = useWalletStore((s) => s.fetchBalance);

  useEffect(() => {
    if (session?.access_token) fetchBalance(session.access_token);
  }, []);

  return (
    <View className="flex-1 bg-white items-center justify-center px-6">
      <View className="w-20 h-20 rounded-full bg-green-100 items-center justify-center mb-6">
        <Text className="text-4xl">✓</Text>
      </View>
      <Text className="text-2xl font-bold text-gray-900 mb-2">Wallet Funded!</Text>
      <Text className="text-base text-gray-500 text-center mb-8">
        Your wallet balance has been updated.
      </Text>
      <Pressable
        onPress={() => router.replace('/profile/payments')}
        className="bg-primary px-8 py-4 rounded-xl"
      >
        <Text className="text-white font-semibold text-base">Back to Wallet</Text>
      </Pressable>
    </View>
  );
}
