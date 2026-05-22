import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
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
  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);
  const loading = useAuthStore((s) => s.loading);

  useEffect(() => {
    initialize();
  }, [initialize]);

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
    <ThemeProvider>
      <StatusBar style="auto" />
      <InnerLayout />
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
