import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache, usePushNotifications, NotificationBanner } from '@surewaka/mobile-shared';

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

function InnerLayout() {
  const { banner, dismissBanner, onBannerTap } = usePushNotifications({ app: 'driver' });

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
