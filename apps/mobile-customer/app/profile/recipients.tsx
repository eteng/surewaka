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
import { createRecipientsClient, useRecipientStore } from '@surewaka/mobile-shared';
import { useAuth } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';
import type { SavedRecipient } from '@surewaka/shared';

const RECIPIENT_CAP = 25;

export default function RecipientsScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const recipients = useRecipientStore((s) => s.recipients);
  const fetched = useRecipientStore((s) => s.fetched);
  const fetch = useRecipientStore((s) => s.fetch);
  const remove = useRecipientStore((s) => s.remove);

  const [loading, setLoading] = useState(!fetched);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fetched) return;
    (async () => {
      const token = await getToken();
      if (!token) { setLoading(false); return; }
      const { error: err } = await fetch(token);
      if (err) setError('Failed to load recipients');
      setLoading(false);
    })();
  }, []);

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    const token = await getToken();
    if (!token) { setLoading(false); return; }
    const { error: err } = await fetch(token);
    if (err) setError('Failed to load recipients');
    setLoading(false);
  };

  const handleDelete = (recipient: SavedRecipient) => {
    const name = recipient.label || recipient.recipientName;
    Alert.alert(
      'Delete Recipient',
      `Remove "${name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const token = await getToken();
            if (!token) return;
            const { error: err } = await createRecipientsClient(token).remove(recipient.id);
            if (err) {
              Sentry.captureException(err, {
                tags: { app: 'mobile-customer', screen: 'profile/recipients' },
              });
              Alert.alert('Error', 'Could not delete recipient. Please try again.');
            } else {
              remove(recipient.id);
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
        <Text className="text-2xl font-bold text-gray-900">Saved Recipients</Text>
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
          data={recipients}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-4xl mb-4">👤</Text>
              <Text className="text-gray-900 font-semibold text-lg mb-2">No saved recipients</Text>
              <Text className="text-gray-500 text-center">
                Save the people you send to for faster booking.
              </Text>
            </View>
          }
          ListFooterComponent={
            <View className="mt-4">
              {recipients.length >= RECIPIENT_CAP ? (
                <Text className="text-gray-500 text-sm text-center">
                  You've reached the maximum of {RECIPIENT_CAP} saved recipients
                </Text>
              ) : (
                <Pressable
                  onPress={() => router.push('/profile/recipient-edit')}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-4 items-center"
                >
                  <Text className="text-primary text-base font-semibold">+ Add New Recipient</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/profile/recipient-edit?id=${item.id}`)}
              className="flex-row items-center bg-gray-50 rounded-xl p-4 mb-3"
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-gray-900">
                  {item.label || item.recipientName}
                </Text>
                <Text className="text-sm text-gray-500 mt-0.5" numberOfLines={1}>
                  {item.recipientPhone}
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
