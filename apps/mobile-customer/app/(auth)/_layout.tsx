import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@surewaka/mobile-shared';

export default function AuthLayout() {
  const user = useAuthStore((s) => s.user);

  // If the user is already signed in, bounce them to the app.
  // This covers the case where they deep-link into an auth screen
  // or the session is restored after the onboarding check runs.
  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
