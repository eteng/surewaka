import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { phoneOtpSchema } from '@surewaka/shared';
import { useSignIn } from '@clerk/expo';

type FormData = {
  phone: string;
};

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, isLoaded } = useSignIn();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(phoneOtpSchema),
    defaultValues: { phone: '+234' },
  });

  const onSubmit = async (data: FormData) => {
    if (!isLoaded || !signIn) return;

    setSending(true);
    setError(null);

    try {
      // Create a sign-in attempt with phone number
      const result = await signIn.create({
        identifier: data.phone,
      });

      // Prepare the phone code verification
      await result.prepareFirstFactor({
        strategy: 'phone_code',
        phoneNumberId: result.supportedFirstFactors?.find(
          (f) => f.strategy === 'phone_code',
        )?.phoneNumberId ?? '',
      });

      router.push({
        pathname: '/(auth)/verify',
        params: { phone: data.phone },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to send OTP. Please try again.';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <View className="flex-1 px-6 justify-center">
        <Text className="text-3xl font-bold text-gray-900 mb-2">Welcome to SureWaka</Text>
        <Text className="text-base text-gray-500 mb-8">
          Enter your phone number to continue
        </Text>

        <Controller
          control={control}
          name="phone"
          render={({ field: { onChange, value } }) => (
            <View className="mb-2">
              <TextInput
                value={value}
                onChangeText={onChange}
                keyboardType="phone-pad"
                placeholder="+2348012345678"
                className="border border-gray-300 rounded-xl px-4 py-4 text-base text-gray-900"
                placeholderClassName="text-gray-400"
                aria-invalid={!!errors.phone}
              />
              {errors.phone && (
                <Text className="text-error text-sm mt-1">{errors.phone.message}</Text>
              )}
            </View>
          )}
        />

        {error && (
          <View className="bg-red-50 rounded-lg p-3 mb-4">
            <Text className="text-error text-sm">{error}</Text>
          </View>
        )}

        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={sending}
          className={`py-4 rounded-xl items-center mt-4 ${
            sending ? 'bg-primary/50' : 'bg-primary'
          }`}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-lg font-semibold">Send OTP</Text>
          )}
        </Pressable>

        <Text className="text-sm text-gray-400 text-center mt-6">
          We will send you a 6-digit verification code via SMS
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
