import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectivityStore, type ConnectivityStatus } from '../store/connectivity-store';

const BANNER_HEIGHT = 36;

const BANNER_CONFIG: Record<Exclude<ConnectivityStatus, 'online' | 'maintenance'>, { message: string; bg: string; text: string }> = {
  offline: {
    message: 'No internet connection',
    bg: '#1f2937', // gray-800
    text: '#ffffff',
  },
  degraded: {
    message: 'Service temporarily unavailable',
    bg: '#f59e0b', // amber-500
    text: '#1f2937',
  },
};

/**
 * Persistent connectivity banner. Slides in below the safe area when
 * the app is offline or degraded, and auto-hides when back online.
 *
 * Non-dismissible — it disappears only when connectivity is restored.
 */
export function ConnectivityBanner() {
  const status = useConnectivityStore((s) => s.status);
  const { top } = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT - top)).current;
  const prevStatus = useRef<ConnectivityStatus>(status);

  useEffect(() => {
    const isVisible = status === 'offline' || status === 'degraded';
    const wasVisible = prevStatus.current === 'offline' || prevStatus.current === 'degraded';
    prevStatus.current = status;

    if (isVisible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 10,
        tension: 80,
      }).start();
    } else if (wasVisible) {
      // Was visible, now online — slide out
      Animated.timing(translateY, {
        toValue: -(BANNER_HEIGHT + top),
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [status, translateY, top]);

  // Don't render anything if online (after animation completes)
  if (status === 'online') {
    // Still render during exit animation; the Animated.View handles hiding
  }

  const config = (status === 'offline' || status === 'degraded') ? BANNER_CONFIG[status] : BANNER_CONFIG.offline;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingTop: top,
          backgroundColor: config.bg,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <View style={styles.content}>
        <View style={[styles.dot, { backgroundColor: status === 'offline' ? '#ef4444' : '#fbbf24' }]} />
        <Text style={[styles.text, { color: config.text }]}>
          {config.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9998,
  },
  content: {
    height: BANNER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
