import 'react-native-url-polyfill/auto';
import '../global.css';
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Toaster } from 'sonner-native';
import { ThemeProvider, useAuthStore } from '@surewaka/mobile-shared';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__,
  debug: false,
  tracesSampleRate: 0.2,
  environment: __DEV__ ? 'development' : 'production',
  release: Constants.expoConfig?.version,
  integrations: [Sentry.reactNativeTracingIntegration()],
});

function InnerLayout() {
  const router = useRouter();
  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const profileExists = useAuthStore((s) => s.profileExists);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Navigate imperatively so the Stack is always in the tree.
  // Rendering <Redirect> instead of <Stack> tears down the navigation context,
  // which causes Zustand's useSyncExternalStore to loop with expo-router's
  // ContextNavigator during the commit phase.
  useEffect(() => {
    if (!loading && initialized && user && profileExists === false) {
      router.replace('/(auth)/register');
    }
  }, [loading, initialized, user, profileExists]);

  if (loading || !initialized) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="booking" />
      <Stack.Screen name="tracking" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="delivery" />
      <Stack.Screen name="driver" />
    </Stack>
  );
}

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <StatusBar style="auto" />
        <InnerLayout />
        <Toaster position="bottom-center" richColors />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
