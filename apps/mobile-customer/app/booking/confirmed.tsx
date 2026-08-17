import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useBookingStore, createAuthClient, useRealtimeChannel } from '@surewaka/mobile-shared';

type ScreenState = 'searching' | 'matched' | 'failed';

// Any status a delivery could already be in once a driver is assigned —
// covers the common case (still 'accepted') and the case where the app
// missed the realtime event entirely (backgrounded, killed, etc.) and the
// delivery has since moved further along by the time this screen re-checks.
const MATCHED_STATUSES = new Set([
  'accepted',
  'en_route_pickup',
  'arrived_pickup',
  'picked_up',
  'en_route_dropoff',
  'arrived_dropoff',
  'delivered',
]);

// Brief pause on the matched state so the driver-found moment registers
// before the screen changes under the user, rather than an instant redirect.
const REDIRECT_DELAY_MS = 700;

// Reassurance copy kicks in past this point — not a matching-tier readout
// (explicitly out of scope, Requirement 3.4), just an evolving status line
// under the one searching illustration.
const STILL_SEARCHING_AFTER_MS = 20_000;

type DeliveryStatusResponse = { status: string };

export default function ConfirmedScreen() {
  const router = useRouter();
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const { getToken } = useAuth();
  const reset = useBookingStore((s) => s.reset);

  const [screenState, setScreenState] = useState<ScreenState>('searching');
  const [retrying, setRetrying] = useState(false);
  const [stillSearching, setStillSearching] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // getToken read via a ref, not a callback dependency — see the identical
  // comment in tracking/[id].tsx for why (an unstable getToken identity
  // would re-create syncFromRest every render and re-fire the mount effect
  // in a tight loop, observed on-device as a burst of repeated fetches).
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const goToTracking = useCallback(() => {
    setScreenState('matched');
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = setTimeout(() => {
      router.replace(`/tracking/${deliveryId}`);
    }, REDIRECT_DELAY_MS);
  }, [deliveryId, router]);

  // Initial REST fetch (Requirement 3.1) — matching may already have
  // resolved before this screen mounted or subscribed. Also reused as the
  // realtime hook's reconnect fallback (Requirement 2.4): a dropped
  // connection may have missed the event that would've told us.
  const syncFromRest = useCallback(async () => {
    if (!deliveryId) return;
    const token = await getTokenRef.current();
    if (!token) return;

    const { data } = await createAuthClient(token).get<DeliveryStatusResponse>(
      `/api/v1/deliveries/${deliveryId}`,
    );
    if (!data) return;

    if (MATCHED_STATUSES.has(data.status)) {
      goToTracking();
    } else if (data.status === 'routing_failed') {
      setScreenState('failed');
    }
  }, [deliveryId, goToTracking]);

  useEffect(() => {
    syncFromRest();
  }, [syncFromRest]);

  useEffect(() => {
    if (screenState !== 'searching') {
      setStillSearching(false);
      return;
    }
    const timer = setTimeout(() => setStillSearching(true), STILL_SEARCHING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [screenState]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useRealtimeChannel({
    deliveryId,
    events: {
      // Existing event, already published by delivery-accept.ts — no
      // backend change needed for this transition (Requirement 3.2).
      'driver-assigned': () => goToTracking(),
      'matching-failed': () => setScreenState('failed'),
    },
    onReconnect: syncFromRest,
  });

  const handleCancelSearch = async () => {
    if (!deliveryId) return;
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    try {
      const token = await getToken();
      if (token) {
        await createAuthClient(token).post(`/api/v1/deliveries/${deliveryId}/cancel`, {});
      }
    } catch {
      // Best-effort — leave the flow regardless
    }
    reset();
    router.replace('/(tabs)');
  };

  const handleRetry = async () => {
    if (!deliveryId || retrying) return;
    setRetrying(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const { error } = await createAuthClient(token).post(
        `/api/v1/deliveries/${deliveryId}/retry-matching`,
        {},
      );
      if (error) throw new Error(error.message);

      setScreenState('searching');
    } catch (err) {
      Alert.alert(
        'Could not retry',
        err instanceof Error ? err.message : 'Please try again in a moment.',
      );
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View className="flex-1 bg-white items-center justify-center px-8">
      {screenState === 'searching' && (
        <>
          <SearchingIllustration />
          <Text className="text-2xl font-bold text-gray-900 text-center mb-3">
            Finding your driver…
          </Text>
          <Text className="text-base text-gray-500 text-center mb-2 leading-6">
            {stillSearching
              ? 'Still searching — hang tight, this can take a little longer at busy times.'
              : "We're matching you with a nearby driver."}
          </Text>

          <Pressable onPress={handleCancelSearch} className="mt-10 py-3 px-8">
            <Text className="text-base text-gray-500">Cancel</Text>
          </Pressable>
        </>
      )}

      {screenState === 'matched' && (
        <>
          {/* Placeholder — swap for the real matched/success illustration once Task 3 sources it */}
          <View className="w-24 h-24 rounded-full bg-primary-light items-center justify-center mb-6">
            <Ionicons name="checkmark" size={48} color="#16a34a" />
          </View>
          <Text className="text-2xl font-bold text-gray-900 text-center mb-3">
            Driver found!
          </Text>
          <Text className="text-base text-gray-500 text-center leading-6">
            Taking you to your delivery tracking…
          </Text>
        </>
      )}

      {screenState === 'failed' && (
        <>
          {/* Placeholder — swap for the real failed illustration once Task 3 sources it */}
          <View className="w-24 h-24 rounded-full bg-red-50 items-center justify-center mb-6">
            <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          </View>
          <Text className="text-2xl font-bold text-gray-900 text-center mb-3">
            Unable to find a driver
          </Text>
          <Text className="text-base text-gray-500 text-center mb-8 leading-6">
            We couldn't match a driver for your delivery this time. You can try again, or reach
            out if it keeps happening.
          </Text>

          <Pressable
            onPress={handleRetry}
            disabled={retrying}
            className={`py-4 rounded-xl items-center w-full ${retrying ? 'bg-primary/50' : 'bg-primary'}`}
          >
            {retrying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-lg font-semibold">Try Again</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

/**
 * Placeholder searching illustration — a pulsing radar ring around a search
 * icon. Swap for the real sourced animated asset once Task 3 lands (see
 * design.md's Illustration Assets section); kept as a plain RN Animated
 * loop (matching the pattern already used in booking/pickup.tsx) rather
 * than reaching for a new animation dependency for a temporary placeholder.
 */
function SearchingIllustration() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View className="w-32 h-32 items-center justify-center mb-8">
      <Animated.View
        className="absolute w-20 h-20 rounded-full bg-primary/30"
        style={{ transform: [{ scale: ringScale }], opacity: ringOpacity }}
      />
      <View className="w-20 h-20 rounded-full bg-primary items-center justify-center">
        <Ionicons name="search" size={32} color="#fff" />
      </View>
    </View>
  );
}
