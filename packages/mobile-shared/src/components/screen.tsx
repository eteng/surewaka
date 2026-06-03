import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ScreenVariant = 'scroll' | 'static' | 'form';

type ScreenProps = {
  children: React.ReactNode;
  variant?: ScreenVariant;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  noPadding?: boolean;
};

export function Screen({
  children,
  variant = 'scroll',
  footer,
  style,
  contentContainerStyle,
  noPadding = false,
}: ScreenProps) {
  const { bottom } = useSafeAreaInsets();

  if (variant === 'static') {
    return <View style={[styles.root, style]}>{children}</View>;
  }

  const scroll = (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[
        noPadding ? styles.contentBase : styles.contentPadded,
        { paddingBottom: footer ? 16 : bottom + 24 },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  const footerEl = footer ? (
    <View style={[styles.footer, { paddingBottom: bottom + 16 }]}>{footer}</View>
  ) : null;

  if (variant === 'form') {
    return (
      <KeyboardAvoidingView
        style={[styles.root, style]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {scroll}
        {footerEl}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.root, style]}>
      {scroll}
      {footerEl}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  fill: {
    flex: 1,
  },
  contentBase: {
    flexGrow: 1,
  },
  contentPadded: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
});
