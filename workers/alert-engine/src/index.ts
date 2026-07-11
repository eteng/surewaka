import { db } from './db';
import { loadSettings, getAdminUserIds } from './settings';
import { sendPumbleAlert } from './pumble';
import { enqueueAdminPush } from './push';
import { alerts } from '@surewaka/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { EvaluationResult } from './types';
import type { AlertSeverity } from '@surewaka/shared';

import { evaluate as evalDriverSilent } from './rules/driver-silent';
import { evaluate as evalLegOverdue } from './rules/leg-overdue';
import { evaluate as evalDriverGhost } from './rules/driver-ghost';
import { evaluate as evalDisputeFiled } from './rules/dispute-filed';
import { evaluate as evalDeliveryFailed } from './rules/delivery-failed';
import { evaluate as evalOntimeRate } from './rules/ontime-rate-drop';
import { evaluate as evalCustomerUpdateGap } from './rules/customer-update-gap';
import { runCorrectionExpiryCheck } from './rules/weight-correction-expiry';

const POLL_INTERVAL_MS = 60_000;

let tickRunning = false;

async function upsertAlert(
  result: EvaluationResult,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  adminUserIds: string[],
): Promise<void> {
  if (!result.shouldFire) {
    // Resolve any existing unresolved alert for this rule+leg/delivery
    await db
      .update(alerts)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(alerts.rule, result.rule),
          isNull(alerts.resolvedAt),
          result.legId ? eq(alerts.legId, result.legId) : isNull(alerts.legId),
          result.deliveryId ? eq(alerts.deliveryId, result.deliveryId) : isNull(alerts.deliveryId),
        ),
      );
    return;
  }

  // Check for existing unresolved alert for this rule+leg/delivery
  const [existing] = await db
    .select({ id: alerts.id, severity: alerts.severity })
    .from(alerts)
    .where(
      and(
        eq(alerts.rule, result.rule),
        isNull(alerts.resolvedAt),
        result.legId ? eq(alerts.legId, result.legId) : isNull(alerts.legId),
        result.deliveryId ? eq(alerts.deliveryId, result.deliveryId) : isNull(alerts.deliveryId),
      ),
    )
    .limit(1);

  if (existing) {
    // Escalate in place if severity increased
    const severityOrder: AlertSeverity[] = ['info', 'warning', 'critical'];
    if (!severityOrder.includes(existing.severity as AlertSeverity)) {
      console.error(`[alert-engine] unexpected severity '${existing.severity}' on alert ${existing.id} — skipping escalation`);
      return;
    }
    const existingIdx = severityOrder.indexOf(existing.severity as AlertSeverity);
    const newIdx = severityOrder.indexOf(result.severity);

    if (newIdx > existingIdx) {
      await db
        .update(alerts)
        .set({
          severity: result.severity,
          originalSeverity: existing.severity as AlertSeverity,
          escalatedAt: new Date(),
          context: result.context,
        })
        .where(eq(alerts.id, existing.id));

      if (result.severity === 'critical') {
        await routeCritical(result, settings, adminUserIds);
      }
    }
    return;
  }

  // New alert
  await db.insert(alerts).values({
    deliveryId: result.deliveryId,
    legId: result.legId,
    rule: result.rule,
    severity: result.severity,
    context: result.context,
  });

  if (result.severity === 'critical') {
    await routeCritical(result, settings, adminUserIds);
  }
}

async function routeCritical(
  result: EvaluationResult,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  adminUserIds: string[],
): Promise<void> {
  if (settings.pumbleEnabled && settings.pumbleWebhookUrl) {
    await sendPumbleAlert(settings.pumbleWebhookUrl, result.rule, result.context);
  }
  if (settings.pushEnabled) {
    await enqueueAdminPush(result.rule, result.context, adminUserIds);
  }
}

const evaluators = [
  evalDriverSilent,
  evalLegOverdue,
  evalDriverGhost,
  evalDisputeFiled,
  evalDeliveryFailed,
  evalOntimeRate,
  evalCustomerUpdateGap,
];

async function runTick(): Promise<void> {
  const [settings, adminUserIds] = await Promise.all([loadSettings(), getAdminUserIds()]);

  // Run alert-rule evaluators (notification-only) and the correction expiry check
  // (business-state mutation) in parallel.
  const [settled, correctionResult] = await Promise.all([
    Promise.allSettled(evaluators.map((fn) => fn(settings))),
    runCorrectionExpiryCheck().catch((err) => {
      console.error('[alert-engine] weight-correction-expiry check failed:', err);
      return { resolvedCount: 0 };
    }),
  ]);

  const allResults: EvaluationResult[] = [];
  for (const [i, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value);
    } else {
      console.error(`[alert-engine] rule evaluator ${i} rejected:`, result.reason);
    }
  }

  for (const result of allResults) {
    try {
      await upsertAlert(result, settings, adminUserIds);
    } catch (err) {
      console.error(`[alert-engine] upsertAlert failed for rule ${result.rule}:`, err);
    }
  }

  console.log(
    `[alert-engine] tick complete — ${allResults.filter((r) => r.shouldFire).length} active conditions` +
      (correctionResult.resolvedCount > 0
        ? `, ${correctionResult.resolvedCount} expired correction(s) resolved`
        : ''),
  );
}

// ─── Startup ──────────────────────────────────────────────────────────────────

console.log('[alert-engine] starting — poll interval: 60s');

// Run immediately on start, then every 60s
tickRunning = true;
runTick().finally(() => { tickRunning = false; });
const timer = setInterval(() => {
  if (tickRunning) return;
  tickRunning = true;
  runTick().finally(() => { tickRunning = false; });
}, POLL_INTERVAL_MS);

process.on('SIGTERM', () => {
  clearInterval(timer);
  console.log('[alert-engine] stopped');
  process.exit(0);
});
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('[alert-engine] stopped');
  process.exit(0);
});
