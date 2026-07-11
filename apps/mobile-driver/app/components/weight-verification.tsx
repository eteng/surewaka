import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '@clerk/expo';
import { Button, FormField, createAuthClient } from '@surewaka/mobile-shared';

type WeightCorrectionResponse = {
  correctionId: string;
  declaredWeightKg: number;
  reportedWeightKg: number;
  deltaKobo: number;
  approvalDeadline: string;
};

type WeightVerificationProps = {
  deliveryId: string;
  legId: string;
  declaredWeightKg: number;
  onWeightMatches: () => void;
  onCorrectionSubmitted: (correction: WeightCorrectionResponse) => void;
};

type SubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'submitted'; correction: WeightCorrectionResponse }
  | { status: 'error'; message: string };

export function WeightVerification({
  deliveryId,
  legId,
  declaredWeightKg,
  onWeightMatches,
  onCorrectionSubmitted,
}: WeightVerificationProps) {
  const { getToken } = useAuth();
  const [actualWeight, setActualWeight] = useState('');
  const [validationError, setValidationError] = useState<string | undefined>();
  const [state, setState] = useState<SubmissionState>({ status: 'idle' });

  const parsedWeight = parseFloat(actualWeight);
  const isValidWeight = !isNaN(parsedWeight) && parsedWeight > 0 && parsedWeight <= 500;
  const hasDiscrepancy = isValidWeight && parsedWeight !== declaredWeightKg;

  const validateWeight = useCallback((value: string) => {
    if (!value.trim()) {
      setValidationError(undefined);
      return;
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
      setValidationError('Enter a valid number');
    } else if (num <= 0) {
      setValidationError('Weight must be greater than 0');
    } else if (num > 500) {
      setValidationError('Weight cannot exceed 500kg');
    } else {
      setValidationError(undefined);
    }
  }, []);

  const handleWeightChange = useCallback(
    (text: string) => {
      // Allow only numbers and one decimal point
      const sanitized = text.replace(/[^0-9.]/g, '');
      // Prevent multiple decimal points
      const parts = sanitized.split('.');
      const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : sanitized;
      setActualWeight(cleaned);
      validateWeight(cleaned);
    },
    [validateWeight],
  );

  const handleReportWeight = useCallback(async () => {
    if (!isValidWeight || !hasDiscrepancy) return;

    setState({ status: 'submitting' });

    try {
      const token = await getToken();
      if (!token) {
        setState({ status: 'error', message: 'Authentication failed. Please try again.' });
        return;
      }

      const client = createAuthClient(token);
      const response = await client.post<WeightCorrectionResponse>(
        `/api/v1/deliveries/${deliveryId}/legs/${legId}/weight-correction`,
        { reportedWeightKg: parsedWeight },
      );

      if (response.error) {
        setState({ status: 'error', message: response.error.message });
        return;
      }

      if (response.data) {
        setState({ status: 'submitted', correction: response.data });
        onCorrectionSubmitted(response.data);
      }
    } catch {
      setState({ status: 'error', message: 'Network error. Please check your connection.' });
    }
  }, [deliveryId, legId, parsedWeight, isValidWeight, hasDiscrepancy, getToken, onCorrectionSubmitted]);

  // Submitted state — awaiting customer response
  if (state.status === 'submitted') {
    const { correction } = state;
    const deltaNaira = Math.abs(correction.deltaKobo) / 100;
    const isCharge = correction.deltaKobo > 0;
    const deadline = new Date(correction.approvalDeadline);
    const deadlineStr = deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={styles.container}>
        <View style={styles.successBanner}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>Weight correction submitted</Text>
          <Text style={styles.successMessage}>Awaiting customer approval.</Text>
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Declared weight</Text>
            <Text style={styles.detailValue}>{correction.declaredWeightKg}kg</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Actual weight</Text>
            <Text style={styles.detailValue}>{correction.reportedWeightKg}kg</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowLast]}>
            <Text style={styles.detailLabel}>
              {isCharge ? 'Additional charge' : 'Refund to customer'}
            </Text>
            <Text style={[styles.detailValue, isCharge ? styles.chargeText : styles.refundText]}>
              {isCharge ? '+' : '-'}₦{deltaNaira.toLocaleString()}
            </Text>
          </View>
        </View>

        <Text style={styles.deadlineText}>
          Customer must respond by {deadlineStr}
        </Text>

        <View style={styles.waitingIndicator}>
          <ActivityIndicator size="small" color="#16a34a" />
          <Text style={styles.waitingText}>Waiting for customer response...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Verify Package Weight</Text>
      <Text style={styles.subtitle}>
        Please weigh the package and confirm or report any discrepancy.
      </Text>

      <View style={styles.declaredCard}>
        <Text style={styles.declaredLabel}>Declared weight</Text>
        <Text style={styles.declaredValue}>{declaredWeightKg}kg</Text>
      </View>

      <FormField
        label="Actual weight (kg)"
        placeholder="Enter measured weight"
        keyboardType="decimal-pad"
        value={actualWeight}
        onChangeText={handleWeightChange}
        error={validationError}
      />

      {state.status === 'error' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.message}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Button
          label="Report Weight"
          onPress={handleReportWeight}
          disabled={!isValidWeight || !hasDiscrepancy}
          loading={state.status === 'submitting'}
          variant="primary"
        />
        <Button
          label="Weight Matches"
          onPress={onWeightMatches}
          variant="secondary"
          disabled={state.status === 'submitting'}
        />
      </View>

      {hasDiscrepancy && isValidWeight && (
        <Text style={styles.discrepancyHint}>
          Difference: {parsedWeight > declaredWeightKg ? '+' : ''}
          {(parsedWeight - declaredWeightKg).toFixed(1)}kg
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
  },
  declaredCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  declaredLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  declaredValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  discrepancyHint: {
    fontSize: 13,
    color: '#f59e0b',
    textAlign: 'center',
    marginTop: 12,
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
  },
  // Submitted state styles
  successBanner: {
    alignItems: 'center',
    marginBottom: 24,
  },
  successIcon: {
    fontSize: 32,
    color: '#16a34a',
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  successMessage: {
    fontSize: 14,
    color: '#6b7280',
  },
  detailsCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  chargeText: {
    color: '#dc2626',
  },
  refundText: {
    color: '#16a34a',
  },
  deadlineText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 16,
  },
  waitingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  waitingText: {
    fontSize: 14,
    color: '#6b7280',
  },
});
