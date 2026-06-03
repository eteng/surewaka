import React from 'react';
import { Pressable, StyleSheet, Text, View, type ReactNode } from 'react-native';
import { useRouter } from 'expo-router';

type ScreenHeaderProps = {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
};

export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  const router = useRouter();
  const handleBack = onBack ?? (() => router.back());

  return (
    <View style={styles.container}>
      <Pressable onPress={handleBack} style={styles.backButton} hitSlop={8}>
        <Text style={styles.backIcon}>←</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {/* Right slot keeps title left-anchored; empty view preserves balance */}
      <View style={styles.side}>{right ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 24,
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    marginRight: 8,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 22,
    color: '#16a34a',
  },
  title: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  side: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
