import { useAuth } from '@clerk/expo';
import { useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { BottomSheet, Button } from '@surewaka/mobile-shared';

type Props = {
  /** Controls sheet visibility so this component owns its own Modal. */
  visible: boolean;
  shortfall: number;
  deliveryId: string;
  totalAmount: number;
  /** Called after a top-up is confirmed successfully. */
  onSuccess: () => void;
  /** Called when the user dismisses the sheet (Cancel / backdrop / back). */
  onDismiss: () => void;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export function PaymentShortfallSheet({
  visible,
  shortfall,
  deliveryId,
  totalAmount,
  onSuccess,
  onDismiss,
}: Props) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

      // Opens the Paystack checkout. Resolves (and auto-dismisses the in-app browser)
      // as soon as Paystack redirects back to the surewaka://booking return URL.
      await WebBrowser.openAuthSessionAsync(json.data.authorization_url, 'surewaka://booking');

      // The browser has closed at this point; poll the fund status and route on success.
      const reference = json.data.reference;
      let attempts = 0;
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            attempts++;
            const pollToken = await getToken();
            if (!pollToken) return;
            const statusRes = await fetch(`${API_URL}/api/v1/wallet/fund/${reference}`, {
              headers: { Authorization: `Bearer ${pollToken}` },
            });
            const statusJson = (await statusRes.json()) as { data: { status: string } | null };
            if (statusJson.data?.status === 'success') {
              stopPolling();
              setLoading(false);
              onSuccess();
            } else if (attempts >= 8) {
              stopPolling();
              setLoading(false);
              Alert.alert(
                'Payment Timeout',
                'We could not confirm your payment. Please check your wallet and try again.',
              );
            }
          } catch {
            stopPolling();
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

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function handleDismiss() {
    if (loading) return; // don't allow dismiss mid-payment
    stopPolling();
    onDismiss();
  }

  return (
    <BottomSheet visible={visible} onClose={handleDismiss} title="Insufficient Balance">
      <Text style={styles.body}>
        You need <Text style={styles.bodyStrong}>{formatNaira(shortfall)}</Text> more to complete
        this booking.
      </Text>

      <Button
        label={`Top Up ${formatNaira(shortfall)}`}
        onPress={() => void pay(shortfall, 'booking_shortfall')}
        loading={loading}
        disabled={loading}
        variant="primary"
        style={styles.primaryButton}
      />

      <View style={styles.cardButtonWrap}>
        <Button
          label={`Pay ${formatNaira(totalAmount)} now (card only)`}
          onPress={() => void pay(totalAmount, 'booking_shortfall')}
          loading={loading}
          disabled={loading}
          variant="secondary"
        />
        <Text style={styles.cardHint}>Funds wallet then immediately deducts</Text>
      </View>

      <Button
        label="Cancel"
        onPress={handleDismiss}
        disabled={loading}
        variant="secondary"
        style={styles.cancelButton}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
    lineHeight: 20,
  },
  bodyStrong: {
    fontWeight: '600',
    color: '#111827',
  },
  primaryButton: {
    marginBottom: 12,
  },
  cardButtonWrap: {
    marginBottom: 12,
  },
  cardHint: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
  },
  cancelButton: {
    borderColor: 'transparent',
  },
});
