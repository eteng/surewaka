import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useBookingStore } from '@surewaka/mobile-shared';
import { PACKAGE_CATEGORIES } from '@surewaka/shared';

const packageSchema = z.object({
  description: z.string().min(3, 'Describe your package').max(500),
  weight: z.string().min(1, 'Enter weight'),
  category: z.enum(PACKAGE_CATEGORIES),
});

type FormData = z.infer<typeof packageSchema>;

export default function PackageScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const packageDetails = useBookingStore((s) => s.packageDetails);
  const setPackageDetails = useBookingStore((s) => s.setPackageDetails);
  const setStep = useBookingStore((s) => s.setStep);

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(packageSchema),
    defaultValues: {
      description: packageDetails?.description ?? '',
      weight: packageDetails?.weight?.toString() ?? '',
      category: packageDetails?.category ?? 'parcel',
    },
  });

  const onSubmit = (data: FormData) => {
    setPackageDetails({
      description: data.description,
      weight: parseFloat(data.weight),
      category: data.category,
    });
    setStep(3);
    router.push('/booking/recipient');
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6" contentContainerStyle={{ paddingBottom: bottom + 24 }}>
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Package Details
      </Text>
      <Text className="text-base text-gray-500 mb-8">
        Tell us about your package
      </Text>

      <Controller
        control={control}
        name="description"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Description</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="What are you sending?"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
              multiline
            />
            {errors.description && (
              <Text className="text-error text-sm mt-1">{errors.description.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="weight"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Weight (kg)</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              keyboardType="numeric"
              placeholder="5"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
            />
            {errors.weight && (
              <Text className="text-error text-sm mt-1">{errors.weight.message}</Text>
            )}
          </View>
        )}
      />

      <View className="mb-6">
        <Text className="text-sm font-medium text-gray-700 mb-2">Category</Text>
        <View className="flex-row flex-wrap gap-2">
          {PACKAGE_CATEGORIES.map((cat) => (
            <Controller
              key={cat}
              control={control}
              name="category"
              render={({ field: { onChange, value } }) => (
                <Pressable
                  onPress={() => onChange(cat)}
                  className={`px-4 py-2 rounded-full border ${
                    value === cat
                      ? 'bg-primary border-primary'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      value === cat ? 'text-white' : 'text-gray-700'
                    }`}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </Text>
                </Pressable>
              )}
            />
          ))}
        </View>
      </View>

      <Pressable
        onPress={handleSubmit(onSubmit)}
        className="bg-primary py-4 rounded-xl items-center"
      >
        <Text className="text-white text-lg font-semibold">Continue</Text>
      </Pressable>
    </ScrollView>
  );
}
