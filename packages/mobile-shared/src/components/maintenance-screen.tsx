import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectivityStore, type MaintenanceInfo } from '../store/connectivity-store';

/**
 * Full-screen maintenance overlay. Shown when the API returns maintenance status.
 * Branded, informational, with ETA if available. Auto-dismisses when maintenance ends
 * (health poller detects recovery and clears the maintenance state).
 */
export function MaintenanceScreen() {
  const status = useConnectivityStore((s) => s.status);
  const maintenance = useConnectivityStore((s) => s.maintenance);
  const { top, bottom } = useSafeAreaInsets();

  if (status !== 'maintenance' || !maintenance) {
    return null;
  }

  return (
    <View style={[styles.container, { paddingTop: top + 40, paddingBottom: bottom + 20 }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>🔧</Text>
        </View>

        <Text style={styles.title}>We'll be right back</Text>

        <Text style={styles.message}>{maintenance.message}</Text>

        {maintenance.eta && (
          <View style={styles.etaContainer}>
            <Text style={styles.etaLabel}>Estimated return</Text>
            <Text style={styles.etaValue}>{formatEta(maintenance.eta)}</Text>
          </View>
        )}

        <View style={styles.pollingIndicator}>
          <View style={styles.pollingDot} />
          <Text style={styles.pollingText}>Checking automatically...</Text>
        </View>
      </View>

      <Text style={styles.footer}>SureWaka</Text>
    </View>
  );
}

function formatEta(eta: string): string {
  try {
    const date = new Date(eta);
    if (isNaN(date.getTime())) return eta;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return eta;
  }
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    zIndex: 99999,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0fdf4',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  icon: {
    fontSize: 36,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  etaContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 32,
  },
  etaLabel: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
    marginBottom: 4,
  },
  etaValue: {
    fontSize: 20,
    fontWeight: '600',
    color: '#16a34a',
  },
  pollingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pollingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16a34a',
    marginRight: 8,
    opacity: 0.7,
  },
  pollingText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  footer: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d1d5db',
    marginBottom: 16,
  },
});
