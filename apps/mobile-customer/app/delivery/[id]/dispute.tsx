import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const disputeSchema = z.object({
  reason: z.string().min(10, 'Please describe the issue in detail'),
  category: z.enum(['damaged', 'lost', 'late', 'wrong_item', 'other']),
});

type FormData = z.infer<typeof disputeSchema>;

const categories = [
  { value: 'damaged', label: '📦 Damaged Package' },
  { value: 'lost', label: '❌ Lost Package' },
  { value: 'late', label: '⏰ Late Delivery' },
  { value: 'wrong_item', label: '🔄 Wrong Item' },
  { value: 'other', label: '📝 Other' },
];

export default function DisputeScreen() {
  const router = useRouter();

  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(disputeSchema),
    defaultValues: { reason: '', category: 'other' },
  });

  const onSubmit = (data: FormData) => {
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Report an Issue
      </Text>
      <Text className="text-base text-gray-500 mb-8">
        We will look into this and get back to you within 24 hours.
      </Text>

      <View className="mb-6">
        <Text className="text-sm font-medium text-gray-700 mb-2">Category</Text>
        {categories.map((cat) => (
          <Controller
            key={cat.value}
            control={control}
            name="category"
            render={({ field: { onChange, value } }) => (
              <Pressable
                onPress={() => onChange(cat.value)}
                className={`p-3 rounded-xl mb-2 border ${
                  value === cat.value
                    ? 'border-primary bg-primary-light'
                    : 'border-gray-200'
                }`}
              >
                <Text className="text-base">{cat.label}</Text>
              </Pressable>
            )}
          />
        ))}
      </View>

      <Controller
        control={control}
        name="reason"
        render={({ field: { onChange, value } }) => (
          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-1">
              Description
            </Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Describe what happened..."
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {errors.reason && (
              <Text className="text-error text-sm mt-1">{errors.reason.message}</Text>
            )}
          </View>
        )}
      />

      <Pressable
        onPress={handleSubmit(onSubmit)}
        className="bg-primary py-4 rounded-xl items-center mb-8"
      >
        <Text className="text-white text-lg font-semibold">Submit Dispute</Text>
      </Pressable>
    </ScrollView>
  );
}
