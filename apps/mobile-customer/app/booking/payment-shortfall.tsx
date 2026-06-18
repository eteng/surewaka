import { useAuth } from '@clerk/expo';
import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '@surewaka/mobile-shared';

type Props = {
  shortfall: number;
  deliveryId: string;
  totalAmount: number;
  onSuccess: () => void;
  onDismiss: () => void;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export function PaymentShortfallSheet({
  shortfall,
  deliveryId,
  totalAmount,
  onSuccess,
  onDismiss,
}: Props) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);

  async function pay(amount: number, topupType: 'manual' | 'booking_shortfall') {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/fund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          topup_type: topupType,
          delivery_id: deliveryId,
        }),
      });
      const json = (await res.json()) as {
        data: { authorization_url: string; reference: string } | null;
        error: { code: string; message: string } | null;
      };
      if (!res.ok || !json.data?.authorization_url) {
        throw new Error(json.error?.message ?? 'No authorization URL');
      }

      await WebBrowser.openAuthSessionAsync(json.data.authorization_url, 'surewaka://booking');

      // Poll for payment status then trigger booking confirm
      let attempts = 0;
      const interval = setInterval(() => {
        void (async () => {
          try {
            attempts++;
            const statusRes = await fetch(
              `${API_URL}/api/v1/wallet/fund/${json.data!.reference}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            const statusJson = (await statusRes.json()) as { data: { status: string } };
            if (statusJson.data?.status === 'success') {
              clearInterval(interval);
              onSuccess();
            } else if (attempts >= 8) {
              clearInterval(interval);
              setLoading(false);
              Alert.alert('Payment Timeout', 'We could not confirm your payment. Please check your wallet and try again.');
            }
          } catch {
            clearInterval(interval);
            setLoading(false);
          }
        })();
      }, 2000);
    } catch (err) {
      setLoading(false);
      Alert.alert('Payment Failed', 'Please try again');
      console.error('[shortfall-pay]', err);
    }
  }

  return (
    <View className="bg-white rounded-t-2xl p-6">
      <Text className="text-lg font-bold text-gray-900 mb-1">Insufficient Balance</Text>
      <Text className="text-sm text-gray-500 mb-6">
        You need{' '}
        <Text className="font-semibold text-gray-900">{formatNaira(shortfall)}</Text> more to
        complete this booking.
      </Text>

      <Pressable
        onPress={() => pay(shortfall, 'booking_shortfall')}
        disabled={loading}
        className="bg-primary py-4 rounded-xl items-center mb-3"
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-semibold text-base">
            Top Up {formatNaira(shortfall)}
          </Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => pay(totalAmount, 'booking_shortfall')}
        disabled={loading}
        className="border border-primary py-4 rounded-xl items-center mb-3"
      >
        {loading ? (
          <ActivityIndicator color="#16a34a" />
        ) : (
          <>
            <Text className="text-primary font-semibold text-base">
              Pay {formatNaira(totalAmount)} now (card only)
            </Text>
            <Text className="text-xs text-gray-400 mt-1">Funds wallet then immediately deducts</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={onDismiss} disabled={loading} className="items-center py-2">
        <Text className="text-sm text-gray-400">Cancel</Text>
      </Pressable>
    </View>
  );
}
