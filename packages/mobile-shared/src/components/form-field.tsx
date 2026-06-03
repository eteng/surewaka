import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

type FormFieldProps = TextInputProps & {
  label: string;
  error?: string;
  style?: StyleProp<ViewStyle>;
};

export function FormField({ label, error, style, multiline, ...inputProps }: FormFieldProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          error ? styles.inputError : styles.inputDefault,
          inputProps.style,
        ]}
        placeholderTextColor="#9ca3af"
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  inputDefault: {
    borderColor: '#d1d5db',
  },
  inputError: {
    borderColor: '#ef4444',
  },
  inputMultiline: {
    minHeight: 88,
  },
  error: {
    fontSize: 14,
    color: '#ef4444',
    marginTop: 4,
  },
});
