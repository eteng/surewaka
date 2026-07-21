import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useBookingStore, createAuthClient } from '@surewaka/mobile-shared';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatEta(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

const LEG_LABELS: Record<string, string> = {
  first_mile: 'Pickup (on-demand)',
  intercity: 'Intercity carrier',
  transfer: 'Transfer (on-demand)',
  last_mile: 'Delivery (on-demand)',
};

export default function ConfirmRoutedScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const { getToken } = useAuth();
  const resetBooking = useBookingStore((s) => s.reset);

  const { deliveryId, compositeTotalKobo, expiresAt, estimatedDeliveryAt } =
    useLocalSearchParams<{
      deliveryId: string;
      compositeTotalKobo: string;
      expiresAt: string;
      estimatedDeliveryAt: string;
    }>();

  const totalKobo = parseInt(compositeTotalKobo ?? '0', 10);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    const token = await getToken();
    if (!token) return;

    setConfirming(true);

    try {
      // Check wallet balance
      const checkRes = await fetch(`${API_URL}/api/v1/wallet/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: totalKobo }),
      });
      const checkJson = (await checkRes.json()) as {
        data: { sufficient: boolean; shortfall?: number } | null;
        error: { message: string } | null;
      };

      if (!checkRes.ok || !checkJson.data) {
        Alert.alert('Error', checkJson.error?.message ?? 'Could not verify balance');
        setConfirming(false);
        return;
      }

      if (!checkJson.data.sufficient) {
        Alert.alert(
          'Insufficient Balance',
          `You need ₦${((checkJson.data.shortfall ?? totalKobo) / 100).toFixed(2)} more. Please top up your wallet.`,
          [{ text: 'OK' }],
        );
        setConfirming(false);
        return;
      }

      // Confirm booking
      const confirmRes = await fetch(`${API_URL}/api/v1/booking/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_id: deliveryId }),
      });
      const confirmJson = (await confirmRes.json()) as {
        error?: { code?: string; message: string; reroutingStarted?: boolean };
      };

      if (!confirmRes.ok) {
        if (confirmJson.error?.code === 'QUOTE_EXPIRED' && confirmJson.error.reroutingStarted) {
          // Route expired and worker re-routing has started — send back to waiting screen
          router.replace({
            pathname: '/booking/routing-pending',
            params: { deliveryId: deliveryId ?? '' },
          });
          return;
        }
        Alert.alert('Confirmation Failed', confirmJson.error?.message ?? 'Something went wrong');
        setConfirming(false);
        return;
      }

      resetBooking();
      router.replace({ pathname: '/booking/confirmed', params: { deliveryId } });
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
      setConfirming(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-white px-6 pt-6"
      contentContainerStyle={{ paddingBottom: bottom + 24 }}
    >
      <Text className="text-2xl font-bold text-gray-900 mb-2">Your route is ready</Text>
      <Text className="text-base text-gray-500 mb-6">
        SureWaka found the best intercity path for your delivery.
      </Text>

      {estimatedDeliveryAt ? (
        <View className="bg-emerald-50 rounded-xl p-4 mb-4 border border-emerald-200">
          <Text className="text-sm font-semibold text-emerald-700 uppercase mb-1">
            Estimated delivery
          </Text>
          <Text className="text-base font-bold text-emerald-900">
            {formatEta(estimatedDeliveryAt)}
          </Text>
        </View>
      ) : null}

      {expiresAt ? (
        <View className="bg-amber-50 rounded-xl p-4 mb-4 border border-amber-200">
          <Text className="text-sm text-amber-700">
            Quote expires {formatEta(expiresAt)}. Confirm before then.
          </Text>
        </View>
      ) : null}

      <View className="bg-gray-50 rounded-xl p-4 mb-6">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">Total</Text>
        <Text className="text-3xl font-bold text-gray-900">{formatKobo(totalKobo)}</Text>
      </View>

      <Pressable
        onPress={handleConfirm}
        disabled={confirming}
        className={`py-4 rounded-xl items-center ${confirming ? 'bg-primary/50' : 'bg-primary'}`}
      >
        {confirming ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">Confirm & Pay</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => router.back()}
        disabled={confirming}
        className="py-3 items-center mt-2"
      >
        <Text className="text-gray-500 text-base">Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}
