import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache, usePushNotifications, NotificationBanner, consumeDeferredDeepLink, navigateToDeepLink } from '@surewaka/mobile-shared';

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

function InnerLayout() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { banner, dismissBanner, onBannerTap } = usePushNotifications({ app: 'driver' });

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

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#16a34a' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="delivery/[id]" options={{ title: 'Delivery Details' }} />
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

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <StatusBar style="auto" />
      <InnerLayout />
    </ClerkProvider>
  );
}
