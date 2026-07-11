import { useAuth } from '@clerk/expo';
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { createAuthClient, useQuoteExpiry } from '@surewaka/mobile-shared';

// ─── Types ───────────────────────────────────────────────────────────────────

type WeightCorrectionData = {
  id: string;
  deliveryId: string;
  declaredWeightKg: number;
  reportedWeightKg: number;
  deltaKobo: number;
  status: string;
  approvalDeadline: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formats kobo amount to naira with ₦ prefix (e.g. 350000 → ₦3,500.00) */
function formatKoboToNaira(kobo: number): string {
  const naira = Math.abs(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Returns a signed display string for the delta (e.g. "+₦500.00" or "-₦500.00") */
function formatDelta(deltaKobo: number): string {
  const prefix = deltaKobo > 0 ? '+' : '-';
  return `${prefix}${formatKoboToNaira(deltaKobo)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function WeightCorrectionScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const { deliveryId, correctionId } = useLocalSearchParams<{
    deliveryId: string;
    correctionId: string;
  }>();
  const { getToken } = useAuth();

  const [correction, setCorrection] = useState<WeightCorrectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [responded, setResponded] = useState(false);
  const [responseResult, setResponseResult] = useState<'approved' | 'declined' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Countdown for approval deadline — reuses the same hook as quote expiry
  const { isExpired, countdownDisplay, secondsRemaining } = useQuoteExpiry(
    correction?.approvalDeadline ?? null,
  );

  // ─── Fetch correction details ────────────────────────────────────────────

  const fetchCorrection = useCallback(async () => {
    if (!deliveryId || !correctionId) {
      setError('Missing delivery or correction information.');
      setLoading(false);
      return;
    }

    const token = await getToken();
    if (!token) {
      setError('Please sign in to continue.');
      setLoading(false);
      return;
    }

    try {
      const client = createAuthClient(token);
      const { data, error: apiError } = await client.get<{ correction: WeightCorrectionData }>(
        `/api/v1/deliveries/${deliveryId}/weight-correction/${correctionId}`,
      );

      if (apiError || !data) {
        setError(apiError?.message ?? 'Could not load correction details.');
        return;
      }

      setCorrection(data.correction);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { app: 'mobile-customer', screen: 'weight-correction' },
      });
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [deliveryId, correctionId, getToken]);

  useEffect(() => {
    void fetchCorrection();
  }, [fetchCorrection]);

  // ─── Submit response ─────────────────────────────────────────────────────

  const handleRespond = async (decision: 'approved' | 'declined') => {
    if (!deliveryId || !correctionId) return;

    const token = await getToken();
    if (!token) return;

    setSubmitting(true);
    try {
      const client = createAuthClient(token);
      const { error: apiError } = await client.post(
        `/api/v1/deliveries/${deliveryId}/weight-correction/${correctionId}/respond`,
        { decision },
      );

      if (apiError) {
        Alert.alert('Error', apiError.message ?? 'Could not submit your response. Please try again.');
        return;
      }

      setResponded(true);
      setResponseResult(decision);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { app: 'mobile-customer', screen: 'weight-correction' },
      });
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Decline confirmation dialog ────────────────────────────────────────

  const confirmDecline = () => {
    Alert.alert(
      'Decline Correction?',
      'Declining will cancel this delivery. You will receive an 85% refund of the original amount.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => void handleRespond('declined'),
        },
      ],
    );
  };

  // ─── Loading state ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-sm text-gray-500 mt-3">Loading correction details...</Text>
      </View>
    );
  }

  // ─── Error state ─────────────────────────────────────────────────────────

  if (error || !correction) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-lg font-semibold text-gray-900 mb-2">Unable to Load</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          {error ?? 'Could not load correction details.'}
        </Text>
        <Pressable
          onPress={() => {
            setError(null);
            setLoading(true);
            void fetchCorrection();
          }}
          className="bg-primary py-3 px-6 rounded-xl"
        >
          <Text className="text-white font-semibold">Retry</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Success state (after response submitted) ────────────────────────────

  if (responded) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-4">
          <Text className="text-3xl">
            {responseResult === 'approved' ? '✓' : '✗'}
          </Text>
        </View>
        <Text className="text-xl font-bold text-gray-900 mb-2">
          {responseResult === 'approved' ? 'Correction Approved' : 'Correction Declined'}
        </Text>
        <Text className="text-sm text-gray-500 text-center mb-8">
          {responseResult === 'approved'
            ? `The ${correction.deltaKobo > 0 ? 'additional charge' : 'refund'} of ${formatKoboToNaira(correction.deltaKobo)} has been applied to your wallet.`
            : 'Your delivery has been cancelled. An 85% refund will be applied to your wallet.'}
        </Text>
        <Pressable
          onPress={() => router.replace('/(tabs)' as never)}
          className="bg-primary py-3 px-8 rounded-xl"
        >
          <Text className="text-white font-semibold">Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Main screen ─────────────────────────────────────────────────────────

  const isAdditionalCharge = correction.deltaKobo > 0;
  const weightDiff = Math.abs(correction.reportedWeightKg - correction.declaredWeightKg);

  return (
    <ScrollView
      className="flex-1 bg-white px-6 pt-6"
      contentContainerStyle={{ paddingBottom: bottom + 24 }}
    >
      {/* Header */}
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Weight Correction Required
      </Text>
      <Text className="text-sm text-gray-500 mb-6">
        The driver has reported a weight difference for your package. Please review and respond.
      </Text>

      {/* Deadline countdown */}
      {!isExpired && secondsRemaining !== null && (
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex-row items-center justify-between">
          <View>
            <Text className="text-sm font-semibold text-amber-800">
              Time to respond
            </Text>
            <Text className="text-xs text-amber-600 mt-0.5">
              Please respond before the deadline.
            </Text>
          </View>
          <View className="bg-amber-100 px-3 py-1.5 rounded-lg">
            <Text className="text-base font-bold text-amber-900">
              {countdownDisplay ?? `${Math.floor((secondsRemaining ?? 0) / 60)}:${((secondsRemaining ?? 0) % 60).toString().padStart(2, '0')}`}
            </Text>
          </View>
        </View>
      )}

      {/* Expired state */}
      {isExpired && (
        <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <Text className="text-sm font-semibold text-red-800">
            Correction expired
          </Text>
          <Text className="text-xs text-red-600 mt-0.5">
            The approval window has passed. This correction has been automatically declined.
          </Text>
        </View>
      )}

      {/* Weight comparison card */}
      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">
          Weight Details
        </Text>

        <View className="flex-row justify-between items-center py-2">
          <Text className="text-sm text-gray-600">Declared weight</Text>
          <Text className="text-base font-semibold text-gray-900">
            {correction.declaredWeightKg.toFixed(1)} kg
          </Text>
        </View>

        <View className="border-t border-gray-200 flex-row justify-between items-center py-2">
          <Text className="text-sm text-gray-600">Actual weight (driver-reported)</Text>
          <Text className="text-base font-semibold text-gray-900">
            {correction.reportedWeightKg.toFixed(1)} kg
          </Text>
        </View>

        <View className="border-t border-gray-200 flex-row justify-between items-center py-2">
          <Text className="text-sm text-gray-600">Difference</Text>
          <Text className={`text-base font-semibold ${isAdditionalCharge ? 'text-red-600' : 'text-green-600'}`}>
            {isAdditionalCharge ? '+' : '-'}{weightDiff.toFixed(1)} kg
          </Text>
        </View>
      </View>

      {/* Price delta card */}
      <View className={`rounded-xl p-4 mb-4 ${isAdditionalCharge ? 'bg-red-50 border border-red-100' : 'bg-green-50 border border-green-100'}`}>
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Price Adjustment
        </Text>
        <Text className={`text-2xl font-bold ${isAdditionalCharge ? 'text-red-700' : 'text-green-700'}`}>
          {formatDelta(correction.deltaKobo)}
        </Text>
        <Text className="text-sm text-gray-600 mt-1">
          {isAdditionalCharge
            ? 'Additional charge to your wallet'
            : 'Refund to your wallet'}
        </Text>
      </View>

      {/* Consequences explanation */}
      <View className="bg-gray-50 rounded-xl p-4 mb-6">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">
          What happens next?
        </Text>

        <View className="mb-3">
          <Text className="text-sm font-semibold text-gray-800 mb-1">
            If you approve:
          </Text>
          <Text className="text-sm text-gray-600">
            {isAdditionalCharge
              ? `${formatKoboToNaira(correction.deltaKobo)} will be charged to your wallet and the delivery will continue.`
              : `${formatKoboToNaira(correction.deltaKobo)} will be refunded to your wallet and the delivery will continue.`}
          </Text>
        </View>

        <View>
          <Text className="text-sm font-semibold text-gray-800 mb-1">
            If you decline:
          </Text>
          <Text className="text-sm text-gray-600">
            The delivery will be cancelled and you will receive an 85% refund of the original escrow amount.
          </Text>
        </View>
      </View>

      {/* Action buttons */}
      {!isExpired && (
        <View className="gap-3 mb-4">
          <Pressable
            onPress={() => void handleRespond('approved')}
            disabled={submitting}
            className={`py-4 rounded-xl items-center ${submitting ? 'bg-green-600/50' : 'bg-green-600'}`}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-lg font-semibold">
                Approve Correction
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={confirmDecline}
            disabled={submitting}
            className={`py-4 rounded-xl items-center border ${submitting ? 'border-red-200' : 'border-red-300 bg-red-50'}`}
          >
            <Text className={`text-lg font-semibold ${submitting ? 'text-red-300' : 'text-red-600'}`}>
              Decline
            </Text>
          </Pressable>
        </View>
      )}

      {/* Disabled state when expired */}
      {isExpired && (
        <View className="mb-4">
          <Pressable
            onPress={() => router.replace('/(tabs)' as never)}
            className="bg-gray-200 py-4 rounded-xl items-center"
          >
            <Text className="text-gray-600 text-lg font-semibold">Back to Home</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
