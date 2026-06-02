import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBookingStore, useAuthStore, createAuthClient } from '@surewaka/mobile-shared';

type DeliveryResponse = {
  id: string;
  customerId: string;
  status: string;
  pickupAddress: string;
  pickupCity: string;
  dropoffAddress: string;
  dropoffCity: string;
  packageDescription: string;
  packageWeight: number;
  packageCategory: string;
  price: number | null;
  createdAt: string;
  updatedAt: string;
};

export default function ReviewScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const pickup = useBookingStore((s) => s.pickup);
  const dropoff = useBookingStore((s) => s.dropoff);
  const packageDetails = useBookingStore((s) => s.packageDetails);
  const recipientDetails = useBookingStore((s) => s.recipientDetails);
  const selectedCarrier = useBookingStore((s) => s.selectedCarrier);
  const session = useAuthStore((s) => s.session);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!session?.access_token) {
      Alert.alert('Error', 'You must be logged in to book a delivery');
      return;
    }

    if (!pickup || !dropoff || !packageDetails || !recipientDetails) {
      Alert.alert('Error', 'Please fill in all booking details');
      return;
    }

    setSubmitting(true);

    const client = createAuthClient(session.access_token);

    const { data, error } = await client.post<DeliveryResponse>('/api/v1/deliveries', {
      pickup: {
        address: pickup.address ?? '',
        city: pickup.city ?? '',
        state: pickup.state ?? '',
        lat: pickup.lat ?? 0,
        lng: pickup.lng ?? 0,
      },
      dropoff: {
        address: dropoff.address ?? '',
        city: dropoff.city ?? '',
        state: dropoff.state ?? '',
        lat: dropoff.lat ?? 0,
        lng: dropoff.lng ?? 0,
      },
      packageDetails: {
        description: packageDetails.description ?? '',
        weight: packageDetails.weight ?? 0,
        category: packageDetails.category ?? 'parcel',
      },
      recipientDetails: {
        recipientName: recipientDetails.recipientName ?? '',
        recipientPhone: recipientDetails.recipientPhone ?? '',
        deliveryNotes: recipientDetails.deliveryNotes,
      },
    });

    setSubmitting(false);

    if (error || !data) {
      Alert.alert('Booking Failed', error?.message ?? 'Something went wrong');
      return;
    }

    router.push({
      pathname: '/booking/confirmed',
      params: { deliveryId: data.id },
    });
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6" contentContainerStyle={{ paddingBottom: bottom + 24 }}>
      <Text className="text-2xl font-bold text-gray-900 mb-6">
        Review Booking
      </Text>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Pickup
        </Text>
        <Text className="text-base text-gray-900">
          {pickup?.address ?? '—'}
        </Text>
        <Text className="text-sm text-gray-500">{pickup?.city ?? '—'}</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Drop-off
        </Text>
        <Text className="text-base text-gray-900">
          {dropoff?.address ?? '—'}
        </Text>
        <Text className="text-sm text-gray-500">{dropoff?.city ?? '—'}</Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Package
        </Text>
        <Text className="text-base text-gray-900">
          {packageDetails?.description ?? '—'}
        </Text>
        <Text className="text-sm text-gray-500">
          {packageDetails?.weight}kg · {packageDetails?.category}
        </Text>
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">Recipient</Text>
        <Text className="text-base text-gray-900">{recipientDetails?.recipientName ?? '—'}</Text>
        <Text className="text-sm text-gray-500">{recipientDetails?.recipientPhone ?? '—'}</Text>
        {recipientDetails?.deliveryNotes && (
          <Text className="text-sm text-gray-400 mt-1 italic">"{recipientDetails.deliveryNotes}"</Text>
        )}
      </View>

      <View className="bg-gray-50 rounded-xl p-4 mb-6">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Service
        </Text>
        <Text className="text-base text-gray-900">
          {selectedCarrier === 'instant' ? 'Instant Match' : 'Carrier Delivery'}
        </Text>
      </View>

      <Pressable
        onPress={handleSubmit}
        disabled={submitting}
        className={`py-4 rounded-xl items-center ${
          submitting ? 'bg-primary/50' : 'bg-primary'
        }`}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">Confirm & Pay</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
