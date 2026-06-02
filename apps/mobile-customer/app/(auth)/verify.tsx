import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { otpVerifySchema } from '@surewaka/shared';
import { useAuthStore } from '@surewaka/mobile-shared';

type FormData = {
  otp: string;
};

export default function VerifyScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { otp: '' },
  });

  const onSubmit = async (data: FormData) => {
    setVerifying(true);
    setError(null);

    const { error: verifyError } = await verifyOtp(phone, data.otp);

    setVerifying(false);

    if (verifyError) {
      setError(verifyError);
    }
  };

  return (
    <View className="flex-1 bg-white px-6 justify-center">
      <Pressable
        onPress={() => router.back()}
        className="absolute top-12 left-6"
      >
        <Text className="text-primary text-base">← Back</Text>
      </Pressable>

      <Text className="text-3xl font-bold text-gray-900 mb-2">
        Verify OTP
      </Text>
      <Text className="text-base text-gray-500 mb-2">
        Enter the 6-digit code sent to
      </Text>
      <Text className="text-base text-gray-900 font-medium mb-8">
        {phone}
      </Text>

      <Controller
        control={control}
        name="otp"
        render={({ field: { onChange, value } }) => (
          <View className="mb-2">
            <TextInput
              value={value}
              onChangeText={onChange}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              textAlign="center"
              className="border border-gray-300 rounded-xl px-4 py-4 text-2xl text-gray-900 tracking-widest"
              placeholderClassName="text-gray-400"
            />
            {errors.otp && (
              <Text className="text-error text-sm mt-1">{errors.otp.message}</Text>
            )}
          </View>
        )}
      />

      {error && (
        <View className="bg-red-50 rounded-lg p-3 mb-4 mt-2">
          <Text className="text-error text-sm">{error}</Text>
        </View>
      )}

      <Pressable
        onPress={handleSubmit(onSubmit)}
        disabled={verifying}
        className={`py-4 rounded-xl items-center mt-4 ${
          verifying ? 'bg-primary/50' : 'bg-primary'
        }`}
      >
        {verifying ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">Verify</Text>
        )}
      </Pressable>
    </View>
  );
}
