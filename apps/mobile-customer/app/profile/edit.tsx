import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner-native';
import { GENDER_VALUES, GENDER_LABELS } from '@surewaka/shared';
import type { Gender } from '@surewaka/shared';
import { useCustomerProfile } from '~/hooks/use-customer-profile';

const editSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .refine((v) => v.trim().length > 0, 'Name cannot be whitespace only'),
  email: z.string().email('Enter a valid email address').or(z.literal('')).optional(),
});

type FormData = z.infer<typeof editSchema>;

export default function EditProfileScreen() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const { profile, isLoading, updateName, updateEmail, updateGender } = useCustomerProfile();
  const [saving, setSaving] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState<Gender | null>(null);

  const { control, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', email: '' },
  });

  // Populate form once profile data arrives
  useEffect(() => {
    if (profile) {
      reset({ name: profile.name, email: profile.email ?? '' });
      setSelectedGender(profile.gender);
    }
  }, [profile, reset]);

  const onSubmit = async (data: FormData) => {
    setSaving(true);

    const tasks: Promise<{ error: string | null }>[] = [];

    if (data.name !== profile?.name) tasks.push(updateName(data.name));

    const emailChanged = data.email && data.email !== profile?.email;
    if (emailChanged) tasks.push(updateEmail(data.email!));

    if (selectedGender !== profile?.gender) tasks.push(updateGender(selectedGender));

    const results = await Promise.all(tasks);
    const firstError = results.find((r) => r.error)?.error ?? null;

    setSaving(false);

    if (firstError) {
      toast.error(firstError);
      return;
    }

    if (emailChanged) {
      setEmailSent(true);
    } else {
      toast.success('Profile saved!');
      router.back();
    }
  };

  const genderLabel = selectedGender ? GENDER_LABELS[selectedGender] : 'Select gender (optional)';

  if (isLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6" keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Edit Profile</Text>
      </View>

      {/* Avatar placeholder — upload deferred */}
      <View className="items-center mb-8">
        <View className="w-24 h-24 rounded-full bg-green-100 items-center justify-center">
          <Text className="text-4xl">👤</Text>
        </View>
      </View>

      {/* Name */}
      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Full Name</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              autoCapitalize="words"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-900"
            />
            {errors.name && (
              <Text className="text-red-500 text-sm mt-1">{errors.name.message}</Text>
            )}
          </View>
        )}
      />

      {/* Email */}
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
            {profile?.pendingEmail ? (
              <View className="border border-amber-300 rounded-xl px-4 py-3 bg-amber-50">
                <Text className="text-sm text-amber-700">
                  Verifying {profile.pendingEmail} — check your inbox
                </Text>
              </View>
            ) : (
              <TextInput
                value={value}
                onChangeText={onChange}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="your@email.com"
                className="border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-900"
              />
            )}
            {errors.email && (
              <Text className="text-red-500 text-sm mt-1">{errors.email.message}</Text>
            )}
          </View>
        )}
      />

      {/* Gender */}
      <View className="mb-6">
        <Text className="text-sm font-medium text-gray-700 mb-1">Gender</Text>
        <Pressable
          onPress={() => setGenderPickerOpen(true)}
          className="border border-gray-300 rounded-xl px-4 py-3 flex-row items-center justify-between"
        >
          <Text className={`text-base ${selectedGender ? 'text-gray-900' : 'text-gray-400'}`}>
            {genderLabel}
          </Text>
          <Text className="text-gray-400">›</Text>
        </Pressable>
      </View>

      {/* Email verification success */}
      {emailSent && (
        <View className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
          <Text className="text-green-800 text-sm">
            Verification email sent. Check your inbox to confirm your new email address.
          </Text>
          <Pressable onPress={() => router.back()} className="mt-2">
            <Text className="text-primary text-sm font-medium">Done</Text>
          </Pressable>
        </View>
      )}

      {/* Save button */}
      {!emailSent && (
        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={saving}
          className={`py-4 rounded-xl items-center mb-8 ${saving ? 'bg-primary/50' : 'bg-primary'}`}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-lg font-semibold">Save Changes</Text>
          )}
        </Pressable>
      )}

      {/* Gender picker modal */}
      <Modal visible={genderPickerOpen} transparent animationType="slide">
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setGenderPickerOpen(false)}
        >
          <View className="bg-white rounded-t-2xl px-6 pt-4" style={{ paddingBottom: bottom + 32 }}>
            <Text className="text-base font-semibold text-gray-900 mb-4">Select Gender</Text>

            {GENDER_VALUES.map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  setSelectedGender(value);
                  setGenderPickerOpen(false);
                }}
                className="py-4 border-b border-gray-100 flex-row items-center justify-between"
              >
                <Text className="text-base text-gray-900">{GENDER_LABELS[value]}</Text>
                {selectedGender === value && <Text className="text-primary text-lg">✓</Text>}
              </Pressable>
            ))}

            {selectedGender && (
              <Pressable
                onPress={() => {
                  setSelectedGender(null);
                  setGenderPickerOpen(false);
                }}
                className="py-4"
              >
                <Text className="text-base text-gray-400">Clear selection</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
