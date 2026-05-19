import { Tabs, Redirect } from 'expo-router';
import { View, Text } from 'react-native';
import { useAuthStore } from '@surewaka/mobile-shared';

function TabIcon({ focused, title }: { focused: boolean; title: string }) {
  const icons: Record<string, string> = {
    Home: '🏠',
    Deliveries: '📦',
    Notifications: '🔔',
    Profile: '👤',
  };

  return (
    <View className="items-center justify-center">
      <Text className={`text-xl ${focused ? '' : 'opacity-50'}`}>
        {icons[title] || '📌'}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#16a34a',
        tabBarInactiveTintColor: '#9ca3af',
        headerStyle: { backgroundColor: '#16a34a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: 'SureWaka',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} title="Home" />,
        }}
      />
      <Tabs.Screen
        name="deliveries"
        options={{
          title: 'Deliveries',
          headerTitle: 'My Deliveries',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} title="Deliveries" />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          headerTitle: 'Notifications',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} title="Notifications" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerTitle: 'My Profile',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} title="Profile" />,
        }}
      />
    </Tabs>
  );
}
