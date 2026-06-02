import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { recipientDetailsSchema, type RecipientDetails } from '@surewaka/shared';
import { useBookingStore } from '@surewaka/mobile-shared';

export default function RecipientScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const recipientDetails = useBookingStore((s) => s.recipientDetails);
  const setRecipientDetails = useBookingStore((s) => s.setRecipientDetails);
  const setStep = useBookingStore((s) => s.setStep);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RecipientDetails>({
    resolver: zodResolver(recipientDetailsSchema),
    defaultValues: {
      recipientName: recipientDetails?.recipientName ?? '',
      recipientPhone: recipientDetails?.recipientPhone ?? '',
      deliveryNotes: recipientDetails?.deliveryNotes ?? '',
    },
  });

  const onSubmit = (data: RecipientDetails) => {
    setRecipientDetails(data);
    setStep(4);
    router.push('/booking/carriers');
  };

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6" contentContainerStyle={{ paddingBottom: bottom + 24 }}>
      <Text className="text-2xl font-bold text-gray-900 mb-2">Recipient Details</Text>
      <Text className="text-base text-gray-500 mb-8">
        Who should the driver contact at the destination?
      </Text>

      <Controller
        control={control}
        name="recipientName"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Recipient Name</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Who should the driver ask for?"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
            />
            {errors.recipientName && (
              <Text className="text-error text-sm mt-1">{errors.recipientName.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="recipientPhone"
        render={({ field: { onChange, value } }) => (
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Recipient Phone</Text>
            <View className="flex-row items-center border border-gray-300 rounded-xl px-4 py-3">
              <Text className="text-base text-gray-500 mr-2">+234</Text>
              <TextInput
                value={value}
                onChangeText={onChange}
                keyboardType="phone-pad"
                placeholder="08012345678"
                className="flex-1 text-base"
                placeholderClassName="text-gray-400"
              />
            </View>
            {errors.recipientPhone && (
              <Text className="text-error text-sm mt-1">{errors.recipientPhone.message}</Text>
            )}
          </View>
        )}
      />

      <Controller
        control={control}
        name="deliveryNotes"
        render={({ field: { onChange, value } }) => (
          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-1">Delivery Notes</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Any instructions for the driver? (optional)"
              className="border border-gray-300 rounded-xl px-4 py-3 text-base"
              placeholderClassName="text-gray-400"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            {errors.deliveryNotes && (
              <Text className="text-error text-sm mt-1">{errors.deliveryNotes.message}</Text>
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
    </ScrollView>
  );
}
