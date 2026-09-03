import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Sentry from '@sentry/react-native';
import { recipientDetailsSchema, type RecipientDetails } from '@surewaka/shared';
import { createRecipientsClient, useRecipientStore } from '@surewaka/mobile-shared';
import { useAuth } from '@clerk/expo';

const PRESET_LABELS = ['Home', 'Office', 'Work', 'Other'];

export default function RecipientEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { getToken } = useAuth();
  const { bottom } = useSafeAreaInsets();
  const addRecipient = useRecipientStore((s) => s.add);
  const updateRecipient = useRecipientStore((s) => s.update);

  const [label, setLabel] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!!id);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RecipientDetails>({
    resolver: zodResolver(recipientDetailsSchema),
    defaultValues: {
      recipientName: '',
      recipientPhone: '',
      deliveryNotes: '',
    },
  });

  useEffect(() => {
    if (!id) return;
    (async () => {
      const token = await getToken();
      if (!token) {
        setLoadingExisting(false);
        return;
      }
      const response = await createRecipientsClient(token).get(id);
      if (response.data) {
        const data = response.data;
        const existingLabel = data.label ?? '';
        setLabel(PRESET_LABELS.includes(existingLabel) ? existingLabel : existingLabel ? 'Other' : '');
        setCustomLabel(PRESET_LABELS.includes(existingLabel) ? '' : existingLabel);
        reset({
          recipientName: data.recipientName ?? '',
          recipientPhone: data.recipientPhone ?? '',
          deliveryNotes: data.deliveryNotes ?? '',
        });
      }
      setLoadingExisting(false);
    })();
  }, [id]);

  const onSubmit = async (values: RecipientDetails) => {
    const effectiveLabel = label === 'Other' ? customLabel.trim() : label;

    setSaving(true);

    const token = await getToken();
    if (!token) {
      setSaving(false);
      return;
    }

    const body = {
      label: effectiveLabel || undefined,
      recipientName: values.recipientName,
      recipientPhone: values.recipientPhone,
      deliveryNotes: values.deliveryNotes,
    };

    const client = createRecipientsClient(token);

    if (id) {
      const response = await client.update(id, body);
      setSaving(false);
      if (response.error) {
        Sentry.captureException(new Error(response.error.message || 'Failed to update recipient'), {
          tags: { app: 'mobile-customer', screen: 'profile/recipient-edit' },
          extra: { op: 'update' },
        });
        Alert.alert('Error', response.error.message || 'Could not save recipient. Please try again.');
      } else {
        updateRecipient(id, body);
        router.back();
      }
    } else {
      const response = await client.create(body);
      setSaving(false);
      if (response.error) {
        Sentry.captureException(new Error(response.error.message || 'Failed to create recipient'), {
          tags: { app: 'mobile-customer', screen: 'profile/recipient-edit' },
          extra: { op: 'create' },
        });
        Alert.alert('Error', response.error.message || 'Could not save recipient. Please try again.');
      } else if (response.data) {
        addRecipient(response.data);
        router.back();
      }
    }
  };

  if (loadingExisting) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white px-6 pt-6"
      contentContainerStyle={{ paddingBottom: bottom + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">
          {id ? 'Edit Recipient' : 'New Recipient'}
        </Text>
      </View>

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

      <Text className="text-xs text-gray-500 uppercase mb-2">Label (optional)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
        <View className="flex-row gap-2">
          {PRESET_LABELS.map((l) => (
            <Pressable
              key={l}
              onPress={() => setLabel((prev) => (prev === l ? '' : l))}
              className={`px-4 py-2 rounded-full border ${
                label === l ? 'bg-primary border-primary' : 'bg-white border-gray-300'
              }`}
            >
              <Text className={`text-sm font-medium ${label === l ? 'text-white' : 'text-gray-700'}`}>
                {l}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {label === 'Other' && (
        <TextInput
          value={customLabel}
          onChangeText={setCustomLabel}
          placeholder="Custom label"
          maxLength={50}
          className="border border-gray-300 rounded-xl px-4 py-3 mb-4 text-base"
        />
      )}

      <Pressable
        onPress={handleSubmit(onSubmit)}
        disabled={saving}
        className={`py-4 rounded-xl items-center mt-2 ${saving ? 'bg-gray-300' : 'bg-primary'}`}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">
            {id ? 'Update Recipient' : 'Save Recipient'}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
