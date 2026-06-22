import React, { useEffect, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type NotificationBannerProps = {
  title: string;
  body: string;
  visible: boolean;
  onTap: () => void;
  onDismiss: () => void;
};

export function NotificationBanner({
  title,
  body,
  visible,
  onTap,
  onDismiss,
}: NotificationBannerProps) {
  const { top } = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 60,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return gestureState.dy < -10;
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy < 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy < -30) {
          Animated.timing(translateY, {
            toValue: -100,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            onDismiss();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 60,
          }).start();
        }
      },
    })
  ).current;

  if (!visible && !title) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        { top: top + 8, transform: [{ translateY }] },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable style={styles.content} onPress={onTap}>
        <View style={styles.handle} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  body: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6b7280',
    alignSelf: 'flex-start',
    lineHeight: 20,
  },
});
