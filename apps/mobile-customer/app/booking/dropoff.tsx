import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useBookingStore } from '@surewaka/mobile-shared';

const dropoffSchema = z.object({
  address: z.string().min(5, 'Please enter a valid address'),
  city: z.string().min(2, 'City is required'),
});

type FormData = z.infer<typeof dropoffSchema>;

export default function DropoffScreen() {
  const router = useRouter();
  const dropoff = useBookingStore((s) => s.dropoff);
  const setDropoff = useBookingStore((s) => s.setDropoff);
  const setStep = useBookingStore((s) => s.setStep);

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(dropoffSchema),
    defaultValues: {
      address: dropoff?.address ?? '',
      city: dropoff?.city ?? '',
    },
  });

  const onSubmit = (data: FormData) => {
    setDropoff({ address: data.address, city: data.city, state: '', lat: 0, lng: 0 });
    setStep(2);
    router.push('/booking/package');
  };

  return (
    <View className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Drop-off Location
      </Text>
      <Text className="text-base text-gray-500 mb-8">
        Where should we deliver your package?
      </Text>

      <Controller
        control={control}
        name="address"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Address</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="456 Destination Avenue"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
            />
            {errors.address && (
              <Text className="text-error text-sm mt-1">{errors.address.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="city"
        render={({ field: { onChange, value } }) => (
          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-1">City</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Abuja"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
            />
            {errors.city && (
              <Text className="text-error text-sm mt-1">{errors.city.message}</Text>
            )}
          </View>
        )}
      />

      <Pressable
        onPress={handleSubmit(onSubmit)}
        className="bg-primary py-4 rounded-xl items-center"
      >
        <Text className="text-white text-lg font-semibold">Continue</Text>
      </Pressable>
    </View>
  );
}
