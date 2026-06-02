import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase, useAddressStore } from '@surewaka/mobile-shared';
import type { SavedAddress } from '@surewaka/shared';

const ADDRESS_CAP = 25;

export default function AddressesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addresses = useAddressStore((s) => s.addresses);
  const fetched = useAddressStore((s) => s.fetched);
  const fetch = useAddressStore((s) => s.fetch);
  const remove = useAddressStore((s) => s.remove);

  const [loading, setLoading] = useState(!fetched);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fetched) return;
    (async () => {
      const { error: err } = await fetch();
      if (err) setError('Failed to load addresses');
      setLoading(false);
    })();
  }, []);

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    const { error: err } = await fetch();
    if (err) setError('Failed to load addresses');
    setLoading(false);
  };

  const handleDelete = (address: SavedAddress) => {
    Alert.alert(
      'Delete Address',
      `Remove "${address.label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error: err } = await supabase
              .from('user_saved_addresses')
              .delete()
              .eq('id', address.id);
            if (err) {
              Alert.alert('Error', 'Could not delete address. Please try again.');
            } else {
              remove(address.id);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center px-6 pt-12 pb-4 border-b border-gray-100">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Saved Addresses</Text>
      </View>

      {error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-500 text-center mb-4">{error}</Text>
          <Pressable onPress={handleRetry} className="bg-primary px-6 py-3 rounded-xl">
            <Text className="text-white font-semibold">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-4xl mb-4">📍</Text>
              <Text className="text-gray-900 font-semibold text-lg mb-2">No saved addresses</Text>
              <Text className="text-gray-500 text-center">
                Save your home and office addresses for faster booking.
              </Text>
            </View>
          }
          ListFooterComponent={
            <View className="mt-4">
              {addresses.length >= ADDRESS_CAP ? (
                <Text className="text-gray-500 text-sm text-center">
                  You've reached the maximum of {ADDRESS_CAP} saved addresses
                </Text>
              ) : (
                <Pressable
                  onPress={() => router.push('/profile/address-edit')}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-4 items-center"
                >
                  <Text className="text-primary text-base font-semibold">+ Add New Address</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/profile/address-edit?id=${item.id}`)}
              className="flex-row items-center bg-gray-50 rounded-xl p-4 mb-3"
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-gray-900">{item.label}</Text>
                <Text className="text-sm text-gray-500 mt-0.5" numberOfLines={1}>
                  {item.address_text}
                </Text>
              </View>
              <Pressable
                onPress={() => handleDelete(item)}
                hitSlop={12}
                className="ml-3 p-2"
              >
                <Text className="text-red-500 text-lg">🗑</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
