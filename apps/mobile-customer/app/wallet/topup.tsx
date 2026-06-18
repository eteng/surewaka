import { useAuth } from '@clerk/expo';
import { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore, createAuthClient } from '@surewaka/mobile-shared';

const PRESETS = [100000, 250000, 500000, 1000000]; // kobo: ₦1k, ₦2.5k, ₦5k, ₦10k
const MIN_TOPUP = 50000; // ₦500 in kobo

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

export default function TopupScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const resolvedAmount = selectedPreset ?? (customAmount ? Math.round(parseFloat(customAmount) * 100) : 0);

  const handlePay = async () => {
    if (!await getToken()) return;
    if (resolvedAmount < MIN_TOPUP) {
      Alert.alert('Too low', 'Minimum top-up is ₦500');
      return;
    }

    setLoading(true);
    try {
      const client = createAuthClient((await getToken())!);
      const { data, error } = await client.post<{ reference: string; authorization_url: string }>(
        '/api/v1/wallet/fund',
        { amount: resolvedAmount, topup_type: 'manual' },
      );

      if (error || !data?.authorization_url) {
        Alert.alert('Error', error?.message ?? 'Could not initialize payment');
        setLoading(false);
        return;
      }

      await WebBrowser.openAuthSessionAsync(data.authorization_url, 'surewaka://wallet/topup');

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        const { data: statusData } = await client.get<{ status: string }>(
          `/api/v1/wallet/fund/${data.reference}`,
        );
        if (statusData?.status === 'success') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setLoading(false);
          router.replace('/wallet/topup-success');
        } else if (attempts >= 8) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setLoading(false);
          Alert.alert('Payment Pending', 'We could not confirm your payment. Check your wallet balance in a few minutes.');
          router.back();
        }
      }, 2000);
    } catch (err) {
      Alert.alert('Payment Failed', 'Please try again');
      console.error('[topup]', err);
      setLoading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Top Up</Text>
      </View>

      <Text className="text-sm text-gray-500 mb-4">Select an amount</Text>

      <View className="flex-row flex-wrap gap-3 mb-6">
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            onPress={() => { setSelectedPreset(p); setCustomAmount(''); }}
            className={`px-5 py-3 rounded-xl border-2 ${selectedPreset === p ? 'border-primary bg-primary-light' : 'border-gray-200 bg-white'}`}
          >
            <Text className={`text-sm font-semibold ${selectedPreset === p ? 'text-primary' : 'text-gray-700'}`}>
              {formatNaira(p)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-sm text-gray-500 mb-2">Or enter a custom amount (min ₦500)</Text>
      <View className="flex-row items-center border border-gray-200 rounded-xl px-4 mb-8">
        <Text className="text-gray-400 text-base mr-2">₦</Text>
        <TextInput
          className="flex-1 py-4 text-base text-gray-900"
          keyboardType="numeric"
          placeholder="0.00"
          value={customAmount}
          onChangeText={(v) => { setCustomAmount(v); setSelectedPreset(null); }}
        />
      </View>

      <Pressable
        onPress={handlePay}
        disabled={loading || resolvedAmount < MIN_TOPUP}
        className={`py-4 rounded-xl items-center ${resolvedAmount >= MIN_TOPUP ? 'bg-primary' : 'bg-gray-200'}`}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className={`text-base font-semibold ${resolvedAmount >= MIN_TOPUP ? 'text-white' : 'text-gray-400'}`}>
            Pay {resolvedAmount >= MIN_TOPUP ? formatNaira(resolvedAmount) : '—'}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
