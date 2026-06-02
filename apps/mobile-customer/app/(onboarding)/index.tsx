import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@surewaka/mobile-shared';

const ONBOARDING_COMPLETE_KEY = 'surewaka_onboarding_complete';

const slides = [
  {
    title: 'Compare Carriers',
    subtitle: 'See prices side by side from multiple logistics providers',
    icon: '📦',
  },
  {
    title: 'Real-Time Tracking',
    subtitle: 'Know exactly where your package is at every step',
    icon: '📍',
  },
  {
    title: 'Instant Delivery',
    subtitle: 'Get matched to a nearby driver in minutes',
    icon: '🚀',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const profileExists = useAuthStore((s) => s.profileExists);
  const [currentSlide, setCurrentSlide] = useState(0);
  // null = still checking, false = show slides, true = redirecting
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function resolveInitialRoute() {
      // Already authenticated and provisioned — skip everything and go to the app
      if (user && profileExists) {
        router.replace('/(tabs)');
        return;
      }

      // Has seen onboarding before but isn't signed in — go to auth
      const completed = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
      if (completed === 'true') {
        router.replace('/(auth)/sign-in');
        return;
      }

      // First time — show slides
      setChecking(false);
    }

    resolveInitialRoute();
  }, [user, router]);

  const markOnboardingComplete = () => AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');

  const slide = slides[currentSlide];
  const isLast = currentSlide === slides.length - 1;

  const handleNext = async () => {
    if (isLast) {
      await markOnboardingComplete();
      router.replace('/(auth)/sign-in');
    } else {
      setCurrentSlide((prev) => prev + 1);
    }
  };

  const handleSkip = async () => {
    await markOnboardingComplete();
    router.replace('/(auth)/sign-in');
  };

  // Blank while deciding where to send the user — root _layout already
  // shows null during initialize(), so this is only a momentary AsyncStorage read.
  if (checking) return null;

  return (
    <View className="flex-1 bg-white">
      <Pressable className="absolute top-12 right-6 z-10" onPress={handleSkip}>
        <Text className="text-primary font-semibold text-base">Skip</Text>
      </Pressable>

      <View className="flex-1 items-center justify-center px-8">
        <View className="w-32 h-32 rounded-full bg-primary-light items-center justify-center mb-8">
          <Text className="text-5xl">{slide.icon}</Text>
        </View>

        <Text className="text-2xl font-bold text-gray-900 text-center mb-3">
          {slide.title}
        </Text>

        <Text className="text-base text-gray-500 text-center leading-6 px-4">
          {slide.subtitle}
        </Text>
      </View>

      <View className="px-8 pb-12">
        <View className="flex-row justify-center gap-2 mb-8">
          {slides.map((_, index) => (
            <View
              key={index}
              className={`h-2 rounded-full transition-all ${
                index === currentSlide ? 'w-8 bg-primary' : 'w-2 bg-gray-300'
              }`}
            />
          ))}
        </View>

        <Pressable
          onPress={handleNext}
          className="bg-primary py-4 rounded-xl items-center"
        >
          <Text className="text-white text-lg font-semibold">
            {isLast ? 'Get Started' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
