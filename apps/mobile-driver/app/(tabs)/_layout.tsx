import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#16a34a',
        headerStyle: { backgroundColor: '#16a34a' },
        headerTintColor: '#fff',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Jobs',
          headerTitle: 'Available Jobs',
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: 'Active',
          headerTitle: 'Active Delivery',
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          headerTitle: 'My Earnings',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerTitle: 'Driver Profile',
        }}
      />
    </Tabs>
  );
}
