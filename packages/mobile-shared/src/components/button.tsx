import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'lg' | 'md';

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'lg',
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[size],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#ffffff' : '#16a34a'} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label` as const]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // variants
  primary: {
    backgroundColor: '#16a34a',
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#16a34a',
  },
  danger: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  // sizes
  lg: {
    minHeight: 52,
    paddingHorizontal: 24,
  },
  md: {
    minHeight: 44,
    paddingHorizontal: 20,
  },
  // states
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
  // labels
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryLabel: {
    color: '#ffffff',
  },
  secondaryLabel: {
    color: '#16a34a',
  },
  dangerLabel: {
    color: '#ef4444',
  },
});
