import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '@surewaka/mobile-shared';

const editProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
});

type FormData = z.infer<typeof editProfileSchema>;

export default function EditProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: {
      name: user?.user_metadata?.name ?? '',
      email: user?.email ?? '',
    },
  });

  const onSubmit = (data: FormData) => {
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Edit Profile</Text>
      </View>

      <View className="items-center mb-8">
        <View className="w-24 h-24 rounded-full bg-primary-light items-center justify-center">
          <Text className="text-4xl">👤</Text>
        </View>
        <Pressable className="mt-2">
          <Text className="text-primary text-sm font-medium">Change Photo</Text>
        </Pressable>
      </View>

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Full Name</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
            />
            {errors.name && (
              <Text className="text-error text-sm mt-1">{errors.name.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, value } }) => (
          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              keyboardType="email-address"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
            />
            {errors.email && (
              <Text className="text-error text-sm mt-1">{errors.email.message}</Text>
            )}
          </View>
        )}
      />

      <Pressable
        onPress={handleSubmit(onSubmit)}
        className="bg-primary py-4 rounded-xl items-center mb-8"
      >
        <Text className="text-white text-lg font-semibold">Save Changes</Text>
      </Pressable>
    </ScrollView>
  );
}
