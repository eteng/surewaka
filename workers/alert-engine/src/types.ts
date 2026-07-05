import type { AlertRule, AlertSeverity } from '@surewaka/shared';

export type EvaluationResult = {
  deliveryId: string | null;
  legId: string | null;
  rule: AlertRule;
  severity: AlertSeverity;
  context: Record<string, unknown>;
  shouldFire: boolean;
};
