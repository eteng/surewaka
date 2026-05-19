import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

const faqs = [
  { q: 'How do I book a delivery?', a: 'Tap "Send a Package" on the home screen and follow the steps.' },
  { q: 'How can I track my package?', a: 'Go to the Deliveries tab and tap on any active delivery.' },
  { q: 'What payment methods do you accept?', a: 'We accept bank transfer, card payments, and Pay on Delivery.' },
  { q: 'How do I report an issue?', a: 'Go to the delivery details and tap "Report an Issue".' },
];

export default function HelpScreen() {
  const router = useRouter();

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Help & Support</Text>
      </View>

      <Text className="text-lg font-semibold text-gray-900 mb-4">
        Frequently Asked Questions
      </Text>

      {faqs.map((faq, index) => (
        <View key={index} className="bg-gray-50 rounded-xl p-4 mb-3">
          <Text className="text-base font-medium text-gray-900 mb-2">{faq.q}</Text>
          <Text className="text-sm text-gray-500">{faq.a}</Text>
        </View>
      ))}

      <View className="mt-6 mb-8">
        <Text className="text-lg font-semibold text-gray-900 mb-4">
          Still need help?
        </Text>
        <Pressable className="bg-primary py-4 rounded-xl items-center mb-3">
          <Text className="text-white text-base font-semibold">💬 Live Chat</Text>
        </Pressable>
        <Pressable className="bg-primary-light py-4 rounded-xl items-center">
          <Text className="text-primary text-base font-semibold">📧 Email Support</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
