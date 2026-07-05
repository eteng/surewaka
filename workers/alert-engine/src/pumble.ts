import type { AlertRule } from '@surewaka/shared';

const RULE_LABELS: Record<AlertRule, string> = {
  driver_silent: 'Driver Silent',
  leg_overdue: 'Leg Overdue',
  driver_ghost: 'Driver Ghost',
  dispute_filed: 'Dispute Filed',
  delivery_failed: 'Delivery Failed',
  ontime_rate_drop: 'On-Time Rate Drop',
  customer_update_gap: 'Customer Update Gap',
};

export function formatPumbleMessage(
  rule: AlertRule,
  context: Record<string, unknown>,
): string {
  const label = RULE_LABELS[rule];
  const deliveryRef = context.deliveryId ? `Delivery #${context.deliveryId}` : 'Platform';
  const adminUrl = process.env.ADMIN_URL ?? 'https://admin.surewaka.ng';

  const details: string[] = [];
  if (context.driverName) details.push(`Driver: ${context.driverName}`);
  if (context.minutesSilent) details.push(`Silent for ${context.minutesSilent} min`);
  if (context.minutesOverdue) details.push(`${context.minutesOverdue} min overdue`);
  if (context.customerName) details.push(`Customer: ${context.customerName}`);
  if (context.zone) details.push(`Zone: ${context.zone}`);
  if (context.ratePct !== undefined) details.push(`Rate: ${context.ratePct}%`);
  if (context.minutesSinceUpdate) details.push(`No update for ${context.minutesSinceUpdate} min`);

  const lines = [
    `🔴 CRITICAL — ${label}`,
    `${deliveryRef}${details.length ? ' | ' + details.join(' | ') : ''}`,
    `→ View: ${adminUrl}/deliveries${context.deliveryId ? `/${context.deliveryId}` : ''}`,
  ];

  return lines.join('\n');
}

export async function sendPumbleAlert(
  webhookUrl: string,
  rule: AlertRule,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatPumbleMessage(rule, context) }),
    });
  } catch (err) {
    // Non-blocking — alert was already written to DB; Pumble failure is logged only
    console.error(`[alert-engine] Pumble send failed for rule ${rule}:`, err);
  }
}
