import 'react-native-url-polyfill/auto';
import '../global.css';
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Toaster } from 'sonner-native';
import { ClerkProvider, useAuth, useUser } from '@clerk/expo';
import { ThemeProvider, tokenCache, useAuthStore, usePushNotifications, NotificationBanner } from '@surewaka/mobile-shared';

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

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
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();
  const profileExists = useAuthStore((s) => s.profileExists);
  const checkProfile = useAuthStore((s) => s.checkProfile);
  const setLoading = useAuthStore((s) => s.setLoading);
  const reset = useAuthStore((s) => s.reset);
  const { banner, dismissBanner, onBannerTap } = usePushNotifications({ app: 'customer' });

  // Check profile existence once signed in
  useEffect(() => {
    if (!isLoaded) return;

    if (isSignedIn) {
      getToken().then((token) => {
        if (token) {
          checkProfile(token);
          Sentry.setUser({ id: user?.id, email: user?.primaryEmailAddress?.emailAddress });
        }
      });
    } else {
      reset();
      setLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  // Redirect new users to register
  useEffect(() => {
    if (isLoaded && isSignedIn && profileExists === false) {
      router.replace('/(auth)/register');
    }
  }, [isLoaded, isSignedIn, profileExists]);

  if (!isLoaded) {
    return null;
  }

  return (
    <>
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
      <NotificationBanner
        visible={!!banner}
        title={banner?.title ?? ''}
        body={banner?.body ?? ''}
        onTap={onBannerTap}
        onDismiss={dismissBanner}
      />
    </>
  );
}

function RootLayout() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <StatusBar style="auto" />
          <InnerLayout />
          <Toaster position="bottom-center" richColors />
        </ThemeProvider>
      </GestureHandlerRootView>
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayout);
