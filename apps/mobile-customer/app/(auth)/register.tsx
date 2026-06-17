import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { otpRegisterSchema, type OtpRegister } from '@surewaka/shared';
import { useAuthStore, createAuthClient } from '@surewaka/mobile-shared';

export default function RegisterScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const setProfileExists = useAuthStore((s) => s.setProfileExists);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<OtpRegister>({
    resolver: zodResolver(otpRegisterSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = async (data: OtpRegister) => {
    if (!session?.access_token) {
      setError('Session expired. Please sign out and sign in again.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const client = createAuthClient(session.access_token);
    const { error: apiError } = await client.post('/api/v1/auth/register', { name: data.name });

    setSubmitting(false);

    if (apiError) {
      setError('Something went wrong. Please try again.');
      return;
    }

    setProfileExists(true);
    router.replace('/(tabs)');
  };

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, headerShown: false }} />
      <View className="flex-1 bg-white px-6 justify-center">
        <Text className="text-3xl font-bold text-gray-900 mb-2">One last step</Text>
        <Text className="text-base text-gray-500 mb-8">What should we call you?</Text>

        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, value } }) => (
            <View className="mb-2">
              <TextInput
                value={value}
                onChangeText={onChange}
                placeholder="Your full name"
                autoCapitalize="words"
                autoFocus
                className="border border-gray-300 rounded-xl px-4 py-4 text-lg text-gray-900"
                placeholderClassName="text-gray-400"
              />
              {errors.name && (
                <Text className="text-error text-sm mt-1">{errors.name.message}</Text>
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
          disabled={submitting}
          className={`py-4 rounded-xl items-center mt-4 ${submitting ? 'bg-primary/50' : 'bg-primary'}`}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-lg font-semibold">Continue</Text>
          )}
        </Pressable>
      </View>
    </>
  );
}
