import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { createAuthClient } from '@surewaka/mobile-shared';

const POLL_INTERVAL_MS = 3000;

type QuoteLeg = {
  legType: string;
  totalKobo: number;
};

type RoutedQuote = {
  legs: QuoteLeg[];
  compositeTotalKobo: number;
  expiresAt: string;
  estimatedDeliveryAt: string | null;
};

type DeliveryPollResponse = {
  id: string;
  status: string;
  deliveryMode: string | null;
  quote?: RoutedQuote;
};

export default function RoutingPendingScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!deliveryId) return;

    let active = true;

    async function poll() {
      const token = await getToken();
      if (!token || !active) return;

      const client = createAuthClient(token);
      const { data } = await client.get<DeliveryPollResponse>(`/api/v1/deliveries/${deliveryId}`);

      if (!active) return;

      if (data?.status === 'draft' && data.deliveryMode === 'surewaka_way' && data.quote) {
        clearInterval(intervalRef.current!);
        router.replace({
          pathname: '/booking/confirm',
          params: {
            deliveryId,
            compositeTotalKobo: String(data.quote.compositeTotalKobo),
            expiresAt: data.quote.expiresAt,
            estimatedDeliveryAt: data.quote.estimatedDeliveryAt ?? '',
          },
        });
        return;
      }

      if (data?.status === 'routing_failed') {
        clearInterval(intervalRef.current!);
        Alert.alert(
          'Route not found',
          "We couldn't find a route for your delivery. Choose a carrier manually?",
          [
            {
              text: 'Choose carrier',
              onPress: () => router.replace('/booking/carriers'),
            },
            { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
          ],
        );
      }
    }

    // Poll immediately then on interval
    poll();
    intervalRef.current = setInterval(() => {
      setElapsed((n) => n + POLL_INTERVAL_MS);
      poll();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [deliveryId, getToken, router]);

  return (
    <View className="flex-1 bg-white items-center justify-center px-8">
      <ActivityIndicator size="large" color="#16a34a" />

      <Text className="text-xl font-bold text-gray-900 text-center mt-6">
        Finding your best route
      </Text>
      <Text className="text-base text-gray-500 text-center mt-2 leading-6">
        This usually takes under a minute.
      </Text>

      {elapsed > 30_000 && (
        <Text className="text-sm text-gray-400 text-center mt-3">
          Still searching… hang tight.
        </Text>
      )}

      <Pressable
        onPress={async () => {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (deliveryId) {
            try {
              const token = await getToken();
              if (token) {
                const client = createAuthClient(token);
                await client.post(`/api/v1/deliveries/${deliveryId}/cancel`, {});
              }
            } catch {
              // Best-effort — navigate back regardless
            }
          }
          router.back();
        }}
        className="mt-12 py-3 px-8"
      >
        <Text className="text-base text-gray-500">Cancel</Text>
      </Pressable>
    </View>
  );
}
