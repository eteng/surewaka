import { useAuth } from '@clerk/expo';
import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBookingStore, useQuoteExpiry, createAuthClient } from '@surewaka/mobile-shared';
import { PaymentShortfallSheet } from './payment-shortfall';
import type { VehicleType } from '@surewaka/shared';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

type QuoteLeg = {
  legType: string;
  legLabel: string;
  lineItems: Array<{ label: string; amountKobo: number }>;
  totalKobo: number;
};

type QuoteResponse = {
  legs: QuoteLeg[];
  compositeTotalKobo: number;
  expiresAt?: string;
};

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
  priceKobo: number | null;
  createdAt: string;
  updatedAt: string;
  quote?: QuoteResponse;
};

/** Formats kobo amount to naira with ₦ prefix (e.g. 350000 → ₦3,500.00) */
function formatKoboToNaira(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReviewScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const pickup = useBookingStore((s) => s.pickup);
  const dropoff = useBookingStore((s) => s.dropoff);
  const packageDetails = useBookingStore((s) => s.packageDetails);
  const recipientDetails = useBookingStore((s) => s.recipientDetails);
  const selectedCarrier = useBookingStore((s) => s.selectedCarrier);
  const selectedRouteId = useBookingStore((s) => s.selectedRouteId);
  const vehicleType = useBookingStore((s) => s.vehicleType);
  const mode = useBookingStore((s) => s.mode);
  const storedDeliveryId = useBookingStore((s) => s.deliveryId);
  const quoteExpiresAt = useBookingStore((s) => s.quoteExpiresAt);
  const setDeliveryId = useBookingStore((s) => s.setDeliveryId);
  const setQuoteExpiresAt = useBookingStore((s) => s.setQuoteExpiresAt);
  const resetBooking = useBookingStore((s) => s.reset);
  const { getToken } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [compositeQuote, setCompositeQuote] = useState<QuoteResponse | null>(null);
  const [showShortfall, setShowShortfall] = useState(false);
  const [shortfallData, setShortfallData] = useState<{
    shortfall: number;
    deliveryId: string;
    totalAmount: number;
  } | null>(null);

  // Quote expiry countdown — tracks time remaining on the authoritative quote
  const { isExpiringSoon, isExpired, countdownDisplay } = useQuoteExpiry(quoteExpiresAt);

  // Tracks whether the booking completed successfully so the cleanup below doesn't
  // cancel a delivery that's already been confirmed and is progressing normally.
  const confirmedRef = useRef(false);

  // Cancel any in-progress draft delivery when the user navigates away without confirming.
  // Uses getState() to read the current store value rather than a stale closure.
  useEffect(() => {
    return () => {
      if (confirmedRef.current) return;
      const { deliveryId: id } = useBookingStore.getState();
      if (!id) return;
      getToken().then((token) => {
        if (!token) return;
        createAuthClient(token)
          .post(`/api/v1/deliveries/${id}/cancel`, {})
          .catch(() => {});
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Refreshes the quote by calling the re-quote endpoint.
   * Updates displayed amounts and resets the expiry countdown.
   */
  const handleRefreshQuote = useCallback(async () => {
    const currentDeliveryId = storedDeliveryId;
    if (!currentDeliveryId) return;
    const token = await getToken();
    if (!token) return;

    setRefreshing(true);
    try {
      const client = createAuthClient(token);
      const { data, error } = await client.post<{
        quote: QuoteResponse;
        previousTotalKobo: number;
      }>(`/api/v1/deliveries/${currentDeliveryId}/requote`, {});

      if (error || !data) {
        Alert.alert('Refresh Failed', error?.message ?? 'Could not refresh quote. Please try again.');
        return;
      }

      // Update displayed quote with fresh data
      setCompositeQuote(data.quote);
      // Update the expiry timestamp to restart the countdown
      if (data.quote.expiresAt) {
        setQuoteExpiresAt(data.quote.expiresAt);
      }
    } catch {
      Alert.alert('Refresh Failed', 'Could not refresh quote. Please try again.');
    } finally {
      setRefreshing(false);
    }
  }, [storedDeliveryId, getToken, setQuoteExpiresAt]);

  /**
   * Builds the legs array for delivery creation based on the selected carrier
   * and vehicle type from the booking store.
   * Returns null for surewaka_way (no legs needed — server routes automatically).
   */
  function buildLegs(): unknown[] | null {
    if (mode === 'surewaka_way') return null;

    if (!selectedCarrier || selectedCarrier === 'instant') {
      return [{ legType: 'first_mile' as const, vehicleType }];
    }

    return [
      { legType: 'first_mile' as const, vehicleType },
      {
        legType: 'intercity' as const,
        carrierId: selectedCarrier,
        ...(selectedRouteId ? { routeId: selectedRouteId } : {}),
      },
      { legType: 'last_mile' as const, vehicleType },
    ];
  }

  const confirmBooking = async (deliveryId: string) => {
    if (!await getToken()) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/booking/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${(await getToken())!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ delivery_id: deliveryId }),
      });
      const json = (await res.json()) as { data: unknown; error?: { message: string } };
      if (!res.ok) {
        Alert.alert('Booking Failed', json.error?.message ?? 'Something went wrong');
        return;
      }
      confirmedRef.current = true; // prevent cleanup from cancelling this delivery
      resetBooking();
      router.push({ pathname: '/booking/confirmed', params: { deliveryId } });
    } catch (err) {
      Alert.alert('Booking Failed', 'Something went wrong. Please try again.');
      console.error('[confirm-booking]', err);
    }
  };

  const handleSubmit = async () => {
    if (!await getToken()) {
      Alert.alert('Error', 'You must be logged in to book a delivery');
      return;
    }

    if (!pickup || !dropoff || !packageDetails || !recipientDetails) {
      Alert.alert('Error', 'Please fill in all booking details');
      return;
    }

    // If quote is expired, prompt refresh instead of allowing a failed confirmation
    if (isExpired && storedDeliveryId) {
      Alert.alert(
        'Quote Expired',
        'Your quote has expired. Please refresh to get updated pricing.',
        [{ text: 'Refresh', onPress: () => void handleRefreshQuote() }],
      );
      return;
    }

    setSubmitting(true);

    const client = createAuthClient((await getToken())!);

    // Cancel any previous draft from a failed or abandoned attempt before creating a new one
    if (storedDeliveryId) {
      client.post(`/api/v1/deliveries/${storedDeliveryId}/cancel`, {}).catch(() => {});
      setDeliveryId(null);
    }

    const legs = buildLegs();
    const isSurewakaWay = mode === 'surewaka_way';

    const body: Record<string, unknown> = {
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
    };
    if (isSurewakaWay) {
      body.mode = 'surewaka_way';
    } else if (legs) {
      body.legs = legs;
    }

    const { data, error } = await client.post<DeliveryResponse & { deliveryId?: string }>('/api/v1/deliveries', body);

    if (error || !data) {
      setSubmitting(false);
      Alert.alert('Booking Failed', error?.message ?? 'Something went wrong');
      return;
    }

    // 202: surewaka_way — delivery is pending routing, navigate to routing-pending screen
    if (isSurewakaWay && data.deliveryId) {
      setDeliveryId(data.deliveryId);
      setSubmitting(false);
      router.push({ pathname: '/booking/routing-pending', params: { deliveryId: data.deliveryId } });
      return;
    }

    const deliveryId = data.id;
    const quote = data.quote;

    // Store delivery ID and quote expiry in booking store for countdown tracking
    setDeliveryId(deliveryId);
    if (quote?.expiresAt) {
      setQuoteExpiresAt(quote.expiresAt);
    }

    // Store quote for display
    if (quote) {
      setCompositeQuote(quote);
    }

    // Use the server-computed composite total from the authoritative quotes
    const deliveryAmount = quote?.compositeTotalKobo ?? data.priceKobo ?? 0;

    if (deliveryAmount === 0) {
      setSubmitting(false);
      Alert.alert('Error', 'Could not determine delivery price. Please try again.');
      return;
    }

    try {
      const checkRes = await fetch(`${API_URL}/api/v1/wallet/check`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${(await getToken())!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: deliveryAmount }),
      });
      const checkJson = (await checkRes.json()) as {
        data: { sufficient: boolean; shortfall?: number } | null;
        error: { code: string; message: string } | null;
      };

      if (!checkRes.ok || !checkJson.data) {
        throw new Error(checkJson.error?.message ?? 'Failed to check balance');
      }

      if (!checkJson.data.sufficient) {
        setShortfallData({
          shortfall: checkJson.data.shortfall ?? deliveryAmount,
          deliveryId,
          totalAmount: deliveryAmount,
        });
        setShowShortfall(true);
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      await confirmBooking(deliveryId);
    } catch (err) {
      setSubmitting(false);
      Alert.alert('Error', 'Could not verify wallet balance. Please try again.');
      console.error('[wallet-check]', err);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6" contentContainerStyle={{ paddingBottom: bottom + 24 }}>
      <Text className="text-2xl font-bold text-gray-900 mb-6">
        Review Booking
      </Text>

      {/* Quote expiry warning — shows when < 2 minutes remaining */}
      {isExpiringSoon && !isExpired && (
        <Pressable
          onPress={() => void handleRefreshQuote()}
          disabled={refreshing}
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex-row items-center justify-between"
        >
          <View className="flex-1">
            <Text className="text-sm font-semibold text-amber-800">
              Quote expiring soon
            </Text>
            <Text className="text-xs text-amber-600 mt-0.5">
              Expires in {countdownDisplay}. Tap to refresh.
            </Text>
          </View>
          {refreshing ? (
            <ActivityIndicator size="small" color="#92400e" />
          ) : (
            <Text className="text-sm font-semibold text-amber-800">Refresh</Text>
          )}
        </Pressable>
      )}

      {isExpired && (
        <Pressable
          onPress={() => void handleRefreshQuote()}
          disabled={refreshing}
          className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex-row items-center justify-between"
        >
          <View className="flex-1">
            <Text className="text-sm font-semibold text-red-800">
              Quote expired
            </Text>
            <Text className="text-xs text-red-600 mt-0.5">
              Tap to get updated pricing before confirming.
            </Text>
          </View>
          {refreshing ? (
            <ActivityIndicator size="small" color="#991b1b" />
          ) : (
            <Text className="text-sm font-semibold text-red-800">Refresh</Text>
          )}
        </Pressable>
      )}

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

      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Service
        </Text>
        <Text className="text-base text-gray-900">
          {selectedCarrier === 'instant' ? 'Instant Match' : 'Carrier Delivery'}
        </Text>
      </View>

      {/* Price Breakdown — Composite Quote grouped by leg */}
      {compositeQuote && (
        <View className="bg-gray-50 rounded-xl p-4 mb-6">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">
            Price Breakdown
          </Text>

          {compositeQuote.legs.map((leg, index) => (
            <View key={`${leg.legType}-${index}`} className={index > 0 ? 'mt-4' : ''}>
              {/* Leg label as section header */}
              <Text className="text-sm font-semibold text-gray-800 mb-2">
                {leg.legLabel}
              </Text>

              {/* Line items under each leg */}
              {leg.lineItems.map((item, itemIndex) => (
                <View
                  key={`${leg.legType}-item-${itemIndex}`}
                  className="flex-row justify-between items-center py-1 px-1"
                >
                  <Text className="text-sm text-gray-600 flex-1">
                    {item.label}
                  </Text>
                  <Text className="text-sm text-gray-900 font-medium">
                    {formatKoboToNaira(item.amountKobo)}
                  </Text>
                </View>
              ))}

              {/* Leg subtotal */}
              <View className="flex-row justify-between items-center pt-2 mt-1 border-t border-gray-200 px-1">
                <Text className="text-sm font-medium text-gray-700">
                  Subtotal
                </Text>
                <Text className="text-sm font-semibold text-gray-900">
                  {formatKoboToNaira(leg.totalKobo)}
                </Text>
              </View>
            </View>
          ))}

          {/* Composite total */}
          <View className="flex-row justify-between items-center pt-3 mt-4 border-t border-gray-300 px-1">
            <Text className="text-base font-bold text-gray-900">
              Total
            </Text>
            <Text className="text-base font-bold text-primary">
              {formatKoboToNaira(compositeQuote.compositeTotalKobo)}
            </Text>
          </View>
        </View>
      )}

      <Pressable
        onPress={handleSubmit}
        disabled={submitting || isExpired}
        className={`py-4 rounded-xl items-center ${
          submitting || isExpired ? 'bg-primary/50' : 'bg-primary'
        }`}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">Confirm & Pay</Text>
        )}
      </Pressable>

      <Modal visible={showShortfall} transparent animationType="slide">
        <View className="flex-1 justify-end bg-black/40">
          {shortfallData && (
            <PaymentShortfallSheet
              shortfall={shortfallData.shortfall}
              deliveryId={shortfallData.deliveryId}
              totalAmount={shortfallData.totalAmount}
              onSuccess={() => {
                setShowShortfall(false);
                void confirmBooking(shortfallData.deliveryId);
              }}
              onDismiss={() => setShowShortfall(false)}
            />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}
