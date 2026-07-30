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
import { ThemeProvider, tokenCache, useAuthStore, usePushNotifications, NotificationBanner, ConnectivityBanner, MaintenanceScreen, useNetInfoListener, consumeDeferredDeepLink, navigateToDeepLink } from '@surewaka/mobile-shared';

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

const FORCE_SENTRY = process.env.EXPO_PUBLIC_FORCE_SENTRY === 'true';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__ || FORCE_SENTRY,
  debug: FORCE_SENTRY,
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  environment: __DEV__ ? 'development' : 'production',
  release: Constants.expoConfig?.version,
  integrations: [Sentry.reactNativeTracingIntegration()],
  beforeSend(event) {
    // Drop Clerk session-not-found errors — expected during revocation
    const message = event.exception?.values?.[0]?.value ?? '';
    if (message.includes('No session was found')) return null;
    return event;
  },
});

// Suppress Clerk's internal "No session was found" unhandled promise rejection.
// When a user/session is deleted from Clerk dashboard, their background token
// refresh throws. Clerk will update isSignedIn=false on its own — we just prevent
// the error from showing as a red screen / LogBox error in dev.
// In production, Sentry's beforeSend filter drops these events.
import { LogBox } from 'react-native';
LogBox.ignoreLogs(['No session was found']);

function InnerLayout() {
  const router = useRouter();
  const { isSignedIn, isLoaded, getToken, signOut } = useAuth();
  const { user } = useUser();
  const profileExists = useAuthStore((s) => s.profileExists);
  const checkProfile = useAuthStore((s) => s.checkProfile);
  const setLoading = useAuthStore((s) => s.setLoading);
  const reset = useAuthStore((s) => s.reset);
  const { banner, dismissBanner, onBannerTap } = usePushNotifications({ app: 'customer' });

  // Initialize network connectivity monitoring
  useNetInfoListener();

  // Check profile existence once signed in
  useEffect(() => {
    if (!isLoaded) return;

    if (isSignedIn) {
      getToken()
        .then((token) => {
          if (token) {
            checkProfile(token);
            Sentry.setUser({ id: user?.id, email: user?.primaryEmailAddress?.emailAddress });
          } else {
            // Token null — session was revoked, force clean state
            signOut().catch(() => {});
          }
        })
        .catch(() => {
          // Session invalid (deleted user, revoked session) — force sign out
          signOut().catch(() => {});
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

  // Check for deferred deep link after successful re-authentication (Req 5.11)
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    async function checkDeferredDeepLink() {
      const data = await consumeDeferredDeepLink();
      if (data) {
        navigateToDeepLink(data, router);
      }
    }

    checkDeferredDeepLink();
  }, [isLoaded, isSignedIn, router]);

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
        <Stack.Screen name="tracking/[id]" />
        <Stack.Screen name="tracking/details/[id]" />
        <Stack.Screen name="profile/address-edit" />
        <Stack.Screen name="profile/addresses" />
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="profile/help" />
        <Stack.Screen name="profile/history" />
        <Stack.Screen name="profile/payments" />
        <Stack.Screen name="profile/settings" />
        <Stack.Screen name="delivery/weight-correction" />
        <Stack.Screen name="delivery/[id]/dispute" />
        <Stack.Screen name="delivery/[id]/rate" />
        <Stack.Screen name="delivery/[id]/receipt" />
        <Stack.Screen name="driver/[id]" />
        <Stack.Screen name="wallet" />
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
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <ThemeProvider>
          <StatusBar style="auto" />
          <InnerLayout />
          <ConnectivityBanner />
          <MaintenanceScreen />
          <Toaster position="bottom-center" richColors />
        </ThemeProvider>
      </GestureHandlerRootView>
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayout);
