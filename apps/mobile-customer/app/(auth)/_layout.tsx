import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useAuthStore } from '@surewaka/mobile-shared';

export default function AuthLayout() {
  const { isSignedIn } = useAuth();
  const profileExists = useAuthStore((s) => s.profileExists);

  // Only bounce fully-provisioned users. Users with profileExists === false
  // must complete register.tsx (which lives inside this group).
  if (isSignedIn && profileExists === true) {
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
