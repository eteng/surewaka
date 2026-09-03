import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';
import { recipientDetailsSchema, type RecipientDetails, type SavedRecipient } from '@surewaka/shared';
import { useBookingStore, useRecipientStore, createRecipientsClient } from '@surewaka/mobile-shared';

const RECIPIENT_CAP = 25;

export default function RecipientScreen() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const { getToken } = useAuth();
  const recipientDetails = useBookingStore((s) => s.recipientDetails);
  const setRecipientDetails = useBookingStore((s) => s.setRecipientDetails);
  const setStep = useBookingStore((s) => s.setStep);

  const recipients = useRecipientStore((s) => s.recipients);
  const fetchRecipients = useRecipientStore((s) => s.fetch);
  const addRecipient = useRecipientStore((s) => s.add);

  // Stabilize getToken — @clerk/expo v4 returns a new reference each render
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const [token, setToken] = useState('');

  // Quick-select load resilience state
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Save-nudge state
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<RecipientDetails>({
    resolver: zodResolver(recipientDetailsSchema),
    mode: 'onChange',
    defaultValues: {
      recipientName: recipientDetails?.recipientName ?? '',
      recipientPhone: recipientDetails?.recipientPhone ?? '',
      deliveryNotes: recipientDetails?.deliveryNotes ?? '',
    },
  });

  useEffect(() => {
    getTokenRef.current().then((t) => {
      if (t) setToken(t);
    });
  }, []);

  const loadRecipients = useCallback(async () => {
    if (!token) return;
    setLoadingRecipients(true);
    setLoadError(false);
    const { error } = await fetchRecipients(token);
    if (error) {
      setLoadError(true);
      Sentry.captureException(error instanceof Error ? error : new Error(JSON.stringify(error)), {
        tags: { app: 'mobile-customer', screen: 'booking/recipient' },
        extra: { op: 'loadRecipients' },
      });
    }
    setLoadingRecipients(false);
  }, [token, fetchRecipients]);

  useEffect(() => {
    if (token) loadRecipients();
  }, [token, loadRecipients]);

  const selectRecipient = useCallback(
    (recipient: SavedRecipient) => {
      // Prefill the form; leave editable; do NOT submit or advance the step.
      reset({
        recipientName: recipient.recipientName,
        recipientPhone: recipient.recipientPhone,
        deliveryNotes: recipient.deliveryNotes ?? '',
      });
      // A prefilled recipient may differ from a previously saved one.
      setSaved(false);
      setSaveError(false);
    },
    [reset],
  );

  const onSubmit = (data: RecipientDetails) => {
    setRecipientDetails(data);
    setStep(4);
    router.push('/booking/carriers');
  };

  const handleSaveNudge = useCallback(async () => {
    const values = watch();
    const parsed = recipientDetailsSchema.safeParse(values);
    if (!parsed.success || !token) return;

    setSaving(true);
    setSaveError(false);
    const client = createRecipientsClient(token);
    const result = await client.create({
      recipientName: parsed.data.recipientName,
      recipientPhone: parsed.data.recipientPhone,
      deliveryNotes: parsed.data.deliveryNotes,
      label: label.trim() ? label.trim() : parsed.data.recipientName,
    });
    setSaving(false);

    if (result.error || !result.data) {
      setSaveError(true);
      Sentry.captureException(
        result.error instanceof Error ? result.error : new Error(JSON.stringify(result.error)),
        {
          tags: { app: 'mobile-customer', screen: 'booking/recipient' },
          extra: { op: 'saveRecipient' },
        },
      );
      return;
    }

    addRecipient(result.data);
    setSaved(true);
  }, [watch, token, label, addRecipient]);

  // Save-nudge visibility: valid form values AND under the cap.
  const values = watch();
  const canSave = recipientDetailsSchema.safeParse(values).success && recipients.length < RECIPIENT_CAP;

  return (
    <ScrollView
      className="flex-1 bg-white px-6 pt-6"
      contentContainerStyle={{ paddingBottom: bottom + 24 }}
    >
      <Text className="text-2xl font-bold text-gray-900 mb-2">Recipient Details</Text>
      <Text className="text-base text-gray-500 mb-6">
        Who should the driver contact at the destination?
      </Text>

      {/* Quick-select chip row (in place: loading indicator / error+retry / chips) */}
      {loadingRecipients ? (
        <View className="flex-row items-center mb-6">
          <ActivityIndicator size="small" color="#16a34a" />
          <Text className="text-sm text-gray-500 ml-2">Loading saved recipients...</Text>
        </View>
      ) : loadError ? (
        <View className="flex-row items-center justify-between bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-6">
          <View className="flex-row items-center flex-1 mr-3">
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text className="text-sm text-red-600 ml-2 flex-1">Couldn't load saved recipients</Text>
          </View>
          <Pressable
            onPress={loadRecipients}
            className="border border-red-200 rounded-full px-3 py-1"
          >
            <Text className="text-sm font-medium text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : recipients.length > 0 ? (
        <View className="mb-6">
          <Text className="text-xs font-semibold text-gray-400 uppercase mb-2">
            Saved Recipients
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
          >
            {recipients.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => selectRecipient(r)}
                className="bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm"
              >
                <Text className="text-sm font-medium text-gray-700">
                  {r.label && r.label.trim() ? r.label : r.recipientName}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

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

      {/* Save nudge — visible only while form is valid AND under the cap */}
      {canSave && (
        <View className="mb-6 bg-gray-50 border border-gray-100 rounded-xl p-4">
          {saved ? (
            <View className="flex-row items-center">
              <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
              <Text className="text-sm text-green-600 font-medium ml-1">Saved ✓</Text>
            </View>
          ) : (
            <>
              <Text className="text-sm font-medium text-gray-700 mb-2">
                Save this recipient for next time?
              </Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="Label (optional, e.g. Mum, Office)"
                className="border border-gray-300 rounded-xl px-4 py-2.5 text-base bg-white mb-3"
                placeholderClassName="text-gray-400"
                maxLength={50}
              />
              <Pressable
                onPress={handleSaveNudge}
                disabled={saving}
                className="flex-row items-center justify-center border border-primary rounded-xl py-2.5"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#16a34a" />
                ) : (
                  <>
                    <Ionicons name="bookmark-outline" size={16} color="#16a34a" />
                    <Text className="text-sm font-semibold text-primary ml-1">Save recipient</Text>
                  </>
                )}
              </Pressable>
              {saveError && (
                <Text className="text-error text-sm mt-2">
                  Couldn't save recipient. You can still continue.
                </Text>
              )}
            </>
          )}
        </View>
      )}

      <Pressable
        onPress={handleSubmit(onSubmit)}
        className="bg-primary py-4 rounded-xl items-center"
      >
        <Text className="text-white text-lg font-semibold">Continue</Text>
      </Pressable>
    </ScrollView>
  );
}
