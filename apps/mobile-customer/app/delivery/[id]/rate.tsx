import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function RateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');

  return (
    <View className="flex-1 bg-white px-6 pt-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Rate Your Delivery
      </Text>
      <Text className="text-base text-gray-500 mb-8">
        How was your experience?
      </Text>

      <View className="flex-row justify-center mb-8 gap-3">
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => setRating(star)}>
            <Text className={`text-4xl ${star <= rating ? '' : 'opacity-30'}`}>
              ⭐
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={review}
        onChangeText={setReview}
        placeholder="Tell us about your experience (optional)"
        className="border border-gray-300 rounded-xl px-4 py-3 text-base mb-6"
        placeholderClassName="text-gray-400"
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      <Pressable
        onPress={() => router.back()}
        className="bg-primary py-4 rounded-xl items-center"
      >
        <Text className="text-white text-lg font-semibold">Submit Review</Text>
      </Pressable>
    </View>
  );
}
