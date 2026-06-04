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

export default function PaymentShortfallSheet({
  shortfall,
  deliveryId,
  totalAmount,
  onSuccess,
  onDismiss,
}: Props) {
  const session = useAuthStore((s) => s.session);
  const [loading, setLoading] = useState(false);

  async function pay(amount: number, topupType: 'manual' | 'booking_shortfall') {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/wallet/fund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          email: session.user.email,
          topup_type: topupType,
          delivery_id: deliveryId,
        }),
      });
      const json = (await res.json()) as {
        data: { authorization_url: string; reference: string };
      };
      if (!json.data?.authorization_url) throw new Error('No authorization URL');

      await WebBrowser.openAuthSessionAsync(json.data.authorization_url, 'surewaka://booking');

      // Poll for payment status then trigger booking confirm
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const statusRes = await fetch(
          `${API_URL}/api/v1/wallet/fund/${json.data.reference}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        const statusJson = (await statusRes.json()) as { data: { status: string } };
        if (statusJson.data?.status === 'success' || attempts >= 8) {
          clearInterval(interval);
          onSuccess();
        }
      }, 2000);
    } catch (err) {
      Alert.alert('Payment Failed', 'Please try again');
      console.error('[shortfall-pay]', err);
    } finally {
      setLoading(false);
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
        <Text className="text-primary font-semibold text-base">
          Pay {formatNaira(totalAmount)} now (card only)
        </Text>
        <Text className="text-xs text-gray-400 mt-1">Funds wallet then immediately deducts</Text>
      </Pressable>

      <Pressable onPress={onDismiss} className="items-center py-2">
        <Text className="text-sm text-gray-400">Cancel</Text>
      </Pressable>
    </View>
  );
}
