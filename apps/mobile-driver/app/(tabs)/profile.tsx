import { useState, useEffect, useCallback } from 'react';
import { Text, View, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import { useAuth } from '@clerk/expo';
import { apiClient } from '@surewaka/mobile-shared';

export default function DriverProfileScreen() {
  const { isSignedIn, getToken } = useAuth();
  const [notificationPush, setNotificationPush] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setIsLoading(true);
    try {
      const response = await apiClient.get<{
        notificationPush: boolean;
      }>('/api/v1/profile', token);

      if (response.data) {
        setNotificationPush(response.data.notificationPush);
      }
    } catch {
      // Silently fail — toggle defaults to true
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isSignedIn) {
      fetchProfile();
    }
  }, [isSignedIn, fetchProfile]);

  const handlePushToggle = async (value: boolean) => {
    const previousValue = notificationPush;
    setNotificationPush(value);

    const token = await getToken();
    if (!token) {
      setNotificationPush(previousValue);
      Alert.alert('Error', 'Not authenticated');
      return;
    }

    const response = await apiClient.patch(
      '/api/v1/profile',
      { notificationPush: value },
      token,
    );

    if (response.error) {
      setNotificationPush(previousValue);
      Alert.alert('Error', 'Failed to update notification preference');
    }
  };

  if (!isSignedIn) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Driver Profile</Text>
        <Text style={styles.hint}>Sign in to manage your driver account</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Driver Profile</Text>

      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Push Notifications</Text>
            <Text style={styles.settingHint}>Delivery assignments and payment alerts</Text>
          </View>
          {isLoading ? (
            <ActivityIndicator size="small" color="#16a34a" />
          ) : (
            <Switch
              value={notificationPush}
              onValueChange={handlePushToggle}
              trackColor={{ false: '#d1d5db', true: '#16a34a' }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 24,
  },
  hint: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#111827',
  },
  settingHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
});
