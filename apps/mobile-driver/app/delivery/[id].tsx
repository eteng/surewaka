import { useEffect, useState, useCallback, useRef } from 'react';
import { Text, View, StyleSheet, Pressable, ActivityIndicator, AppState } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Screen, createAuthClient } from '@surewaka/mobile-shared';
import { WeightVerification } from '../components/weight-verification';

type LegStatus =
  | 'pending'
  | 'assigned'
  | 'en_route_pickup'
  | 'arrived_pickup'
  | 'picked_up'
  | 'en_route_dropoff'
  | 'arrived_dropoff'
  | 'delivered';

type DeliveryLeg = {
  id: string;
  legType: 'first_mile' | 'intercity' | 'last_mile';
  actorType: 'driver' | 'carrier';
  status: LegStatus;
};

type DeliveryDetail = {
  id: string;
  packageWeight: number | null;
  pickup: { address: string } | null;
  dropoff: { address: string } | null;
  legs: DeliveryLeg[];
};

type WeightCorrectionResponse = {
  correctionId: string;
  declaredWeightKg: number;
  reportedWeightKg: number;
  deltaKobo: number;
  approvalDeadline: string;
};

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getToken } = useAuth();
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  // Find the current on-demand leg for this driver
  const currentLeg = delivery?.legs?.find(
    (leg) => leg.actorType === 'driver' && leg.status === 'arrived_pickup',
  );

  const showWeightVerification = !!currentLeg && !awaitingApproval;

  const fetchDelivery = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication failed');
        return;
      }

      const client = createAuthClient(token);
      const response = await client.get<DeliveryDetail>(`/api/v1/deliveries/${id}`);

      if (response.error) {
        setError(response.error.message);
      } else if (response.data) {
        setDelivery(response.data);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [id, getToken]);

  useEffect(() => {
    fetchDelivery();
  }, [fetchDelivery]);

  const handleWeightMatches = useCallback(async () => {
    // Weight matches — proceed with normal pickup flow (transition to picked_up)
    try {
      const token = await getToken();
      if (!token) return;

      const client = createAuthClient(token);
      // Transition leg to picked_up via existing leg status update endpoint
      if (currentLeg) {
        await client.patch(`/api/v1/deliveries/${id}/legs/${currentLeg.id}/status`, {
          status: 'picked_up',
        });
        // Refresh delivery data
        fetchDelivery();
      }
    } catch {
      // Error handled silently — the button press should still feel responsive
    }
  }, [id, currentLeg, getToken, fetchDelivery]);

  const handleCorrectionSubmitted = useCallback((_correction: WeightCorrectionResponse) => {
    setAwaitingApproval(true);
  }, []);

  // Poll for leg status change when awaiting approval
  // The primary signal is a push notification, but polling acts as a fallback
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!awaitingApproval) return;

    const poll = async () => {
      const token = await getToken();
      if (!token) return;

      const client = createAuthClient(token);
      const response = await client.get<DeliveryDetail>(`/api/v1/deliveries/${id}`);

      if (response.data) {
        const leg = response.data.legs?.find(
          (l) => l.actorType === 'driver' && l.id === currentLeg?.id,
        );
        // If the leg has progressed past arrived_pickup, customer has approved
        if (leg && leg.status !== 'arrived_pickup') {
          setAwaitingApproval(false);
          setDelivery(response.data);
        }
      }
    };

    // Poll every 10 seconds
    pollInterval.current = setInterval(poll, 10_000);

    // Also poll when app comes to foreground
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll();
    });

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
      subscription.remove();
    };
  }, [awaitingApproval, id, getToken, currentLeg?.id]);

  // Loading state
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={fetchDelivery}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Screen variant="scroll">
      <Text style={styles.heading}>Delivery #{id?.slice(0, 8)}</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Pickup</Text>
        <Text style={styles.value}>{delivery?.pickup?.address ?? '—'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Drop-off</Text>
        <Text style={styles.value}>{delivery?.dropoff?.address ?? '—'}</Text>
      </View>

      {delivery?.packageWeight != null && (
        <View style={styles.section}>
          <Text style={styles.label}>Declared Weight</Text>
          <Text style={styles.value}>{delivery.packageWeight}kg</Text>
        </View>
      )}

      {/* Weight verification step — shown when leg is at arrived_pickup */}
      {showWeightVerification && delivery?.packageWeight != null && currentLeg && (
        <WeightVerification
          deliveryId={id!}
          legId={currentLeg.id}
          declaredWeightKg={delivery.packageWeight}
          onWeightMatches={handleWeightMatches}
          onCorrectionSubmitted={handleCorrectionSubmitted}
        />
      )}

      {/* Awaiting approval state — shown after correction is submitted */}
      {awaitingApproval && (
        <View style={styles.awaitingCard}>
          <ActivityIndicator size="small" color="#16a34a" />
          <Text style={styles.awaitingText}>
            Waiting for customer to approve weight correction...
          </Text>
          <Text style={styles.awaitingHint}>
            The delivery will proceed once the customer responds.
          </Text>
        </View>
      )}

      {/* Normal actions — only when not in weight verification flow */}
      {!showWeightVerification && !awaitingApproval && (
        <View style={styles.actions}>
          <Pressable style={styles.navigateButton}>
            <Text style={styles.navigateButtonText}>Navigate</Text>
          </Pressable>
          <Pressable style={styles.confirmButton}>
            <Text style={styles.confirmButtonText}>Confirm Pickup</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 24,
  },
  section: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  label: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    color: '#111827',
  },
  actions: {
    marginTop: 'auto',
    gap: 12,
  },
  navigateButton: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  navigateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#16a34a',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    color: '#dc2626',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  awaitingCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  awaitingText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    textAlign: 'center',
  },
  awaitingHint: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
});
