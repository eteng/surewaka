import { useAuth } from '@clerk/expo';
import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useBookingStore, carriersApi, apiClient } from '@surewaka/mobile-shared';
import type { Carrier, LineItem } from '@surewaka/shared';

type LegQuoteResult = {
  legType: string;
  lineItems: LineItem[];
  totalKobo: number;
};

type QuoteResponse = {
  legs: LegQuoteResult[];
  compositeTotalKobo: number;
};

type CarrierQuoteState = {
  loading: boolean;
  quote: QuoteResponse | null;
  error: string | null;
};

export default function CarriersScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const setStep = useBookingStore((s) => s.setStep);
  const setSelectedCarrier = useBookingStore((s) => s.setSelectedCarrier);
  const setMode = useBookingStore((s) => s.setMode);
  const pickup = useBookingStore((s) => s.pickup);
  const dropoff = useBookingStore((s) => s.dropoff);
  const packageDetails = useBookingStore((s) => s.packageDetails);

  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quotes state: keyed by carrier id (or 'instant' for on-demand)
  const [quotes, setQuotes] = useState<Record<string, CarrierQuoteState>>({});

  const vehicleType = useBookingStore((s) => s.vehicleType);

  const packageWeight = packageDetails?.weight ?? 1;

  async function loadCarriers() {
    setLoading(true);
    setError(null);
    const res = await carriersApi.list();
    if (res.error || !res.data) {
      setError('Could not load carriers. Please try again.');
    } else {
      setCarriers(res.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCarriers();
  }, []);

  // Build the quote request legs for the on-demand instant option only
  const buildInstantQuoteLegs = useCallback(() => {
    if (pickup?.lat == null || pickup?.lng == null || dropoff?.lat == null || dropoff?.lng == null) {
      return [];
    }
    return [{
      legType: 'first_mile',
      vehicleType,
      pickup: { lat: pickup.lat, lng: pickup.lng },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng },
    }];
  }, [pickup, dropoff, vehicleType]);

  // Fetch the on-demand (instant) speculative quote only — carrier prices are not compared in MVP1
  const fetchInstantQuote = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const legs = buildInstantQuoteLegs();
    if (legs.length === 0) return;

    setQuotes((prev) => ({
      ...prev,
      instant: { loading: true, quote: null, error: null },
    }));

    const res = await apiClient.post<QuoteResponse>(
      '/api/v1/booking/quote',
      { legs, packageWeight },
      token,
    );

    if (res.error || !res.data) {
      setQuotes((prev) => ({
        ...prev,
        instant: { loading: false, quote: null, error: res.error?.message ?? 'Could not get quote' },
      }));
    } else {
      setQuotes((prev) => ({
        ...prev,
        instant: { loading: false, quote: res.data, error: null },
      }));
    }
  }, [getToken, buildInstantQuoteLegs, packageWeight]);

  // Fetch instant quote once locations are available
  useEffect(() => {
    if (!pickup?.lat || !dropoff?.lat) return;
    void fetchInstantQuote();
  }, [pickup, dropoff, packageWeight, vehicleType]);

  function selectCarrier(id: string) {
    setMode('carrier_direct');
    setSelectedCarrier(id);
    setStep(4);
    router.push('/booking/review');
  }

  function selectSurewakaWay() {
    setMode('surewaka_way');
    setSelectedCarrier(null);
    setStep(4);
    router.push('/booking/review');
  }

  function formatKobo(kobo: number): string {
    return `₦${(kobo / 100).toLocaleString()}`;
  }

  // Render line items for a carrier's quote
  function renderQuoteDetails(carrierId: string) {
    const quoteState = quotes[carrierId];

    if (!quoteState || quoteState.loading) {
      return (
        <View className="mt-2">
          <View className="h-3 w-24 bg-gray-200 rounded animate-pulse" />
        </View>
      );
    }

    if (quoteState.error) {
      return (
        <Text className="text-xs text-red-500 mt-1">Price unavailable</Text>
      );
    }

    if (!quoteState.quote) return null;

    // For carrier comparison, show the intercity leg's line items
    const intercityLeg = quoteState.quote.legs.find((l) => l.legType === 'intercity');
    const onDemandLegs = quoteState.quote.legs.filter(
      (l) => l.legType === 'first_mile' || l.legType === 'last_mile',
    );

    return (
      <View className="mt-2">
        {intercityLeg && (
          <View>
            {intercityLeg.lineItems.map((item, idx) => (
              <View key={idx} className="flex-row justify-between items-center mt-0.5">
                <Text className="text-xs text-gray-500">{item.label}</Text>
                <Text className="text-xs text-gray-600">{formatKobo(item.amountKobo)}</Text>
              </View>
            ))}
          </View>
        )}
        {onDemandLegs.length > 0 && (
          <View className="mt-1 pt-1 border-t border-gray-100">
            {onDemandLegs.map((leg, legIdx) => (
              <View key={legIdx} className="mb-1">
                <Text className="text-xs font-medium text-gray-600 mb-0.5">
                  {leg.legType === 'first_mile' ? 'Pickup leg' : 'Delivery leg'}
                </Text>
                {leg.lineItems
                  .filter((i) => i.label.startsWith('Vehicle type'))
                  .map((item, idx) => (
                    <View key={idx} className="flex-row justify-between items-center">
                      <Text className="text-xs text-gray-500">{item.label}</Text>
                      <Text className="text-xs text-gray-600">{formatKobo(item.amountKobo)}</Text>
                    </View>
                  ))}
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs text-gray-500">Leg total</Text>
                  <Text className="text-xs text-gray-600">{formatKobo(leg.totalKobo)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        <View className="flex-row justify-between items-center mt-1.5 pt-1 border-t border-gray-200">
          <Text className="text-xs font-semibold text-gray-700">Total</Text>
          <Text className="text-sm font-bold text-gray-900">
            {formatKobo(quoteState.quote.compositeTotalKobo)}
          </Text>
        </View>
      </View>
    );
  }

  // Render the total price badge for a carrier
  function renderPriceBadge(carrierId: string, fallbackPrice: number | null) {
    const quoteState = quotes[carrierId];

    if (!quoteState || quoteState.loading) {
      return (
        <View className="items-end">
          <View className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
        </View>
      );
    }

    if (quoteState.error || !quoteState.quote) {
      // Fallback to static basePrice if quote fails
      if (fallbackPrice != null) {
        return (
          <Text className="text-lg font-bold text-gray-900 shrink-0">
            From {formatKobo(fallbackPrice)}
          </Text>
        );
      }
      return null;
    }

    return (
      <Text className="text-lg font-bold text-gray-900 shrink-0">
        {formatKobo(quoteState.quote.compositeTotalKobo)}
      </Text>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">Choose a Service</Text>
      <Text className="text-base text-gray-500 mb-6">Choose how to send your package</Text>

      {pickup?.city && dropoff?.city && pickup.city !== dropoff.city && (
        <Pressable
          onPress={selectSurewakaWay}
          className="bg-emerald-50 rounded-xl p-4 mb-4 border-2 border-emerald-600"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-4">
              <Text className="text-lg font-bold text-emerald-700">SureWaka picks best route</Text>
              <Text className="text-sm text-gray-500 mt-1">
                We find the cheapest intercity path for you
              </Text>
            </View>
            <Text className="text-2xl">✨</Text>
          </View>
        </Pressable>
      )}

      <Pressable
        onPress={() => { setMode('on_demand'); selectCarrier('instant'); }}
        className="bg-primary-light rounded-xl p-4 mb-4 border-2 border-primary"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 mr-4">
            <Text className="text-lg font-bold text-primary">Instant Match</Text>
            <Text className="text-sm text-gray-500 mt-1">Get a driver in ~15 minutes</Text>
          </View>
          {renderPriceBadge('instant', null)}
        </View>
        {renderQuoteDetails('instant')}
      </Pressable>

      <Text className="text-base font-semibold text-gray-900 mb-3 mt-2">Registered Carriers</Text>

      {loading && (
        <View className="py-10 items-center">
          <ActivityIndicator size="large" color="#16a34a" />
        </View>
      )}

      {!loading && error && (
        <View className="py-8 items-center gap-3">
          <Text className="text-gray-500 text-sm text-center">{error}</Text>
          <Pressable onPress={loadCarriers} className="px-4 py-2 bg-primary rounded-lg">
            <Text className="text-white font-semibold text-sm">Retry</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && carriers.length === 0 && (
        <View className="py-8 items-center">
          <Text className="text-gray-400 text-sm">No carriers available at the moment.</Text>
        </View>
      )}

      {!loading &&
        !error &&
        carriers.map((carrier) => (
          <Pressable
            key={carrier.id}
            onPress={() => selectCarrier(carrier.id)}
            className="bg-gray-50 rounded-xl p-4 mb-3"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-4">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-gray-900">{carrier.name}</Text>
                  {carrier.isVerified && (
                    <Text className="text-xs text-green-600 font-medium">✓ Verified</Text>
                  )}
                </View>
                <Text className="text-sm text-gray-500 mt-0.5">
                  {carrier.rating != null ? `⭐ ${carrier.rating.toFixed(1)}` : 'No ratings yet'}
                  {carrier.deliveryCount != null && carrier.deliveryCount > 0
                    ? ` · ${carrier.deliveryCount.toLocaleString()} deliveries`
                    : ''}
                </Text>
              </View>
              <Text className="text-sm text-gray-400">Price at checkout</Text>
            </View>
          </Pressable>
        ))}

      <View className="h-8" />
    </ScrollView>
  );
}
