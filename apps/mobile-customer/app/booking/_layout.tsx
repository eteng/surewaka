import { Stack, useRouter, usePathname } from 'expo-router';

const steps = ['Pickup', 'Drop-off', 'Package', 'Recipient', 'Carriers', 'Review', 'Confirmed'];

export default function BookingLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const stepIndex = steps.findIndex((s) => {
    const slug = s.toLowerCase().replace('-', '');
    return pathname.includes(slug);
  });

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#16a34a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
        headerLeft: () => null,
      }}
    >
      <Stack.Screen
        name="pickup"
        options={{ title: `Step 1 of ${steps.length}: Pickup` }}
      />
      <Stack.Screen
        name="dropoff"
        options={{ title: `Step 2 of ${steps.length}: Drop-off` }}
      />
      <Stack.Screen
        name="package"
        options={{ title: `Step 3 of ${steps.length}: Package` }}
      />
      <Stack.Screen
        name="recipient"
        options={{ title: `Step 4 of ${steps.length}: Recipient` }}
      />
      <Stack.Screen
        name="carriers"
        options={{ title: `Step 5 of ${steps.length}: Choose Service` }}
      />
      <Stack.Screen
        name="review"
        options={{ title: `Step 6 of ${steps.length}: Review` }}
      />
      <Stack.Screen
        name="confirmed"
        options={{
          title: 'Booking Confirmed',
          headerLeft: () => null,
        }}
      />
    </Stack>
  );
}
