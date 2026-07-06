import type { ALERT_SEVERITIES } from '../constants';

export type OpsHubStats = {
  activeDeliveries: number;
  driversOnDuty: number;
  driversAvailable: number;
  atRiskDeliveries: number;
  openDisputes: number;
  onTimeRateToday: number | null; // percentage 0–100, null if no deliveries today
};

export type RiskReason = 'overdue' | 'driver_silent' | 'no_update_sent';

export type AtRiskDelivery = {
  id: string;
  trackingId: string;
  customerName: string;
  driverName: string | null;
  status: string;
  minutesOverdue: number;
  riskReason: RiskReason;
  pickupAddress: string;
  dropoffAddress: string;
};

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export type AlertItem = {
  id: string;
  deliveryId: string | null;
  legId: string | null;
  rule: string;
  severity: AlertSeverity;
  originalSeverity: AlertSeverity | null;
  message: string;
  firedAt: string;
  escalatedAt: string | null;
  resolvedAt: string | null;
  ackBy: string | null;
  deliveryTrackingId: string | null;
  actorName: string | null;
};

export type EscalationAction = 'call_driver' | 'reassign' | 'mark_failed';
