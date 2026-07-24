import { useAuth } from '@clerk/expo';
import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useBookingStore, apiClient } from '@surewaka/mobile-shared';
import type { LineItem } from '@surewaka/shared';

type CarrierRoute = {
  routeId: string;
  carrierId: string;
  carrierName: string;
  basePriceKobo: number;
  estimatedTransitHours: number;
  maxWeightKg: number;
  nextDepartureAt: string | null;
};

type LegQuoteResult = {
  legType: string;
  lineItems: LineItem[];
  totalKobo: number;
};

type QuoteResponse = {
  legs: LegQuoteResult[];
  compositeTotalKobo: number;
};

type RouteQuoteState = {
  loading: boolean;
  quote: QuoteResponse | null;
  error: string | null;
};

export default function CarriersScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const setStep = useBookingStore((s) => s.setStep);
  const setSelectedCarrier = useBookingStore((s) => s.setSelectedCarrier);
  const setSelectedRouteId = useBookingStore((s) => s.setSelectedRouteId);
  const setMode = useBookingStore((s) => s.setMode);
  const pickup = useBookingStore((s) => s.pickup);
  const dropoff = useBookingStore((s) => s.dropoff);
  const packageDetails = useBookingStore((s) => s.packageDetails);

  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quotes state: keyed by routeId (or 'instant' for on-demand)
  const [quotes, setQuotes] = useState<Record<string, RouteQuoteState>>({});

  const vehicleType = useBookingStore((s) => s.vehicleType);
  const packageWeight = packageDetails?.weight ?? 1;

  const isIntercity =
    !!pickup?.city && !!dropoff?.city && pickup.city !== dropoff.city;

  async function loadRoutes() {
    if (!pickup?.city || !dropoff?.city) return;

    setLoading(true);
    setError(null);
    setRoutes([]);

    const token = await getToken();
    if (!token) {
      setError('Authentication required.');
      setLoading(false);
      return;
    }

    const res = await apiClient.get<CarrierRoute[]>(
      `/api/v1/carrier-routes?fromCity=${encodeURIComponent(pickup.city)}&toCity=${encodeURIComponent(dropoff.city)}`,
      token,
    );

    if (res.error || !res.data) {
      setError('Could not load carriers for this route. Please try again.');
    } else {
      setRoutes(res.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (isIntercity) {
      loadRoutes();
    }
  }, [pickup?.city, dropoff?.city]);

  // Build quote request legs for a given carrierId (or 'instant')
  const buildQuoteLegs = useCallback(
    (carrierId: string, routeId?: string) => {
      const legs: unknown[] = [];

      if (pickup?.lat == null || pickup?.lng == null || dropoff?.lat == null || dropoff?.lng == null) {
        return legs;
      }

      if (carrierId === 'instant') {
        legs.push({
          legType: 'first_mile',
          vehicleType,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        });
      } else {
        legs.push({
          legType: 'first_mile',
          vehicleType,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          dropoff: { lat: pickup.lat, lng: pickup.lng },
        });
        legs.push({
          legType: 'intercity',
          carrierId,
          ...(routeId ? { routeId } : {}),
        });
        legs.push({
          legType: 'last_mile',
          vehicleType,
          pickup: { lat: dropoff.lat, lng: dropoff.lng },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng },
        });
      }

      return legs;
    },
    [pickup, dropoff, vehicleType],
  );

  const fetchQuote = useCallback(
    async (key: string, carrierId: string, routeId?: string) => {
      const token = await getToken();
      if (!token) return;

      const legs = buildQuoteLegs(carrierId, routeId);
      if (legs.length === 0) return;

      setQuotes((prev) => ({
        ...prev,
        [key]: { loading: true, quote: null, error: null },
      }));

      const res = await apiClient.post<QuoteResponse>(
        '/api/v1/booking/quote',
        { legs, packageWeight },
        token,
      );

      if (res.error || !res.data) {
        setQuotes((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            quote: null,
            error: res.error?.message ?? 'Could not get quote',
          },
        }));
      } else {
        setQuotes((prev) => ({
          ...prev,
          [key]: { loading: false, quote: res.data, error: null },
        }));
      }
    },
    [getToken, buildQuoteLegs, packageWeight],
  );

  useEffect(() => {
    if (!pickup?.lat || !dropoff?.lat) return;

    fetchQuote('instant', 'instant');
  }, [pickup, dropoff, packageWeight, vehicleType]);

  useEffect(() => {
    if (loading || error || routes.length === 0) return;
    if (!pickup?.lat || !dropoff?.lat) return;

    for (const route of routes) {
      fetchQuote(route.routeId, route.carrierId, route.routeId);
    }
  }, [loading, error, routes, pickup, dropoff, packageWeight, vehicleType]);

  function selectRoute(route: CarrierRoute) {
    setMode('carrier_direct');
    setSelectedCarrier(route.carrierId);
    setSelectedRouteId(route.routeId);
    setStep(4);
    router.push('/booking/review');
  }

  function selectInstant() {
    setMode('on_demand');
    setSelectedCarrier('instant');
    setSelectedRouteId(null);
    setStep(4);
    router.push('/booking/review');
  }

  function selectSurewakaWay() {
    setMode('surewaka_way');
    setSelectedCarrier(null);
    setSelectedRouteId(null);
    setStep(4);
    router.push('/booking/review');
  }

  function formatKobo(kobo: number): string {
    return `₦${(kobo / 100).toLocaleString()}`;
  }

  function formatDeparture(isoString: string | null): string {
    if (!isoString) return 'Schedule TBD';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Lagos',
    });
  }

  function renderQuoteDetails(key: string) {
    const quoteState = quotes[key];

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

  function renderPriceBadge(key: string, fallbackPriceKobo: number | null) {
    const quoteState = quotes[key];

    if (!quoteState || quoteState.loading) {
      return (
        <View className="items-end">
          <View className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
        </View>
      );
    }

    if (quoteState.error || !quoteState.quote) {
      if (fallbackPriceKobo != null) {
        return (
          <Text className="text-lg font-bold text-gray-900 shrink-0">
            From {formatKobo(fallbackPriceKobo)}
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
      <Text className="text-base text-gray-500 mb-6">Compare prices and delivery times</Text>

      {isIntercity && (
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
        onPress={selectInstant}
        className="bg-primary-light rounded-xl p-4 mb-4 border-2 border-primary"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 mr-4">
            <Text className="text-lg font-bold text-primary">Instant Match</Text>
            <Text className="text-sm text-gray-500 mt-1">Get a driver in ~15 minutes</Text>
          </View>
          {renderPriceBadge('instant', 300000)}
        </View>
        {renderQuoteDetails('instant')}
      </Pressable>

      {isIntercity && (
        <>
          <Text className="text-base font-semibold text-gray-900 mb-3 mt-2">Registered Carriers</Text>

          {loading && (
            <View className="py-10 items-center">
              <ActivityIndicator size="large" color="#16a34a" />
            </View>
          )}

          {!loading && error && (
            <View className="py-8 items-center gap-3">
              <Text className="text-gray-500 text-sm text-center">{error}</Text>
              <Pressable onPress={loadRoutes} className="px-4 py-2 bg-primary rounded-lg">
                <Text className="text-white font-semibold text-sm">Retry</Text>
              </Pressable>
            </View>
          )}

          {!loading && !error && routes.length === 0 && (
            <View className="py-8 items-center">
              <Text className="text-gray-400 text-sm">No carriers available for this route.</Text>
            </View>
          )}

          {!loading &&
            !error &&
            routes.map((route) => (
              <Pressable
                key={route.routeId}
                onPress={() => selectRoute(route)}
                className="bg-gray-50 rounded-xl p-4 mb-3"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 mr-4">
                    <Text className="text-base font-semibold text-gray-900">{route.carrierName}</Text>
                    <Text className="text-sm text-gray-500 mt-0.5">
                      {route.estimatedTransitHours}h transit
                      {route.nextDepartureAt
                        ? ` · Next: ${formatDeparture(route.nextDepartureAt)}`
                        : ''}
                    </Text>
                    {route.maxWeightKg < 1000 && (
                      <Text className="text-xs text-gray-400 mt-0.5">
                        Max {route.maxWeightKg}kg
                      </Text>
                    )}
                  </View>
                  {renderPriceBadge(route.routeId, route.basePriceKobo)}
                </View>
                {renderQuoteDetails(route.routeId)}
              </Pressable>
            ))}
        </>
      )}

      <View className="h-8" />
    </ScrollView>
  );
}
